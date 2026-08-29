import {
  CoachCapabilityId,
  CoachPauseReason,
  CoachSessionState,
  MinimapObservationBatch
} from '@shared/types/live-coach'
import { LiveGameSnapshot } from '@shared/types/live-game-data'
import type { LiveGameDomain } from '@shared/types/live-game-data'
import {
  PROVISIONAL_LIVE_GAME_SESSION_ID,
  resolveLiveGameSessionId
} from '@shared/utils/live-game-session'
import { makeAutoObservable, observable } from 'mobx'

import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import { LiveCoachCapabilityController } from './capability-controller'
import type { CommunicationController } from './communication-controller'
import type { LiveCoachMainContext } from './context'
import type { CooldownTrackerController } from './cooldown-tracker-controller'
import { CueSchedulerController } from './cue-scheduler-controller'
import { FactFusionEngine, findActivePlayerRecord } from './fact-fusion'
import {
  LIVE_COACH_CONSENT_REQUIRED_REASON,
  hasCurrentLiveCoachPrivacyConsent
} from './privacy-consent'
import { CoachRuleEngine } from './rule-engine'
import { extractSystemRecommendedItemIds } from './system-item-recommendations'

export class LiveCoachSessionController {
  private readonly _fusion: FactFusionEngine
  private readonly _ruleEngine: CoachRuleEngine
  private _gameflowDisposer: (() => void) | null = null
  private _liveDataDisposer: (() => void) | null = null
  private _roiHealthDisposer: (() => void) | null = null
  private _featureSettingsDisposer: (() => void) | null = null
  private _isPaused = false
  private _resumeState: 'active' | 'shadow' = 'active'
  private readonly _systemRecommendedItemIds = new Map<number, number[]>()
  private readonly _systemRecommendationLoads = new Set<number>()
  private readonly _systemRecommendationRetryAfter = new Map<number, number>()
  private _liveDataDomainStates: Partial<Record<LiveGameDomain, string>> = {}
  public latestPatch: string | null = null

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _capabilityController: LiveCoachCapabilityController,
    private readonly _scheduler: CueSchedulerController,
    private readonly _cooldownTracker?: CooldownTrackerController,
    private readonly _communicationController?: CommunicationController
  ) {
    this._fusion = new FactFusionEngine()
    this._ruleEngine = new CoachRuleEngine()

    makeAutoObservable(this, {
      latestPatch: observable
    })

    // 监听证据失效事件并通知调度器取消对应 Cue（P1-005）
    this._fusion.onEvidenceInvalidated = (invalidatedIds) => {
      this._scheduler.cancelCuesByEvidenceIds(invalidatedIds, 'evidence-invalidated')
    }
    if (this._cooldownTracker) {
      this._cooldownTracker.onEvidence = (evidence) => this._fusion.addEvidence(evidence)
    }
  }

  public get fusion(): FactFusionEngine {
    return this._fusion
  }

  public init(): void {
    this._featureSettingsDisposer = this._context.mobxUtils.reaction(
      () => ({
        fogInferenceEnabled: this._context.settings.fogInferenceEnabled,
        fogInferenceDetail: this._context.settings.fogInferenceDetail,
        itemGuidanceEnabled: this._context.settings.itemGuidanceEnabled,
        cooldownTrackingEnabled: this._context.settings.cooldownTrackingEnabled,
        communicationAssistEnabled: this._context.settings.communicationAssistEnabled
      }),
      (settings) => {
        this._fusion.configureFogInference(settings.fogInferenceEnabled !== false)
        this._capabilityController.refreshCapabilities?.()

        if (settings.fogInferenceEnabled === false) {
          this._context.state.setFogInferences([])
          this._scheduler.cancelCuesByRuleIds?.(['rule_fog_inference'], 'feature-disabled')
        } else {
          this._syncFogInferences()
        }
        if (settings.itemGuidanceEnabled === false) {
          this._context.state.setItemGuidance(null)
          this._scheduler.cancelCuesByRuleIds?.(['rule_item_purchase_guidance'], 'feature-disabled')
        }
        if (settings.cooldownTrackingEnabled === false) {
          this._cooldownTracker?.reset()
        }
        if (settings.communicationAssistEnabled === false) {
          this._scheduler.cancelCuesByRuleIds?.(['rule_communication_ping'], 'feature-disabled')
        }
      },
      { fireImmediately: true }
    )

    // 1. Subscribe to LiveGameDataMain
    this._liveDataDisposer = this._context.liveGameData.subscribe('game-stats', (snapshot) => {
      if (this._context.state.session.id && this._context.state.session.id !== snapshot.sessionId) {
        return
      }
      if (snapshot.patch && snapshot.patch !== this.latestPatch) {
        this.latestPatch = snapshot.patch
        this._context.state.setSessionInfo({ patch: snapshot.patch })
      }
      this._onLiveGameSnapshot(snapshot)
    })

    // 2. Watch Gameflow state
    this._gameflowDisposer = this._context.mobxUtils.reaction(
      () => ({
        enabled: this._context.settings.enabled,
        privacyConsentGranted: hasCurrentLiveCoachPrivacyConsent(this._context.settings),
        autoStartEnabled: this._context.settings.autoStartEnabled,
        phase: this._context.leagueClient.data.gameflow.phase,
        session: this._context.leagueClient.data.gameflow.session
      }),
      ({ enabled, privacyConsentGranted, autoStartEnabled, phase, session }) => {
        const mapId = session?.map?.id ?? null
        const queueId = session?.gameData?.queue?.id ?? null
        const patch = this.latestPatch || 'unknown'

        if (!privacyConsentGranted) {
          this._capabilityController.evaluateCapabilities(mapId, queueId, patch, {
            roiHealth: this._context.state.capture.roiState,
            liveDataHealth: this._context.state.liveData.state,
            liveDataDomains: this._liveDataDomainStates,
            backend: this._context.state.capture.backend
          })
          this.endSession(LIVE_COACH_CONSENT_REQUIRED_REASON)
          if (enabled) {
            // Close the observable switch immediately, then persist the same value through the
            // authoritative setting service. A stale/externally written enabled=true cannot race
            // a manual or automatic start because startSession also checks consent directly.
            this._context.settings.setEnabled(false)
            void this._context.settingService
              .set('enabled', false)
              .catch((error) =>
                this._context.logger.warn(
                  formatSanitizedErrorLog(
                    'Unable to persist disabled Live Coach state after consent withdrawal',
                    error
                  )
                )
              )
          }
          return
        }

        if (!enabled) {
          // 总开关关闭后必须同步撤销公开 capability，不能只停止会话却保留“可用”标记。
          this._capabilityController.evaluateCapabilities(mapId, queueId, patch, {
            roiHealth: this._context.state.capture.roiState,
            liveDataHealth: this._context.state.liveData.state,
            liveDataDomains: this._liveDataDomainStates,
            backend: this._context.state.capture.backend
          })
          this.endSession('feature-disabled')
          return
        }

        this._capabilityController.evaluateCapabilities(mapId, queueId, patch, {
          roiHealth: this._context.state.capture.roiState,
          liveDataHealth: this._context.state.liveData.state,
          liveDataDomains: this._liveDataDomainStates,
          backend: this._context.state.capture.backend
        })

        if (phase === 'Reconnect') {
          if (this._isAnalyzingState()) {
            this.pause('environment-abnormal')
          }
          return
        }

        if (phase === 'InProgress') {
          // InProgress 早期 LCU 可能先给出不完整 session。地图/队列未解析时保持降级，
          // 不能先进入 active 再让采集和分析分别失效。
          if (mapId === null) {
            this._enterDegradedState('map-unresolved', mapId, queueId, patch)
            return
          }
          if (mapId !== 11) {
            this._context.logger.info(
              `LiveCoach: mapId ${mapId} is not Summoner's Rift (11). Session blocked.`
            )
            this._enterDegradedState('unsupported-map', mapId, queueId, patch)
            return
          }

          if (queueId === null || queueId < 0) {
            this._enterDegradedState('queue-unresolved', mapId, queueId, patch)
            return
          }

          if (process.platform !== 'win32') {
            this._enterDegradedState('unsupported-platform', mapId, queueId, patch)
            return
          }

          const sessionId = resolveLiveGameSessionId(session?.gameData?.gameId)
          const hasRunningSession = ['active', 'shadow', 'paused'].includes(
            this._context.state.session.state
          )
          const isCurrentSessionAlreadyRunning =
            hasRunningSession &&
            (this._context.state.session.id === sessionId ||
              (this._context.state.session.id === PROVISIONAL_LIVE_GAME_SESSION_ID &&
                sessionId !== PROVISIONAL_LIVE_GAME_SESSION_ID))
          if (autoStartEnabled === false && !isCurrentSessionAlreadyRunning) {
            if (this._context.state.session.id || this._context.state.session.state !== 'idle') {
              this.endSession('automatic-start-disabled')
            }
            return
          }
          this.startSession(sessionId, mapId, queueId, patch)
        } else {
          // 关键修复：任何离开 InProgress 的阶段（包含 None, WaitingForStats, ChampSelect 等），
          // 统一调用 endSession()，彻底取消 TTS、清空待播 Cue、观察与融合证据，杜绝跨局残留
          this.endSession(`gameflow-phase-${phase || 'None'}`)
        }
      },
      { fireImmediately: true }
    )

    // 3. 动态响应 ROI 采集状态与 Patch 变化，实时重新评估并解禁/更新 Capabilities
    this._roiHealthDisposer = this._context.mobxUtils.reaction(
      () => ({
        roiState: this._context.state.capture.roiState,
        backend: this._context.state.capture.backend,
        enabled: this._context.settings.enabled,
        patch: this.latestPatch || 'unknown'
      }),
      ({ roiState, backend, patch }) => {
        const session = this._context.leagueClient.data.gameflow.session
        const mapId = session?.map?.id ?? null
        const queueId = session?.gameData?.queue?.id ?? null
        this._capabilityController.evaluateCapabilities(mapId, queueId, patch || 'unknown', {
          roiHealth: roiState,
          liveDataHealth: this._context.state.liveData.state,
          liveDataDomains: this._liveDataDomainStates,
          backend
        })
      }
    )
  }

  public dispose(): void {
    if (this._featureSettingsDisposer) {
      this._featureSettingsDisposer()
      this._featureSettingsDisposer = null
    }
    if (this._gameflowDisposer) {
      this._gameflowDisposer()
      this._gameflowDisposer = null
    }
    if (this._roiHealthDisposer) {
      this._roiHealthDisposer()
      this._roiHealthDisposer = null
    }
    if (this._liveDataDisposer) {
      this._liveDataDisposer()
      this._liveDataDisposer = null
    }
    this.endSession('disposed')
  }

  public setSessionState(state: CoachSessionState): void {
    this._context.state.setSessionState(state)
  }

  public startSession(
    sessionId: string,
    mapId: number | null,
    queueId: number | null,
    patch: string | null
  ): void {
    if (!hasCurrentLiveCoachPrivacyConsent(this._context.settings)) {
      this._capabilityController.refreshCapabilities()
      this.endSession(LIVE_COACH_CONSENT_REQUIRED_REASON)
      return
    }
    if (mapId === null) {
      this._enterDegradedState('map-unresolved', mapId, queueId, patch)
      return
    }
    if (mapId !== 11) {
      this._enterDegradedState('unsupported-map', mapId, queueId, patch)
      return
    }
    if (queueId === null || queueId < 0) {
      this._enterDegradedState('queue-unresolved', mapId, queueId, patch)
      return
    }
    if (!this._context.state.capability.enabledFeatureIds.includes('coach.capture.screen')) {
      this._enterDegradedState('realtime-capture-unavailable', mapId, queueId, patch)
      return
    }

    if (
      this._context.state.session.id === sessionId &&
      (this._context.state.session.state === 'active' ||
        this._context.state.session.state === 'shadow' ||
        this._context.state.session.state === 'paused')
    ) {
      this._context.state.setSessionInfo({ mapId, queueId, patch })
      if (
        this._context.state.session.state === 'paused' &&
        this._context.state.session.pauseReason === 'environment-abnormal'
      ) {
        this.resume()
      }
      return
    }

    if (
      this._context.state.session.id === PROVISIONAL_LIVE_GAME_SESSION_ID &&
      sessionId !== PROVISIONAL_LIVE_GAME_SESSION_ID &&
      (this._context.state.session.state === 'active' ||
        this._context.state.session.state === 'shadow' ||
        this._context.state.session.state === 'paused')
    ) {
      const shouldResumeAfterPromotion =
        this._context.state.session.state === 'paused' &&
        this._context.state.session.pauseReason === 'environment-abnormal'
      this._context.logger.info('Promoting provisional coach session to official game id')
      this._scheduler.reset(true)
      this._fusion.reset()
      this._ruleEngine.reset()
      this._cooldownTracker?.reset()
      this._communicationController?.reset()
      this._context.state.clearSessionArtifacts()
      this._context.state.setSessionInfo({ id: sessionId, mapId, queueId, patch })
      if (shouldResumeAfterPromotion) {
        this.resume()
      }
      return
    }

    this._context.logger.info(
      `Starting coach session (Map: ${mapId}, Queue: ${queueId}, Patch: ${patch})`
    )
    this._scheduler.reset()
    this._fusion.reset()
    this._ruleEngine.reset()
    this._cooldownTracker?.reset()
    this._communicationController?.reset()
    this._isPaused = false
    this._resumeState = this._context.settings.shadowModeEnabled ? 'shadow' : 'active'
    this._context.state.clearSessionArtifacts()

    this._context.state.setSessionInfo({
      id: sessionId,
      state: this._resumeState,
      pauseReason: null,
      mapId,
      queueId,
      patch,
      startedAt: Date.now()
    })
  }

  public endSession(reason: string): void {
    if (this._context.state.session.id || this._context.state.session.state !== 'idle') {
      this._context.logger.info(`Ending coach session; reason: ${reason}`)
    }
    this._context.state.completeSessionSummary(reason)
    this._scheduler.reset()
    this._fusion.reset()
    this._ruleEngine.reset()
    this._cooldownTracker?.reset()
    this._communicationController?.reset()
    this._isPaused = false
    this._resumeState = 'active'
    // 补丁只属于当前对局。跨局保留会让下一局在首次 2999 响应前短暂启用旧目录与旧规则。
    this.latestPatch = null
    this._liveDataDomainStates = {}
    this._context.state.setLiveDataState('idle', null)
    this._context.state.reset(
      reason === 'feature-disabled' || reason === LIVE_COACH_CONSENT_REQUIRED_REASON
        ? 'disabled'
        : 'idle',
      true
    )
  }

  public pause(reason: string): void {
    if (!this._isAnalyzingState()) return
    this._isPaused = true
    this._resumeState = this._context.state.session.state === 'shadow' ? 'shadow' : 'active'
    this._scheduler.reset(true)
    this._ruleEngine.reset()
    this.invalidateRealtimeAnalysis()
    this._context.state.setSessionInfo({
      state: 'paused',
      pauseReason: this._normalizePauseReason(reason)
    })
  }

  public resume(): void {
    if (this._context.state.session.state !== 'paused') return
    this._isPaused = false
    this._context.state.setSessionInfo({ state: this._resumeState, pauseReason: null })
  }

  public applyShadowMode(enabled: boolean): void {
    this._resumeState = enabled ? 'shadow' : 'active'
    if (this._context.state.session.state === 'active' && enabled) {
      this._scheduler.reset(true)
      this._context.state.setSessionInfo({ state: 'shadow', pauseReason: null })
    } else if (this._context.state.session.state === 'shadow' && !enabled) {
      this._scheduler.reset(true)
      this._context.state.setSessionInfo({ state: 'active', pauseReason: null })
    }
  }

  private _isAnalyzingState(state: CoachSessionState = this._context.state.session.state): boolean {
    return state === 'active' || state === 'shadow'
  }

  private _normalizePauseReason(reason: string): CoachPauseReason {
    switch (reason) {
      case 'global-shortcut':
      case 'environment-abnormal':
      case 'feature-unavailable':
        return reason
      default:
        return 'user-pause'
    }
  }

  public invalidateRealtimeAnalysis(): void {
    this._fusion.invalidateMinimapData()
    this._fusion.invalidateLiveGameData()
    this._cooldownTracker?.reset()
    this._context.state.setFogInferences([])
    this._context.state.setItemGuidance(null)
  }

  public handleCapabilitiesDisabled(capabilityIds: CoachCapabilityId[]): void {
    const disabled = new Set(capabilityIds)

    if (disabled.has('coach.analyze.minimap-basic')) {
      this._fusion.invalidateMinimapData()
      this._context.state.setFogInferences([])
      this._scheduler.cancelCuesByRuleIds(
        [
          'rule_minimap_enemy_grouping',
          'rule_high_priority_minimap_change',
          'rule_fog_inference',
          'rule_basic_skills_and_tactics',
          'rule_communication_ping'
        ],
        'capability-disabled'
      )
    } else {
      if (disabled.has('coach.analyze.minimap-advanced')) {
        this._scheduler.cancelCuesByRuleIds(
          ['rule_minimap_enemy_grouping', 'rule_high_priority_minimap_change'],
          'capability-disabled'
        )
      }
      if (disabled.has('coach.analyze.fog-inference')) {
        this._context.state.setFogInferences([])
        this._scheduler.cancelCuesByRuleIds(
          ['rule_fog_inference', 'rule_basic_skills_and_tactics', 'rule_communication_ping'],
          'capability-disabled'
        )
      }
      if (disabled.has('coach.analyze.minimap-identity')) {
        this._scheduler.cancelCuesByRuleIds(
          ['rule_basic_skills_and_tactics'],
          'capability-disabled'
        )
      }
    }

    if (disabled.has('coach.guidance.item-purchase')) {
      this._context.state.setItemGuidance(null)
      this._scheduler.cancelCuesByRuleIds(['rule_item_purchase_guidance'], 'capability-disabled')
    }
    if (disabled.has('coach.guidance.micro')) {
      this._scheduler.cancelCuesByRuleIds(
        ['rule_skill_point_guidance', 'rule_combat_fundamentals', 'rule_basic_skills_and_tactics'],
        'capability-disabled'
      )
    }
    if (disabled.has('coach.track.cooldowns')) {
      this._cooldownTracker?.reset()
      this._scheduler.cancelCuesByRuleIds(
        ['rule_objective_spawn', 'rule_turret_plating_fall'],
        'capability-disabled'
      )
    }
    if (
      (disabled.has('coach.communication.ping') || disabled.has('coach.communication.chat')) &&
      !this._context.state.capability.enabledFeatureIds.some(
        (id) => id === 'coach.communication.ping' || id === 'coach.communication.chat'
      )
    ) {
      this._scheduler.cancelCuesByRuleIds(['rule_communication_ping'], 'capability-disabled')
    }
  }

  private _enterDegradedState(
    reason: string,
    mapId: number | null,
    queueId: number | null,
    patch: string | null
  ): void {
    this._context.logger.info(`LiveCoach session degraded: ${reason}`)
    this._scheduler.reset()
    this._fusion.reset()
    this._ruleEngine.reset()
    this._isPaused = false
    this._liveDataDomainStates = {}
    this._context.state.setLiveDataState('idle', null)
    this._context.state.reset('degraded')
    this._context.state.setSessionInfo({ mapId, queueId, patch })
  }

  public handleMinimapBatch(batch: MinimapObservationBatch): void {
    if (this._isPaused || !this._isAnalyzingState() || !this._capabilityController.isGateAEnabled) {
      return
    }

    if (this._context.state.session.id !== batch.sessionId) {
      return
    }

    try {
      if (batch.health && batch.health !== this._context.state.capture.roiState) {
        this._context.state.setCaptureState({ roiState: batch.health })
        const session = this._context.leagueClient.data.gameflow.session
        const mapId = session?.map?.id ?? null
        const queueId = session?.gameData?.queue?.id ?? null
        this._capabilityController.evaluateCapabilities(mapId, queueId, batch.patch || 'unknown', {
          roiHealth: batch.health,
          liveDataHealth: this._context.state.liveData.state,
          liveDataDomains: this._liveDataDomainStates,
          backend: this._context.state.capture.backend
        })
      }

      if (
        !this._context.state.capability.enabledFeatureIds.includes('coach.analyze.minimap-basic')
      ) {
        this._fusion.invalidateMinimapData()
        this._context.state.setFogInferences([])
        return
      }

      this._fusion.updateMinimapBatch(batch)
      this._syncFogInferences()

      const sessionId = this._context.state.session.id || batch.sessionId
      const patch = this._context.state.session.patch || batch.patch

      const enabledCapabilities = new Set(this._context.state.capability.enabledFeatureIds)
      const cues = this._ruleEngine.evaluate({
        sessionId,
        patch,
        queueId: this._context.state.session.queueId,
        fusion: this._fusion,
        enabledCategories: this._context.settings.cueCategories,
        enabledCapabilities
      })

      if (cues.length > 0) {
        this._scheduler.submitCues(cues)
      }
    } catch (err) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Error during minimap batch processing', err)
      )
    }
  }

  private _onLiveGameSnapshot(snapshot: LiveGameSnapshot): void {
    if (this._context.state.session.id && this._context.state.session.id !== snapshot.sessionId) {
      return
    }

    this._updateLiveDataHealth(snapshot)
    if (snapshot.sourceHealth.length > 0) {
      const healthByDomain = new Map(
        snapshot.sourceHealth.map((health) => [health.domain, health.state])
      )
      if (
        healthByDomain.get('players') !== 'healthy' ||
        healthByDomain.get('active-player') !== 'healthy'
      ) {
        // 玩家或本人域失效时，任何旧金币、装备与死亡状态都不能继续留在事实层。
        // 独立的事件域失败不会走这里，因此仍可保留合法的装备/微操能力。
        this._fusion.invalidateLiveGameData()
        this._context.state.setItemGuidance(null)
      }
    }

    if (this._isPaused || !this._isAnalyzingState() || !this._capabilityController.isGateAEnabled) {
      return
    }

    try {
      const active = snapshot.activePlayer
      const activePlayer = active ? findActivePlayerRecord(snapshot) : null
      const championId = activePlayer?.championId ?? null

      if (
        this._context.settings.itemGuidanceEnabled !== false &&
        this._context.settings.itemGuidanceMode === 'system' &&
        championId
      ) {
        void this._ensureSystemItemRecommendations(championId)
      }

      this._fusion.configureItemGuidance({
        mode: this._context.settings.itemGuidanceMode,
        customItemBuilds: this._context.settings.customItemBuilds,
        systemRecommendedItemIds: Object.fromEntries(
          Array.from(this._systemRecommendedItemIds.entries()).map(([id, itemIds]) => [
            String(id),
            itemIds
          ])
        )
      })
      this._fusion.updateLiveGameSnapshot(snapshot)
      const enabledCapabilities = new Set(this._context.state.capability.enabledFeatureIds)
      if (
        this._context.settings.cooldownTrackingEnabled !== false &&
        enabledCapabilities.has('coach.track.cooldowns')
      ) {
        this._cooldownTracker?.syncFromSnapshot(snapshot)
      }
      this._context.state.setItemGuidance(
        this._context.settings.itemGuidanceEnabled !== false &&
          enabledCapabilities.has('coach.guidance.item-purchase')
          ? this._fusion.getItemPurchaseGuidance()
          : null
      )
      this._syncFogInferences()

      const sessionId = this._context.state.session.id || snapshot.sessionId
      const patch = this._context.state.session.patch || snapshot.patch

      const cues = this._ruleEngine.evaluate({
        sessionId,
        patch,
        queueId: this._context.state.session.queueId,
        fusion: this._fusion,
        enabledCategories: this._context.settings.cueCategories,
        enabledCapabilities
      })

      if (cues.length > 0) {
        this._scheduler.submitCues(cues)
      }
    } catch (err) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Error during fact fusion & rule evaluation', err)
      )
    }
  }

  private _syncFogInferences(): void {
    if (this._context.settings.fogInferenceEnabled === false) {
      this._context.state.setFogInferences([])
      return
    }

    const detail = this._context.settings.fogInferenceDetail
    const visibleInferences = this._fusion.getFogInferences().map((inference) => ({
      ...inference,
      candidateRoutes: detail === 'region' ? [] : inference.candidateRoutes,
      intents: detail === 'intent' ? inference.intents : []
    }))
    this._context.state.setFogInferences(visibleInferences)
  }

  private _updateLiveDataHealth(snapshot: LiveGameSnapshot): boolean {
    if (snapshot.sourceHealth.length === 0) {
      // Recorded fixtures may omit transport health; their caller controls freshness explicitly.
      return true
    }

    const states = snapshot.sourceHealth.map((health) => health.state)
    this._liveDataDomainStates = Object.fromEntries(
      snapshot.sourceHealth.map((health) => [health.domain, health.state])
    )
    const lastSuccessAt = snapshot.sourceHealth.reduce<number | null>(
      (latest, health) =>
        health.lastSuccessAt !== null && (latest === null || health.lastSuccessAt > latest)
          ? health.lastSuccessAt
          : latest,
      null
    )
    const state = states.every((value) => value === 'healthy')
      ? 'healthy'
      : states.some((value) => value === 'unavailable')
        ? 'unavailable'
        : states.every((value) => value === 'idle')
          ? 'idle'
          : 'degraded'
    this._context.state.setLiveDataState(state, lastSuccessAt, snapshot.sourceHealth)
    const gameflowSession = this._context.leagueClient.data.gameflow.session
    this._capabilityController.evaluateCapabilities(
      gameflowSession?.map?.id ?? null,
      gameflowSession?.gameData?.queue?.id ?? null,
      snapshot.patch || this.latestPatch || 'unknown',
      {
        roiHealth: this._context.state.capture.roiState,
        liveDataHealth: state,
        liveDataDomains: this._liveDataDomainStates,
        backend: this._context.state.capture.backend
      }
    )
    return state === 'healthy'
  }

  private async _ensureSystemItemRecommendations(championId: number): Promise<void> {
    if (
      this._systemRecommendedItemIds.has(championId) ||
      this._systemRecommendationLoads.has(championId) ||
      (this._systemRecommendationRetryAfter.get(championId) ?? 0) > Date.now()
    ) {
      return
    }

    this._systemRecommendationLoads.add(championId)
    try {
      const response = await this._context.leagueClient.api.gameData.getChampDetails(championId)
      const itemIds = extractSystemRecommendedItemIds(response.data.recommendedItemDefaults)
      if (itemIds.length === 0) {
        throw new Error('Riot recommendedItemDefaults did not contain supported item ids')
      }
      this._systemRecommendedItemIds.set(championId, itemIds)
      this._systemRecommendationRetryAfter.delete(championId)
    } catch (error) {
      this._systemRecommendationRetryAfter.set(championId, Date.now() + 30_000)
      this._context.logger.warn(
        formatSanitizedErrorLog(
          `Unable to load Riot system item recommendations for champion ${championId}`,
          error
        )
      )
    } finally {
      this._systemRecommendationLoads.delete(championId)
    }
  }
}
