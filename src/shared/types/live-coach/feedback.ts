import { z } from 'zod'

export const coachFeedbackTypeSchema = z.enum([
  'useful',
  'not-useful',
  'incorrect',
  'late',
  'too-frequent'
])

export type CoachFeedbackType = z.infer<typeof coachFeedbackTypeSchema>

export const submitCoachFeedbackSchema = z.object({
  cueId: z.string().min(1).max(160),
  type: coachFeedbackTypeSchema,
  comment: z.string().trim().max(500).optional()
})

export type SubmitCoachFeedback = z.infer<typeof submitCoachFeedbackSchema>

export const coachFeedbackRecordSchema = z.object({
  id: z.string(),
  cueId: z.string(),
  sessionId: z.string(),
  ruleId: z.string(),
  ruleVersion: z.string(),
  evidenceIds: z.array(z.string()),
  type: coachFeedbackTypeSchema,
  comment: z.string().nullable(),
  status: z.enum(['active', 'withdrawn']),
  createdAt: z.number(),
  withdrawnAt: z.number().nullable()
})

export type CoachFeedbackRecord = z.infer<typeof coachFeedbackRecordSchema>

export const coachFeedbackDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  feedback: z.array(coachFeedbackRecordSchema)
})

export type CoachFeedbackDocument = z.infer<typeof coachFeedbackDocumentSchema>
