import { CoachCapabilityId, CoachUnavailableReason } from '@shared/types/live-coach'

import type { LiveCoachMainContext } from './context'

export type LiveCoachBuildChannel = 'internal' | 'public'

export class LiveCoachCapabilityController {
  private _buildChannel: LiveCoachBuildChannel = 'internal'
  private _gateAEnabled = true
  private _gateBEnabled = true

  constructor(private readonly _context: LiveCoachMainContext) {}

  public get buildChannel(): LiveCoachBuildChannel {
    return this._buildChannel
  }

  public setBuildChannel(channel: LiveCoachBuildChannel): void {
    this._buildChannel = channel
  }

  public setGates(gateA: boolean, gateB: boolean): void {
    this._gateAEnabled = gateA
    this._gateBEnabled = gateB
  }

  public evaluateCapabilities(
    mapId: number | null,
    _queueId: number | null = null,
    patch: string | null = null,
    workerStatus?: { roiHealth?: string; state?: string }
  ): void {
    const enabledFeatureIds: string[] = []
    const unavailable: Record<string, CoachUnavailableReason> = {}

    // 1. 总开关检查
    if (!this._context.settings.enabled) {
      unavailable['all'] = 'capability-disabled'
      this._context.state.setCapability([], unavailable)
      return
    }

    // 2. 操作系统平台检查
    if (process.platform !== 'win32') {
      unavailable['platform'] = 'unsupported-platform'
      this._context.state.setCapability([], unavailable)
      return
    }

    // 3. 地图支持检查（第一期限定召唤师峡谷 Map 11）
    if (mapId !== null && mapId !== 11) {
      unavailable['map'] = 'unsupported-map'
      unavailable['coach.analyze.minimap-basic'] = 'unsupported-map'
      unavailable['coach.analyze.minimap-advanced'] = 'unsupported-map'
      unavailable['coach.analyze.fog-inference'] = 'unsupported-map'
      this._context.state.setCapability([], unavailable)
      return
    }

    // 4. 补丁检查（支持 Season 14+ 现代版本，如 16.16.1、15.x、14.x）
    if (patch) {
      const major = parseInt(patch.split('.')[0], 10)
      if (Number.isFinite(major) && major < 14) {
        unavailable['patch'] = 'unsupported-patch'
        unavailable['coach.analyze.fog-inference'] = 'unsupported-patch'
        unavailable['coach.guidance.item-purchase'] = 'unsupported-patch'
        unavailable['coach.analyze.minimap-basic'] = 'unsupported-patch'
        unavailable['coach.analyze.minimap-advanced'] = 'unsupported-patch'
      }
    }

    // 5. 采集状态与 ROI 健康检查
    if (
      workerStatus?.roiHealth === 'unknown' ||
      workerStatus?.roiHealth === 'degraded' ||
      workerStatus?.roiHealth === 'occluded'
    ) {
      unavailable['coach.capture.screen'] = 'roi-occluded'
      unavailable['coach.analyze.minimap-basic'] = 'roi-occluded'
      unavailable['coach.analyze.minimap-advanced'] = 'roi-occluded'
      unavailable['coach.analyze.fog-inference'] = 'roi-occluded'
    } else if (workerStatus?.state === 'error' || workerStatus?.state === 'stopped') {
      unavailable['coach.capture.screen'] = 'capture-stalled'
    }

    // 6. Public 构建通道 Gate A / Gate B 门禁评估
    if (this._buildChannel === 'public') {
      if (!this._gateAEnabled) {
        unavailable['coach.analyze.fog-inference'] = 'capability-disabled'
        unavailable['coach.communication.ping'] = 'capability-disabled'
      }
      if (!this._gateBEnabled) {
        unavailable['coach.guidance.item-purchase'] = 'capability-disabled'
      }
    }

    // 7. 候选能力列表与动态就绪判定
    const allPhase1Capabilities: CoachCapabilityId[] = [
      'coach.offline-review',
      'coach.capture.screen',
      'coach.analyze.minimap-basic',
      'coach.analyze.minimap-advanced',
      'coach.analyze.fog-inference',
      'coach.guidance.item-purchase',
      'coach.communication.ping',
      'coach.output.subtitle',
      'coach.output.sound',
      'coach.output.tts'
    ]

    for (const cap of allPhase1Capabilities) {
      if (!unavailable[cap]) {
        enabledFeatureIds.push(cap)
      }
    }

    enabledFeatureIds.push('live-game-data', 'rule-engine', 'local-speech')
    if (!unavailable['coach.capture.screen']) {
      enabledFeatureIds.push('minimap-observer')
    }

    this._context.state.setCapability(enabledFeatureIds, unavailable)
  }
}
