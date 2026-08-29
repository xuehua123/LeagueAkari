import {
  CoachCooldownKind,
  CoachCooldownRecord,
  CoachCooldownSource,
  CoachEvidence,
  RecordUserCooldownRequest
} from '@shared/types/live-coach'
import { LiveGameSnapshot, NormalizedGameEvent } from '@shared/types/live-game-data'
import { randomUUID } from 'node:crypto'

import type { LiveCoachMainContext } from './context'

const READY_RETENTION_MS = 15_000

interface RecordCooldownParams {
  id: string
  sessionId: string
  kind: CoachCooldownKind
  label: string
  ownerTeam: CoachCooldownRecord['ownerTeam']
  championId: number | null
  source: CoachCooldownSource
  confidence: number
  observedAt: number
  earliestReadyAt: number
  latestReadyAt: number
  evidenceIds: string[]
}

function getEventKey(event: NormalizedGameEvent): string {
  return event.eventId > 0
    ? String(event.eventId)
    : `${event.eventName}:${event.eventTime}:${JSON.stringify(event.payload)}`
}

function getObjectiveRespawn(event: NormalizedGameEvent): {
  label: string
  durationSeconds: number
} | null {
  switch (event.eventName) {
    case 'DragonKill':
      if (
        String(event.payload.DragonType ?? '')
          .toLowerCase()
          .includes('elder')
      ) {
        return null
      }
      return { label: '巨龙', durationSeconds: 300 }
    case 'BaronKill':
      return { label: '纳什男爵', durationSeconds: 360 }
    default:
      return null
  }
}

export class CooldownTrackerController {
  private readonly _records = new Map<string, CoachCooldownRecord>()
  private readonly _seenEventKeys = new Set<string>()

  public onEvidence: ((evidence: CoachEvidence) => void) | null = null

  constructor(private readonly _context: LiveCoachMainContext) {}

  public reset(): void {
    this._records.clear()
    this._seenEventKeys.clear()
    this._context.state.setCooldowns([])
  }

  public syncFromSnapshot(snapshot: LiveGameSnapshot, now: number = Date.now()): void {
    if (!snapshot.sessionId || snapshot.sessionId !== this._context.state.session.id) return

    const gameTime = snapshot.gameTimeSeconds
    if (gameTime !== null) {
      for (const event of snapshot.events) {
        const key = getEventKey(event)
        if (this._seenEventKeys.has(key)) continue
        this._seenEventKeys.add(key)

        const objective = getObjectiveRespawn(event)
        if (!objective) continue
        const readyGameTime = event.eventTime + objective.durationSeconds
        const readyAt = snapshot.clock.observedAt + (readyGameTime - gameTime) * 1000
        if (readyAt + READY_RETENTION_MS <= now) continue

        const evidenceId = `evi_cooldown_objective_${key.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`
        this._record({
          id: `cooldown_objective_${key.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`,
          sessionId: snapshot.sessionId,
          kind: 'objective',
          label: objective.label,
          ownerTeam: 'neutral',
          championId: null,
          source: 'official-api',
          confidence: 1,
          observedAt: snapshot.clock.observedAt,
          earliestReadyAt: readyAt,
          latestReadyAt: readyAt,
          evidenceIds: [evidenceId]
        })
      }
    }

    this._publish(now)
  }

  public recordUserCooldown(
    request: RecordUserCooldownRequest,
    now: number = Date.now()
  ): CoachCooldownRecord {
    const sessionId = this._context.state.session.id
    if (!sessionId || this._context.state.session.state !== 'active') {
      throw new Error('当前没有可记录计时的进行中教练会话')
    }

    const uncertaintyMs = Math.max(0, request.uncertaintySeconds ?? 0) * 1000
    const readyAt = now + request.durationSeconds * 1000
    const id = `cooldown_user_${randomUUID()}`
    const evidenceId = `evi_${id}`
    const record = this._record({
      id,
      sessionId,
      kind: request.kind,
      label: request.label,
      ownerTeam: request.ownerTeam,
      championId: request.championId ?? null,
      source: 'user-recorded',
      confidence: uncertaintyMs === 0 ? 1 : Math.max(0.5, 1 - uncertaintyMs / 300_000),
      observedAt: now,
      earliestReadyAt: Math.max(now, readyAt - uncertaintyMs),
      latestReadyAt: readyAt + uncertaintyMs,
      evidenceIds: [evidenceId]
    })

    this._context.state.setCooldowns(this.list(now))
    return record
  }

  public cancel(recordId: string, now: number = Date.now()): boolean {
    const record = this._records.get(recordId)
    if (!record) return false
    this._records.set(recordId, { ...record, status: 'cancelled' })
    this._publish(now)
    return true
  }

  public list(now: number = Date.now()): CoachCooldownRecord[] {
    const records: CoachCooldownRecord[] = []
    for (const [id, record] of this._records.entries()) {
      if (record.status === 'cancelled' || record.latestReadyAt + READY_RETENTION_MS <= now) {
        this._records.delete(id)
        continue
      }
      records.push({
        ...record,
        status: record.earliestReadyAt <= now ? 'ready' : 'running'
      })
    }
    return records.sort((left, right) => left.earliestReadyAt - right.earliestReadyAt)
  }

  private _record(params: RecordCooldownParams): CoachCooldownRecord {
    const record: CoachCooldownRecord = {
      ...params,
      earliestReadyAt: Math.min(params.earliestReadyAt, params.latestReadyAt),
      latestReadyAt: Math.max(params.earliestReadyAt, params.latestReadyAt),
      confidence: Math.max(0, Math.min(1, params.confidence)),
      status: 'running'
    }
    this._records.set(record.id, record)
    const evidenceId = record.evidenceIds[0]
    if (evidenceId) {
      this.onEvidence?.({
        id: evidenceId,
        sessionId: record.sessionId,
        temporalScope: 'current',
        source: record.source === 'user-recorded' ? 'user-input' : 'live-client-data',
        kind: 'cooldown-timing',
        confidence: record.confidence,
        patch: this._context.state.session.patch || 'unknown',
        clock: { observedAt: record.observedAt, receivedAt: record.observedAt, sequence: 1 },
        freshness: {
          expiresAt: record.latestReadyAt + READY_RETENTION_MS,
          state: 'fresh'
        },
        payload: record
      })
    }
    return record
  }

  private _publish(now: number): void {
    this._context.state.setCooldowns(this.list(now))
  }
}
