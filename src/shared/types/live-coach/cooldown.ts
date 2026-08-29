import { z } from 'zod'

export type CoachCooldownKind =
  'ability' | 'summoner-spell' | 'ultimate' | 'ward' | 'jungle-camp' | 'objective'

export type CoachCooldownSource =
  'official-api' | 'visible-screen' | 'user-recorded' | 'model-estimate'

export interface CoachCooldownRecord {
  id: string
  sessionId: string
  kind: CoachCooldownKind
  label: string
  ownerTeam: 'self' | 'ally' | 'enemy' | 'neutral' | 'unknown'
  championId: number | null
  source: CoachCooldownSource
  confidence: number
  observedAt: number
  earliestReadyAt: number
  latestReadyAt: number
  status: 'running' | 'ready' | 'cancelled'
  evidenceIds: string[]
}

export interface RecordUserCooldownRequest {
  kind: Exclude<CoachCooldownKind, 'objective'>
  label: string
  ownerTeam: CoachCooldownRecord['ownerTeam']
  championId?: number | null
  durationSeconds: number
  uncertaintySeconds?: number
}

export const coachCooldownKindSchema = z.enum([
  'ability',
  'summoner-spell',
  'ultimate',
  'ward',
  'jungle-camp',
  'objective'
])

export const coachCooldownSourceSchema = z.enum([
  'official-api',
  'visible-screen',
  'user-recorded',
  'model-estimate'
])

export const coachCooldownRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  kind: coachCooldownKindSchema,
  label: z.string().min(1).max(64),
  ownerTeam: z.enum(['self', 'ally', 'enemy', 'neutral', 'unknown']),
  championId: z.number().int().positive().nullable(),
  source: coachCooldownSourceSchema,
  confidence: z.number().min(0).max(1),
  observedAt: z.number().min(0),
  earliestReadyAt: z.number().min(0),
  latestReadyAt: z.number().min(0),
  status: z.enum(['running', 'ready', 'cancelled']),
  evidenceIds: z.array(z.string())
})

export const recordUserCooldownRequestSchema = z.object({
  kind: z.enum(['ability', 'summoner-spell', 'ultimate', 'ward', 'jungle-camp']),
  label: z.string().trim().min(1).max(64),
  ownerTeam: z.enum(['self', 'ally', 'enemy', 'neutral', 'unknown']),
  championId: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().min(1).max(1800),
  uncertaintySeconds: z.number().min(0).max(300).optional()
})
