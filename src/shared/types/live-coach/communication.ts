import { z } from 'zod'

export type CoachCommunicationKind =
  'missing' | 'resource' | 'retreat' | 'push' | 'group' | 'danger'

export type CoachCommunicationTemplates = Record<CoachCommunicationKind, string>
export type CoachCommunicationCategorySettings = Record<CoachCommunicationKind, boolean>

export interface CoachCommunicationAuditRecord {
  id: string
  sessionId: string
  cueId: string
  optionId: string
  kind: CoachCommunicationKind
  action: 'copied' | 'sent' | 'blocked'
  channel: 'ping' | 'chat'
  message: string
  reason: string | null
  createdAt: number
}

export const coachCommunicationKindSchema = z.enum([
  'missing',
  'resource',
  'retreat',
  'push',
  'group',
  'danger'
])

export const coachCommunicationTemplatesSchema = z.object({
  missing: z.string().trim().min(1).max(80),
  resource: z.string().trim().min(1).max(80),
  retreat: z.string().trim().min(1).max(80),
  push: z.string().trim().min(1).max(80),
  group: z.string().trim().min(1).max(80),
  danger: z.string().trim().min(1).max(80)
})

export const coachCommunicationCategorySettingsSchema = z.object({
  missing: z.boolean(),
  resource: z.boolean(),
  retreat: z.boolean(),
  push: z.boolean(),
  group: z.boolean(),
  danger: z.boolean()
})

export const coachCommunicationAuditRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  cueId: z.string(),
  optionId: z.string(),
  kind: coachCommunicationKindSchema,
  action: z.enum(['copied', 'sent', 'blocked']),
  channel: z.enum(['ping', 'chat']),
  message: z.string(),
  reason: z.string().nullable(),
  createdAt: z.number().min(0)
})
