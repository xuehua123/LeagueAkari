import {
  CoachCapabilityId,
  CoachUnavailableReason,
  LiveCoachBuildChannel,
  LiveCoachCapabilityPayload,
  LiveCoachCapabilityRule,
  LiveCoachCapabilitySnapshotStatus,
  comparePatchVersions
} from '@shared/types/live-coach'
import type { LiveGameDomain } from '@shared/types/live-game-data'

import { SUPPORTED_LIVE_COACH_PATCH_CATALOGS } from './catalog/current'
import type { LiveCoachMainContext } from './context'
import {
  INTERNAL_LIVE_COACH_CAPABILITY_POLICY,
  PHASE_ONE_CAPABILITY_IDS
} from './internal-capability-policy'
import {
  LIVE_COACH_CONSENT_REQUIRED_REASON,
  hasCurrentLiveCoachPrivacyConsent
} from './privacy-consent'

export const SUPPORTED_PATCH_CATALOGS = SUPPORTED_LIVE_COACH_PATCH_CATALOGS

export interface LiveCoachRuntimeHealth {
  roiHealth?: string
  state?: string
  liveDataHealth?: string
  liveDataDomains?: Partial<Record<LiveGameDomain, string>>
  backend?: string | null
}

const PATCH_LOCKED_CAPABILITIES = new Set<CoachCapabilityId>([
  'coach.analyze.minimap-identity',
  'coach.analyze.fog-inference',
  'coach.guidance.item-purchase',
  'coach.guidance.micro',
  'coach.track.cooldowns'
])

const REALTIME_CAPABILITIES = PHASE_ONE_CAPABILITY_IDS.filter((id) => id !== 'coach.offline-review')
const WINDOWS_CAPTURE_CAPABILITIES = new Set<CoachCapabilityId>([
  'coach.capture.screen',
  'coach.analyze.minimap-basic',
  'coach.analyze.minimap-advanced',
  'coach.analyze.minimap-identity',
  'coach.analyze.fog-inference'
])
const GATE_B_CAPABILITIES = new Set<CoachCapabilityId>([
  'coach.output.subtitle',
  'coach.output.sound',
  'coach.output.tts'
])

export class LiveCoachCapabilityController {
  private _buildChannel: LiveCoachBuildChannel = 'internal'
  private _gateAEnabled = true
  private _gateBEnabled = true
  private _isIdentityModelLoaded = false
  private _isTtsAvailable = false
  private _isSoundAvailable = false
  private _capabilitySnapshot: LiveCoachCapabilityPayload | null = null
  private _capabilitySnapshotStatus: LiveCoachCapabilitySnapshotStatus = 'unavailable'
  private _runtimeRegionId: string | null = null
  private readonly _loadedModels = new Map<string, { version: string; sha256: string }>()
  private _lastMapId: number | null = null
  private _lastQueueId: number | null = null
  private _lastPatch: string | null = null
  private _lastWorkerStatus?: LiveCoachRuntimeHealth

  public onGateADisabled: (() => void) | null = null
  public onGateBDisabled: (() => void) | null = null
  public onCapabilitiesDisabled: ((capabilityIds: CoachCapabilityId[]) => void) | null = null

  constructor(private readonly _context: LiveCoachMainContext) {}

  public get buildChannel(): LiveCoachBuildChannel {
    return this._buildChannel
  }

  public setBuildChannel(channel: LiveCoachBuildChannel): void {
    this._buildChannel = channel
    this.refreshCapabilities()
  }

  public get isGateAEnabled(): boolean {
    return this._buildChannel === 'internal' || this._gateAEnabled
  }

  public get isGateBEnabled(): boolean {
    return this._buildChannel === 'internal' || this._gateBEnabled
  }

  public setIdentityModelLoaded(
    loaded: boolean,
    descriptor?: { version: string; sha256: string } | null
  ): void {
    this._isIdentityModelLoaded = loaded
    if (loaded && descriptor) {
      this._loadedModels.set('champion-icon-onnx', descriptor)
    } else {
      this._loadedModels.delete('champion-icon-onnx')
    }
    this.refreshCapabilities()
  }

  public setCapabilitySnapshot(
    snapshot: LiveCoachCapabilityPayload | null,
    status: LiveCoachCapabilitySnapshotStatus
  ): void {
    this._capabilitySnapshot = snapshot
    this._capabilitySnapshotStatus = status
    this.refreshCapabilities()
  }

  public setRuntimeRegion(regionId: string | null): void {
    this._runtimeRegionId = regionId
    this.refreshCapabilities()
  }

