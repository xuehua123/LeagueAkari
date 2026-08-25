import { z } from 'zod'

export type CoachCueCategory = 'information' | 'warning' | 'opportunity' | 'system' | 'review'

export type CoachCueStatus =
  'pending' | 'speaking' | 'spoken' | 'cancelled' | 'expired' | 'suppressed'

export interface CoachOption {
  id: string
  label: string
  condition: string | null
  evidenceIds: string[]
  role?: 'primary' | 'alternative'
  score?: number
}

export interface CoachCue {
  id: string
  sessionId: string
  ruleId: string
  ruleVersion: string
  category: CoachCueCategory
  priority: number
  observationText: string
  impactText: string | null
  options: CoachOption[]
  spokenText: string
  evidenceIds: string[]
  createdAt: number
  expiresAt: number
  status: CoachCueStatus
  cancellationReason: string | null
}

export interface CoachCuePublicDto {
  id: string
  sessionId: string
  category: CoachCueCategory
  priority: number
  observationText: string
  impactText: string | null
  options: Array<{ id: string; label: string; role?: 'primary' | 'alternative' }>
  spokenText: string
  createdAt: number
  expiresAt: number
  status: CoachCueStatus
}

export const coachCueCategorySchema = z.enum([
  'information',
  'warning',
  'opportunity',
  'system',
  'review'
])

export const coachCueStatusSchema = z.enum([
  'pending',
  'speaking',
  'spoken',
  'cancelled',
  'expired',
  'suppressed'
])

export const coachOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  condition: z.string().nullable(),
  evidenceIds: z.array(z.string()),
  role: z.enum(['primary', 'alternative']).optional(),
  score: z.number().optional()
})

export const coachCueSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  ruleId: z.string(),
  ruleVersion: z.string(),
  category: coachCueCategorySchema,
  priority: z.number().min(0).max(100),
  observationText: z.string(),
  impactText: z.string().nullable(),
  options: z.array(coachOptionSchema).max(2),
  spokenText: z.string(),
  evidenceIds: z.array(z.string()),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: coachCueStatusSchema,
  cancellationReason: z.string().nullable()
})

export const coachCuePublicDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  category: coachCueCategorySchema,
  priority: z.number().min(0).max(100),
  observationText: z.string(),
  impactText: z.string().nullable(),
  options: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      role: z.enum(['primary', 'alternative']).optional()
    })
  ),
  spokenText: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: coachCueStatusSchema
})
