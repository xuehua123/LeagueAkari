import { CoachUnavailableReason } from '@shared/types/live-coach'

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

    enabledFeatureIds.push('minimap-observer', 'live-client-data', 'rule-engine', 'local-speech')
    this._context.state.setCapability(enabledFeatureIds, {})
  }

  public setGates(gateA: boolean, gateB: boolean) {
    this._gateAEnabled = gateA
    this._gateBEnabled = gateB
  }
}
