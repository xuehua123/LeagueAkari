import { CoachSessionState, MinimapObservationBatch } from '@shared/types/live-coach'
import { LiveGameSnapshot } from '@shared/types/live-game-data'
import { formatError } from '@shared/utils/errors'
import { makeAutoObservable, observable } from 'mobx'

import { LiveCoachCapabilityController } from './capability-controller'
import type { LiveCoachMainContext } from './context'
import { CueSchedulerController } from './cue-scheduler-controller'
import { FactFusionEngine } from './fact-fusion'
import { CoachRuleEngine } from './rule-engine'

export class LiveCoachSessionController {
  private readonly _fusion: FactFusionEngine
  private readonly _ruleEngine: CoachRuleEngine
  private _gameflowDisposer: (() => void) | null = null
  private _liveDataDisposer: (() => void) | null = null
  private _roiHealthDisposer: (() => void) | null = null
  private _isPaused = false
  public latestPatch: string | null = null

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _capabilityController: LiveCoachCapabilityController,
    private readonly _scheduler: CueSchedulerController
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
  }

  public get fusion(): FactFusionEngine {
    return this._fusion
  }

  public init(): void {
    // 1. Subscribe to LiveGameDataMain
    this._liveDataDisposer = this._context.liveGameData.subscribe('game-stats', (snapshot) => {
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
        phase: this._context.leagueClient.data.gameflow.phase,
        session: this._context.leagueClient.data.gameflow.session
      }),
      ({ enabled, phase, session }) => {
        if (!enabled) {
          this.setSessionState('disabled')
          this._scheduler.reset()
          return
        }

        const mapId = session?.map?.id ?? null
        const queueId = session?.gameData?.queue?.id ?? null
        const patch = this.latestPatch || '16.16.1'

        this._capabilityController.evaluateCapabilities(mapId, queueId, patch, {
          roiHealth: this._context.state.capture.roiState
        })

        if (phase === 'InProgress') {
          // 严格检查：非召唤师峡谷（Map 11）或非 Windows 环境，阻断启动
          if (mapId !== null && mapId !== 11) {
            this._context.logger.info(
              `LiveCoach: mapId ${mapId} is not Summoner's Rift (11). Session blocked.`
            )
            this.setSessionState('degraded')
            this._scheduler.reset()
            return
          }

          if (process.platform !== 'win32') {
            this.setSessionState('degraded')
            return
          }

          const sessionId = session?.gameData?.gameId
            ? String(session.gameData.gameId)
            : `sess_${Date.now()}`
          this.startSession(sessionId, mapId, queueId, patch)
        } else if (phase === 'PreEndOfGame' || phase === 'EndOfGame') {
          this.endSession('game-ended')
        } else {
          if (
            this._context.state.session.state !== 'idle' &&
            this._context.state.session.state !== 'disabled'
          ) {
            this.setSessionState('idle')
          }
        }
      },
      { fireImmediately: true }
    )

    // 3. 动态响应 ROI 采集状态与 Patch 变化，实时重新评估并解禁/更新 Capabilities
    this._roiHealthDisposer = this._context.mobxUtils.reaction(
      () => ({
        roiState: this._context.state.capture.roiState,
        enabled: this._context.settings.enabled,
        patch: this.latestPatch
      }),
      ({ roiState, patch }) => {
        const session = this._context.leagueClient.data.gameflow.session
        const mapId = session?.map?.id ?? null
        const queueId = session?.gameData?.queue?.id ?? null
        this._capabilityController.evaluateCapabilities(mapId, queueId, patch || '16.16.1', {
          roiHealth: roiState
        })
      }
    )
  }

  public dispose(): void {
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
    if (mapId !== null && mapId !== 11) {
      this.setSessionState('degraded')
      return
    }

    this._context.logger.info(
      `Starting coach session: ${sessionId} (Map: ${mapId}, Queue: ${queueId}, Patch: ${patch})`
    )
    this._fusion.reset()
    this._ruleEngine.reset()
    this._isPaused = false

    this._context.state.setSessionInfo({
      id: sessionId,
      state: 'active',
      mapId,
      queueId,
      patch,
      startedAt: Date.now()
    })
  }

  public endSession(reason: string): void {
    if (
      this._context.state.session.state === 'idle' ||
      this._context.state.session.state === 'disabled'
    ) {
      return
    }

    this._context.logger.info(
      `Ending coach session: ${this._context.state.session.id}, reason: ${reason}`
    )
    this._scheduler.reset()
    this._fusion.reset()
    this._ruleEngine.reset()
    this._context.state.reset()
  }

  public pause(_reason: string): void {
    this._isPaused = true
    this._scheduler.reset()
    this.setSessionState('paused')
  }

  public resume(): void {
    this._isPaused = false
    this.setSessionState('active')
  }

  public handleMinimapBatch(batch: MinimapObservationBatch): void {
    if (this._isPaused || this._context.state.session.state !== 'active') {
      return
    }

    try {
      if (batch.health && batch.health !== this._context.state.capture.roiState) {
        this._context.state.setCaptureState({ roiState: batch.health })
        const session = this._context.leagueClient.data.gameflow.session
        const mapId = session?.map?.id ?? null
        const queueId = session?.gameData?.queue?.id ?? null
        this._capabilityController.evaluateCapabilities(mapId, queueId, batch.patch || '16.16.1', {
          roiHealth: batch.health
        })
      }

      this._fusion.updateMinimapBatch(batch)

      const sessionId = this._context.state.session.id || batch.sessionId
      const patch = this._context.state.session.patch || batch.patch

      const enabledCapabilities = new Set(this._context.state.capability.enabledFeatureIds)
      const cues = this._ruleEngine.evaluate({
        sessionId,
        patch,
        fusion: this._fusion,
        enabledCategories: this._context.settings.cueCategories,
        enabledCapabilities
      })

      if (cues.length > 0) {
        this._scheduler.submitCues(cues)
      }
    } catch (err) {
      this._context.logger.warn(`Error during minimap batch processing: ${formatError(err)}`)
    }
  }

  private _onLiveGameSnapshot(snapshot: LiveGameSnapshot): void {
    if (this._isPaused || this._context.state.session.state !== 'active') {
      return
    }

    try {
      this._fusion.updateLiveGameSnapshot(snapshot)

      const sessionId = this._context.state.session.id || snapshot.sessionId
      const patch = this._context.state.session.patch || snapshot.patch

      const enabledCapabilities = new Set(this._context.state.capability.enabledFeatureIds)
      const cues = this._ruleEngine.evaluate({
        sessionId,
        patch,
        fusion: this._fusion,
        enabledCategories: this._context.settings.cueCategories,
        enabledCapabilities
      })

      if (cues.length > 0) {
        this._scheduler.submitCues(cues)
      }
    } catch (err) {
      this._context.logger.warn(`Error during fact fusion & rule evaluation: ${formatError(err)}`)
    }
  }
}
