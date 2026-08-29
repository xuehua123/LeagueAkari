import { z } from 'zod'

export const coachErrorCodeSchema = z.enum([
  'unsupported-platform',
  'unsupported-map',
  'unsupported-queue',
  'unsupported-patch',
  'capability-disabled',
  'consent-required',
  'capture-target-not-found',
  'capture-permission-denied',
  'capture-black-frame',
  'capture-stalled',
  'capture-crash-loop',
  'calibration-required',
  'roi-occluded',
  'cv-overloaded',
  'live-data-unavailable',
  'speech-unavailable',
  'microphone-unavailable',
  'asr-low-confidence',
  'provider-credential-missing',
  'provider-timeout',
  'provider-rate-limited',
  'provider-region-unavailable',
  'budget-exhausted',
  'response-rejected',
  'storage-unavailable',
  'internal-error'
])

export type CoachErrorCode = z.infer<typeof coachErrorCodeSchema>

export interface CoachPublicError {
  code: CoachErrorCode
  stage: string
  recoverable: boolean
  occurredAt: number
  details?: string | null
}

export const coachPublicErrorSchema = z.object({
  code: coachErrorCodeSchema,
  stage: z.string().min(1).max(128),
  recoverable: z.boolean(),
  occurredAt: z.number().int().min(0),
  details: z.string().max(500).nullish()
})
