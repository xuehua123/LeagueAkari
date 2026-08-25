import { z } from 'zod'

export type CoachTemporalScope = 'current' | 'recorded' | 'historical'

export type CoachEvidenceSource =
  | 'minimap'
  | 'live-client-data'
  | 'lcu-gameflow'
  | 'lcu-history'
  | 'sgp-history'
  | 'minimap-replay'
  | 'replay-sidecar'
  | 'fog-inference'
  | 'item-guidance'
  | 'combat-observer'
  | 'authorized-audio'
  | 'user-input'

export interface CoachClock {
  observedAt: number
  receivedAt: number
  sequence: number
}

export interface CoachFreshness {
  expiresAt: number
  state: 'fresh' | 'stale' | 'expired' | 'unknown'
}

export interface CoachEvidence<TPayload = unknown> {
  id: string
  sessionId: string
  temporalScope: CoachTemporalScope
  source: CoachEvidenceSource
  kind: string
  confidence: number
  patch: string
  clock: CoachClock
  freshness: CoachFreshness
  payload: TPayload
}

export const coachTemporalScopeSchema = z.enum(['current', 'recorded', 'historical'])

export const coachEvidenceSourceSchema = z.enum([
  'minimap',
  'live-client-data',
  'lcu-gameflow',
  'lcu-history',
  'sgp-history',
  'minimap-replay',
  'replay-sidecar',
  'fog-inference',
  'item-guidance',
  'combat-observer',
  'authorized-audio',
  'user-input'
])

export const coachClockSchema = z.object({
  observedAt: z.number(),
  receivedAt: z.number(),
  sequence: z.number()
})

export const coachFreshnessSchema = z.object({
  expiresAt: z.number(),
  state: z.enum(['fresh', 'stale', 'expired', 'unknown'])
})

export const coachEvidenceSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  temporalScope: coachTemporalScopeSchema,
  source: coachEvidenceSourceSchema,
  kind: z.string(),
  confidence: z.number().min(0).max(1),
  patch: z.string(),
  clock: coachClockSchema,
  freshness: coachFreshnessSchema,
  payload: z.unknown()
})
