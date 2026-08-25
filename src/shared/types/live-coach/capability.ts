import { z } from 'zod'

export interface LiveCoachCapabilityRule {
  id: string
  version: string
  enabled: boolean
  minPatch?: string
  maxPatch?: string
  supportedQueues?: number[]
}

export interface LiveCoachCapabilityPayload {
  schemaVersion: 1
  generation: number
  issuedAt: string
  expiresAt: string
  killSwitch: boolean
  rules: LiveCoachCapabilityRule[]
  models: Record<string, { version: string; sha256: string; url: string }>
}

export interface LiveCoachCapabilityEnvelope {
  keyId: string
  payloadBase64: string
  signatureBase64: string
}

export type CoachUnavailableReason =
  | 'unsupported-platform'
  | 'unsupported-map'
  | 'unsupported-queue'
  | 'unsupported-patch'
  | 'capability-disabled'
  | 'consent-required'
  | 'capture-target-not-found'
  | 'capture-permission-denied'
  | 'capture-black-frame'
  | 'capture-stalled'
  | 'calibration-required'
  | 'roi-occluded'
  | 'live-data-unavailable'
  | 'speech-unavailable'
  | 'internal-error'

export const liveCoachCapabilityRuleSchema = z.object({
  id: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  minPatch: z.string().optional(),
  maxPatch: z.string().optional(),
  supportedQueues: z.array(z.number()).optional()
})

export const liveCoachCapabilityPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  generation: z.number(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  killSwitch: z.boolean(),
  rules: z.array(liveCoachCapabilityRuleSchema),
  models: z.record(
    z.string(),
    z.object({
      version: z.string(),
      sha256: z.string(),
      url: z.string()
    })
  )
})

export const liveCoachCapabilityEnvelopeSchema = z.object({
  keyId: z.string(),
  payloadBase64: z.string(),
  signatureBase64: z.string()
})
