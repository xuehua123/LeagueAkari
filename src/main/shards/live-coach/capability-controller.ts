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

  public evaluateCapabilities(
    mapId: number | null,
    _queueId: number | null = null,
    _patch: string | null = null
  ): void {
    const enabledFeatureIds: string[] = []
    const unavailable: Record<string, CoachUnavailableReason> = {}

    if (!this._context.settings.enabled) {
      unavailable['all'] = 'capability-disabled'
      this._context.state.setCapability([], unavailable)
      return
    }

    if (process.platform !== 'win32') {
      unavailable['platform'] = 'unsupported-platform'
      this._context.state.setCapability([], unavailable)
      return
    }

    // Summoner's Rift Map 11
    if (mapId !== null && mapId !== 11) {
      unavailable['map'] = 'unsupported-map'
      this._context.state.setCapability([], unavailable)
      return
    }

    if (this._buildChannel === 'public' && (!this._gateAEnabled || !this._gateBEnabled)) {
      unavailable['gate'] = 'capability-disabled'
      this._context.state.setCapability([], unavailable)
      return
    }

    // 注册 Phase 1 全部就绪能力 ID
    const phase1Capabilities: CoachCapabilityId[] = [
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

    enabledFeatureIds.push(...phase1Capabilities)
    enabledFeatureIds.push('minimap-observer', 'live-game-data', 'rule-engine', 'local-speech')

    this._context.state.setCapability(enabledFeatureIds, {})
  }

  public setGates(gateA: boolean, gateB: boolean) {
    this._gateAEnabled = gateA
    this._gateBEnabled = gateB
  }
}
