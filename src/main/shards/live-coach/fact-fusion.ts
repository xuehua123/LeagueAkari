import {
  CoachEvidence,
  MinimapEntityObservation,
  MinimapObservationBatch
} from '@shared/types/live-coach'
import { LiveGameSnapshot, NormalizedPlayer } from '@shared/types/live-game-data'

export class FactFusionEngine {
  private readonly _evidences = new Map<string, CoachEvidence>()
  private _latestLiveGameSnapshot: LiveGameSnapshot | null = null
  private _latestMinimapBatch: MinimapObservationBatch | null = null

  public reset(): void {
    this._evidences.clear()
    this._latestLiveGameSnapshot = null
    this._latestMinimapBatch = null
  }

  public updateLiveGameSnapshot(snapshot: LiveGameSnapshot): void {
    this._latestLiveGameSnapshot = snapshot

    // Create evidence for active player state or dead players
    const now = Date.now()
    if (snapshot.activePlayer) {
      this.addEvidence({
        id: `evi_active_player_${now}`,
        sessionId: snapshot.sessionId,
        temporalScope: 'current',
        source: 'live-client-data',
        kind: 'active-player-status',
        confidence: 1,
        patch: snapshot.patch,
        clock: snapshot.clock,
        freshness: {
          expiresAt: now + 3000,
          state: 'fresh'
        },
        payload: snapshot.activePlayer
      })
    }
  }

  public updateMinimapBatch(batch: MinimapObservationBatch): void {
    this._latestMinimapBatch = batch
    const now = Date.now()

    for (const entity of batch.entities) {
      if (entity.lifecycle === 'confirmed' || entity.lifecycle === 'candidate') {
        this.addEvidence({
          id: `evi_minimap_${entity.trackId}_${now}`,
          sessionId: batch.sessionId,
          temporalScope: 'current',
          source: 'minimap',
          kind: `entity-${entity.kind}`,
          confidence: entity.confidence,
          patch: batch.patch,
          clock: {
            observedAt: entity.lastObservedAt,
            receivedAt: now,
            sequence: batch.frame.sequence
          },
          freshness: {
            expiresAt: entity.expiresAt,
            state: 'fresh'
          },
          payload: entity
        })
      }
    }
  }

  public addEvidence(evidence: CoachEvidence): void {
    this._evidences.set(evidence.id, evidence)
  }

  public cleanupExpiredEvidence(now: number = Date.now()): void {
    for (const [id, evi] of this._evidences.entries()) {
      if (evi.freshness.expiresAt <= now) {
        this._evidences.delete(id)
      }
    }
  }

  public getActiveEvidences(): CoachEvidence[] {
    this.cleanupExpiredEvidence()
    return Array.from(this._evidences.values())
  }

  public getLiveGameSnapshot(): LiveGameSnapshot | null {
    return this._latestLiveGameSnapshot
  }

  public getMinimapEntities(): MinimapEntityObservation[] {
    return this._latestMinimapBatch?.entities || []
  }

  public getPlayers(): NormalizedPlayer[] {
    return this._latestLiveGameSnapshot?.players || []
  }

  public getGameTimeSeconds(): number | null {
    return this._latestLiveGameSnapshot?.gameTimeSeconds ?? null
  }
}