  public setTtsAvailable(available: boolean): void {
    this._isTtsAvailable = available
    this.refreshCapabilities()
  }

  public setSoundAvailable(available: boolean): void {
    this._isSoundAvailable = available
    this.refreshCapabilities()
  }

  public setGates(gateA: boolean, gateB: boolean): void {
    this._gateAEnabled = gateA
    this._gateBEnabled = gateB
    this.refreshCapabilities()
  }

  public refreshCapabilities(): void {
    this.evaluateCapabilities(
      this._lastMapId,
      this._lastQueueId,
      this._lastPatch,
      this._lastWorkerStatus
    )
  }

  public evaluateCapabilities(
    mapId: number | null,
    queueId: number | null = null,
    patch: string | null = null,
    workerStatus?: LiveCoachRuntimeHealth
  ): void {
    this._lastMapId = mapId
    this._lastQueueId = queueId
    this._lastPatch = patch
    this._lastWorkerStatus = workerStatus

    const enabledFeatureIds: string[] = []
    const unavailable: Record<string, CoachUnavailableReason> = {}
    const consentGranted = hasCurrentLiveCoachPrivacyConsent(this._context.settings)

    // 1. “启用 AI 教练”是实时会话总开关，不得连带关闭离线录像分析。
    // 离线能力仍由自身的平台/策略规则决定。
    const realtimeDisabledByUser = !this._context.settings.enabled
    if (realtimeDisabledByUser) {
      unavailable['all'] = 'capability-disabled'
    }

    // 2. 签名能力策略。内部构建只绕过外部发布审批，仍使用同一套
    // map/queue/patch/platform/model 约束；公开构建没有有效快照时严格关闭实时能力。
    const policy =
      this._buildChannel === 'internal'
        ? INTERNAL_LIVE_COACH_CAPABILITY_POLICY
        : this._capabilitySnapshotStatus === 'valid'
          ? this._capabilitySnapshot
          : null

    if (!policy || policy.killSwitch) {
      for (const capabilityId of REALTIME_CAPABILITIES) {
        unavailable[capabilityId] = 'capability-disabled'
      }
    } else {
      const rulesById = new Map(policy.rules.map((rule) => [rule.id, rule]))
      for (const capabilityId of PHASE_ONE_CAPABILITY_IDS) {
        const rule = rulesById.get(capabilityId)
        if (!rule) {
          if (capabilityId !== 'coach.offline-review') {
            unavailable[capabilityId] = 'capability-disabled'
          }
          continue
        }
        const reason = this._evaluatePolicyRule(rule, policy, mapId, queueId, patch)
        if (reason) {
          unavailable[capabilityId] = reason
        }
      }
    }

    if (process.platform !== 'win32') {
      unavailable['platform'] = 'unsupported-platform'
      for (const capabilityId of WINDOWS_CAPTURE_CAPABILITIES) {
        unavailable[capabilityId] = 'unsupported-platform'
      }
    }
    if (mapId !== null && mapId !== 11) {
      unavailable['map'] = 'unsupported-map'
      for (const capabilityId of REALTIME_CAPABILITIES) {
        unavailable[capabilityId] = 'unsupported-map'
      }
    }
    if (mapId === 11 && (queueId === null || queueId < 0)) {
      unavailable['queue'] = 'unsupported-queue'
      for (const capabilityId of REALTIME_CAPABILITIES) {
        unavailable[capabilityId] = 'unsupported-queue'
      }
    }

    // 本地规则/目录也必须覆盖当前补丁。远端快照只能收窄授权，不能让尚未
    // 随应用发布并完成哈希校验的目录突然生效。
    if (!patch || patch === 'unknown' || !SUPPORTED_PATCH_CATALOGS.has(patch)) {
      unavailable['patch'] = 'unsupported-patch'
      for (const capabilityId of PATCH_LOCKED_CAPABILITIES) {
        unavailable[capabilityId] = 'unsupported-patch'
      }
    }

    // 5. 采集状态与 ROI 健康检查
    // 关键修正：ROI 健康状态只禁用视觉分析能力（minimap-basic/advanced/fog-inference），
    // 绝不禁用 coach.capture.screen，否则会导致“初始 unknown -> 不启动采集 -> 永远 unknown”的死锁！
    if (
      workerStatus?.roiHealth === 'unknown' ||
      workerStatus?.roiHealth === 'degraded' ||
      workerStatus?.roiHealth === 'occluded'
    ) {
      unavailable['coach.analyze.minimap-basic'] ??= 'roi-occluded'
      unavailable['coach.analyze.minimap-advanced'] ??= 'roi-occluded'
      unavailable['coach.analyze.fog-inference'] ??= 'roi-occluded'
    }

    const liveDataDomains = workerStatus?.liveDataDomains
    if (workerStatus?.liveDataHealth && workerStatus.liveDataHealth !== 'healthy') {
      unavailable['live-game-data'] = 'live-data-unavailable'
      if (liveDataDomains) {
        const isHealthy = (...domains: LiveGameDomain[]) =>
          domains.every((domain) => liveDataDomains[domain] === 'healthy')
        if (!isHealthy('players', 'active-player')) {
          unavailable['coach.guidance.item-purchase'] = 'live-data-unavailable'
          unavailable['coach.guidance.micro'] = 'live-data-unavailable'
        }
        if (!isHealthy('game-stats', 'players', 'events', 'active-player')) {
          unavailable['coach.track.cooldowns'] = 'live-data-unavailable'
        }
      } else {
        unavailable['coach.guidance.item-purchase'] = 'live-data-unavailable'
        unavailable['coach.guidance.micro'] = 'live-data-unavailable'
        unavailable['coach.track.cooldowns'] = 'live-data-unavailable'
      }
    }

    // 6. 版本锁定的英雄头像模板模型只有在 Worker 完成 SHA-256 校验并报告就绪后才能启用。
    if (!this._isIdentityModelLoaded) {
      unavailable['coach.analyze.minimap-identity'] = 'capability-disabled'
    }

    // 6.1 音频提示音执行器就绪判定（Windows 环境启用系统 Earcon 音效）
    if (!this._isSoundAvailable) {
      unavailable['coach.output.sound'] = 'capability-disabled'
    }

    if (!this._isTtsAvailable) {
      unavailable['coach.output.tts'] = 'speech-unavailable'
    }

    // 6.2 用户可见的独立能力开关。关闭后能力快照必须同步反映，相关控制器据此立即停用。
    if (this._context.settings.fogInferenceEnabled === false) {
      unavailable['coach.analyze.fog-inference'] = 'capability-disabled'
    }
    if (this._context.settings.itemGuidanceEnabled === false) {
      unavailable['coach.guidance.item-purchase'] = 'capability-disabled'
    }
    if (this._context.settings.cooldownTrackingEnabled === false) {
      unavailable['coach.track.cooldowns'] = 'capability-disabled'
    }
    if (this._context.settings.communicationAssistEnabled === false) {
      unavailable['coach.communication.ping'] = 'capability-disabled'
      unavailable['coach.communication.chat'] = 'capability-disabled'
    }

    if (realtimeDisabledByUser) {
      for (const capabilityId of REALTIME_CAPABILITIES) {
        unavailable[capabilityId] = 'capability-disabled'
      }
      unavailable['live-game-data'] = 'capability-disabled'
    }

    // 7. Public 构建通道 Gate A / Gate B 门禁评估（严格依据技术决策冻结文档）
    if (this._buildChannel === 'public') {
      if (!this._gateAEnabled) {
        // Gate A: 实时采集与实时分析能力（含装备指导）
        unavailable['coach.capture.screen'] = 'capability-disabled'
        unavailable['coach.analyze.minimap-basic'] = 'capability-disabled'
        unavailable['coach.analyze.minimap-advanced'] = 'capability-disabled'
        unavailable['coach.analyze.minimap-identity'] = 'capability-disabled'
        unavailable['coach.analyze.fog-inference'] = 'capability-disabled'
        unavailable['coach.guidance.item-purchase'] = 'capability-disabled'
        unavailable['coach.guidance.micro'] = 'capability-disabled'
        unavailable['coach.track.cooldowns'] = 'capability-disabled'
        unavailable['coach.communication.ping'] = 'capability-disabled'
        unavailable['coach.communication.chat'] = 'capability-disabled'
      }
      if (!this._gateBEnabled) {
        // Gate B: 实时字幕、声音、语音、提示等实时输出能力
        unavailable['coach.output.subtitle'] = 'capability-disabled'
        unavailable['coach.output.sound'] = 'capability-disabled'
        unavailable['coach.output.tts'] = 'capability-disabled'
      }
    }

    // Consent is a main-process hard gate. It is applied last so neither an internal build,
    // a valid signed policy nor a stale persisted `enabled=true` can overwrite the stable reason.
    if (!consentGranted) {
      unavailable['all'] = LIVE_COACH_CONSENT_REQUIRED_REASON
      unavailable['live-game-data'] = LIVE_COACH_CONSENT_REQUIRED_REASON
      for (const capabilityId of PHASE_ONE_CAPABILITY_IDS) {
        unavailable[capabilityId] = LIVE_COACH_CONSENT_REQUIRED_REASON
      }
    }

    // 8. 候选能力列表与动态就绪判定
    for (const cap of PHASE_ONE_CAPABILITY_IDS) {
      if (!unavailable[cap]) {
        enabledFeatureIds.push(cap)
      }
    }

    if (!unavailable['live-game-data']) {
      enabledFeatureIds.push('live-game-data')
    }
    if (consentGranted) {
      enabledFeatureIds.push('rule-engine')
    }
    if (!unavailable['coach.output.tts']) {
      enabledFeatureIds.push('local-speech')
    }
    if (!unavailable['coach.capture.screen']) {
      enabledFeatureIds.push('minimap-observer')
    }

    this._commitCapabilities(enabledFeatureIds, unavailable)
  }

