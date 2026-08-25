import { z } from 'zod'

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
