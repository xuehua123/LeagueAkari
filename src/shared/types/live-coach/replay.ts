import { z } from 'zod'

import type { LiveGameSnapshot } from '../live-game-data'
import type { MinimapObservationBatch } from './observation'

export interface CoachReplayFrame {
  timestamp: number
  liveData?: LiveGameSnapshot
  minimap?: MinimapObservationBatch
}

export interface CoachReplaySession {
  metadata: {
    sessionId: string
    patch: string
    recordedAt: number
    durationSeconds: number
    mapId: number
    queueId: number
  }
  frames: CoachReplayFrame[]
}

export interface CoachReplaySidecarV1 {
  schemaVersion: 1
  artifactSha256: string
  patch: string | null
  mapId: number | null
  queueId: number | null
  selfTeam: 'blue' | 'red' | null
  videoGameStartMs: number | null
  roster: Array<{ team: 'blue' | 'red'; championId: number }> | null
  events: Array<{
    videoTimeMs: number
    gameTimeSeconds: number | null
    kind: string
    payload: unknown
  }>
}

export const coachReplaySidecarV1Schema = z.object({
  schemaVersion: z.literal(1),
  artifactSha256: z.string(),
  patch: z.string().nullable(),
  mapId: z.number().nullable(),
  queueId: z.number().nullable(),
  selfTeam: z.enum(['blue', 'red']).nullable(),
  videoGameStartMs: z.number().nullable(),
  roster: z
    .array(
      z.object({
        team: z.enum(['blue', 'red']),
        championId: z.number()
      })
    )
    .nullable(),
  events: z.array(
    z.object({
      videoTimeMs: z.number(),
      gameTimeSeconds: z.number().nullable(),
      kind: z.string(),
      payload: z.unknown()
    })
  )
})
