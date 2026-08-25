import { z } from 'zod'

import { CoachClock, coachClockSchema } from './evidence'

export type ObservationLifecycle = 'candidate' | 'confirmed' | 'invalidated' | 'expired' | 'unknown'

export type MinimapEntityKind =
  'self' | 'ally' | 'enemy' | 'ping' | 'ward' | 'minion-wave' | 'objective-marker'

export interface NormalizedMapPoint {
  x: number
  y: number
}

export interface MinimapEntityObservation {
  trackId: string
  kind: MinimapEntityKind
  team: 'ally' | 'enemy' | 'neutral' | 'unknown'
  championId: number | null
  point: NormalizedMapPoint
  regionId: string | null
  confidence: number
  lifecycle: ObservationLifecycle
  firstObservedAt: number
  lastObservedAt: number
  expiresAt: number
}

export interface MinimapDerivedEvent {
  eventId: string
  kind: string
  timestamp: number
  payload: unknown
}

export interface MinimapObservationBatch {
  sessionId: string
  patch: string
  calibrationVersion: string
  modelVersions: Record<string, string>
  frame: CoachClock & { ageMs: number }
  health: 'healthy' | 'degraded' | 'unknown'
  entities: MinimapEntityObservation[]
  events: MinimapDerivedEvent[]
}

export const observationLifecycleSchema = z.enum([
  'candidate',
  'confirmed',
  'invalidated',
  'expired',
  'unknown'
])

export const minimapEntityKindSchema = z.enum([
  'self',
  'ally',
  'enemy',
  'ping',
  'ward',
  'minion-wave',
  'objective-marker'
])

export const normalizedMapPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1)
})

export const minimapEntityObservationSchema = z.object({
  trackId: z.string(),
  kind: minimapEntityKindSchema,
  team: z.enum(['ally', 'enemy', 'neutral', 'unknown']),
  championId: z.number().nullable(),
  point: normalizedMapPointSchema,
  regionId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  lifecycle: observationLifecycleSchema,
  firstObservedAt: z.number(),
  lastObservedAt: z.number(),
  expiresAt: z.number()
})

export const minimapDerivedEventSchema = z.object({
  eventId: z.string(),
  kind: z.string(),
  timestamp: z.number(),
  payload: z.unknown()
})

export const minimapObservationBatchSchema = z.object({
  sessionId: z.string(),
  patch: z.string(),
  calibrationVersion: z.string(),
  modelVersions: z.record(z.string(), z.string()),
  frame: coachClockSchema.extend({ ageMs: z.number() }),
  health: z.enum(['healthy', 'degraded', 'unknown']),
  entities: z.array(minimapEntityObservationSchema),
  events: z.array(minimapDerivedEventSchema)
})