  private _evaluatePolicyRule(
    rule: LiveCoachCapabilityRule,
    policy: LiveCoachCapabilityPayload,
    mapId: number | null,
    queueId: number | null,
    patch: string | null
  ): CoachUnavailableReason | null {
    if (!rule.enabled) {
      return 'capability-disabled'
    }
    if (rule.supportedPlatforms && !rule.supportedPlatforms.includes(process.platform as any)) {
      return 'unsupported-platform'
    }
    if (
      rule.supportedRegions &&
      (!this._runtimeRegionId || !rule.supportedRegions.includes(this._runtimeRegionId))
    ) {
      return 'unsupported-region'
    }
    if (mapId !== null && rule.supportedMaps && !rule.supportedMaps.includes(mapId)) {
      return 'unsupported-map'
    }
    if (
      mapId !== null &&
      rule.supportedQueues &&
      (queueId === null || queueId < 0 || !rule.supportedQueues.includes(queueId))
    ) {
      return 'unsupported-queue'
    }
    if (rule.minPatch || rule.maxPatch) {
      if (!patch || patch === 'unknown') {
        return 'unsupported-patch'
      }
      if (rule.minPatch && comparePatchVersions(patch, rule.minPatch) < 0) {
        return 'unsupported-patch'
      }
      if (rule.maxPatch && comparePatchVersions(patch, rule.maxPatch) > 0) {
        return 'unsupported-patch'
      }
    }
    for (const modelId of rule.requiredModels ?? []) {
      const expected = policy.models[modelId]
      const actual = this._loadedModels.get(modelId)
      if (
        !expected ||
        !actual ||
        actual.version !== expected.version ||
        actual.sha256 !== expected.sha256
      ) {
        return 'capability-disabled'
      }
    }
    return null
  }

