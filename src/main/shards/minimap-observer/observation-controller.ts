import { MinimapObservationBatch } from '@shared/types/live-coach'

import type { MinimapObserverMainContext } from './context'

export class MinimapObservationController {
  constructor(private readonly _context: MinimapObserverMainContext) {}

  public handleObservationBatch(batch: MinimapObservationBatch): void {
    const age = batch.frame.ageMs
    this._context.state.setFrameAgeMs(age)
    this._context.state.setRoiHealth(batch.health === 'healthy' ? 'healthy' : 'degraded')

    // Update LiveCoach public capture state
    this._context.liveCoach.state.setCaptureState({
      state: 'running',
      backend: this._context.state.backend,
      fps: this._context.state.fps,
      frameAgeMs: age,
      roiState: batch.health
    })

    // Forward to LiveCoach Fact Fusion Engine via typed public API
    this._context.liveCoach.feedMinimapObservationBatch(batch)
  }
}
