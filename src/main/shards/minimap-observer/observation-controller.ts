import { MinimapObservationBatch } from '@shared/types/live-coach'

import type { MinimapObserverMainContext } from './context'

const MAX_LIVE_FRAME_AGE_MS = 300

export class MinimapObservationController {
  constructor(private readonly _context: MinimapObserverMainContext) {}

  public handleObservationBatch(batch: MinimapObservationBatch): void {
    const receivedAt = Date.now()
    const deliveryAgeMs = Math.max(0, receivedAt - batch.frame.receivedAt)
    const age = Math.max(0, batch.frame.ageMs + deliveryAgeMs, receivedAt - batch.frame.observedAt)
    const expiredDuringDelivery =
      batch.frame.ageMs <= MAX_LIVE_FRAME_AGE_MS && age > MAX_LIVE_FRAME_AGE_MS
    const freshnessCheckedBatch: MinimapObservationBatch =
      age > MAX_LIVE_FRAME_AGE_MS
        ? {
            ...batch,
            frame: { ...batch.frame, receivedAt, ageMs: age },
            health: 'unknown',
            entities: [],
            events: []
          }
        : { ...batch, frame: { ...batch.frame, receivedAt, ageMs: age } }
    const calibration = this._context.state.currentCalibration
    const calibrationReady =
      calibration?.source === 'manual' || (calibration?.confidence ?? 0) >= 0.65
    const effectiveBatch =
      calibrationReady || freshnessCheckedBatch.health !== 'healthy'
        ? freshnessCheckedBatch
        : { ...freshnessCheckedBatch, health: 'unknown' as const }
    this._context.state.setFrameAgeMs(age)
    this._context.state.setRoiHealth(
      effectiveBatch.health === 'healthy' ? 'healthy' : effectiveBatch.health
    )

    // Update LiveCoach public capture state
    this._context.liveCoach.state.setCaptureState({
      state: 'running',
      backend: this._context.state.backend,
      fps: this._context.state.fps,
      frameAgeMs: age,
      roiState: effectiveBatch.health,
      ...(expiredDuringDelivery
        ? { dropCount: this._context.liveCoach.state.capture.dropCount + 1 }
        : {})
    })

    // Forward to LiveCoach Fact Fusion Engine via typed public API
    this._context.liveCoach.feedMinimapObservationBatch(effectiveBatch)
  }
}