  private _commitCapabilities(
    enabledFeatureIds: string[],
    unavailable: Record<string, CoachUnavailableReason>
  ): void {
    const previous = new Set(this._context.state.capability.enabledFeatureIds)
    const next = new Set(enabledFeatureIds)
    const disabledCapabilities = Array.from(previous).filter(
      (id): id is CoachCapabilityId =>
        PHASE_ONE_CAPABILITY_IDS.includes(id as CoachCapabilityId) && !next.has(id)
    )
    const gateAClosed = previous.has('coach.capture.screen') && !next.has('coach.capture.screen')
    const gateBClosed =
      Array.from(GATE_B_CAPABILITIES).some((id) => previous.has(id)) &&
      Array.from(GATE_B_CAPABILITIES).every((id) => !next.has(id))
    this._context.state.setCapability(enabledFeatureIds, unavailable)

    if (disabledCapabilities.length > 0) {
      this._invokeCapabilitiesDisabled(disabledCapabilities)
    }
    if (gateAClosed) {
      this._invokeSafely(this.onGateADisabled)
    }
    if (gateBClosed) {
      this._invokeSafely(this.onGateBDisabled)
    }
  }

  private _invokeCapabilitiesDisabled(capabilityIds: CoachCapabilityId[]): void {
    try {
      this.onCapabilitiesDisabled?.(capabilityIds)
    } catch {
      // Selective cleanup must not prevent the capability snapshot from closing.
    }
  }

  private _invokeSafely(callback: (() => void) | null): void {
    try {
      callback?.()
    } catch {
      // A shutdown callback must not prevent the capability snapshot from closing.
    }
  }
}
