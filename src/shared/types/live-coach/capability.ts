import { z } from 'zod'

export type LiveCoachBuildChannel = 'internal' | 'public'

export type CoachCapabilityId =
  | 'coach.offline-review'
  | 'coach.capture.screen'
  | 'coach.analyze.minimap-basic'
  | 'coach.analyze.minimap-advanced'
  | 'coach.analyze.minimap-identity'
  | 'coach.analyze.fog-inference'
  | 'coach.guidance.item-purchase'
  | 'coach.guidance.micro'
  | 'coach.track.cooldowns'
  | 'coach.communication.ping'
  | 'coach.communication.chat'
  | 'coach.analyze.screen-multimodal'
  | 'coach.output.shot-calling'
  | 'coach.output.subtitle'
  | 'coach.output.sound'
  | 'coach.output.tts'
  | 'coach.qa.text'
  | 'coach.qa.microphone'
  | 'coach.qa.wake-word'
  | 'coach.qa.voice-analysis'
  | 'coach.qa.cloud-asr'
  | 'coach.qa.cloud-llm'
  | 'coach.qa.cloud-tts'
  | 'coach.history.sgp'
  | 'coach.profile.longitudinal'
  | 'coach.training.leaderboard'
  | 'coach.data.sample-upload'
  | 'coach.mode.aram'
  | 'coach.mode.arena'
  | 'coach.mode.rotating'
  | 'coach.mode.spectator'

export interface LiveCoachCapabilityRule {
  id: CoachCapabilityId | string
  version: string
  enabled: boolean
  supportedPlatforms?: Array<'win32' | 'darwin'>
  supportedRegions?: string[]
  supportedMaps?: number[]
  minPatch?: string
  maxPatch?: string
  supportedQueues?: number[]
  requiredModels?: string[]
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

export type LiveCoachCapabilitySnapshotStatus =
  | 'unavailable'
  | 'valid'
  | 'invalid-envelope'
  | 'unknown-key'
  | 'invalid-signature'
  | 'invalid-payload'
  | 'expired'
  | 'generation-rollback'
  | 'clock-anomaly'

export type CoachUnavailableReason =
  | 'unsupported-platform'
  | 'unsupported-map'
  | 'unsupported-queue'
  | 'unsupported-region'
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

export const coachCapabilityIdSchema = z.enum([
  'coach.offline-review',
  'coach.capture.screen',
  'coach.analyze.minimap-basic',
  'coach.analyze.minimap-advanced',
  'coach.analyze.minimap-identity',
  'coach.analyze.fog-inference',
  'coach.guidance.item-purchase',
  'coach.guidance.micro',
  'coach.track.cooldowns',
  'coach.communication.ping',
  'coach.communication.chat',
  'coach.analyze.screen-multimodal',
  'coach.output.shot-calling',
  'coach.output.subtitle',
  'coach.output.sound',
  'coach.output.tts',
  'coach.qa.text',
  'coach.qa.microphone',
  'coach.qa.wake-word',
  'coach.qa.voice-analysis',
  'coach.qa.cloud-asr',
  'coach.qa.cloud-llm',
  'coach.qa.cloud-tts',
  'coach.history.sgp',
  'coach.profile.longitudinal',
  'coach.training.leaderboard',
  'coach.data.sample-upload',
  'coach.mode.aram',
  'coach.mode.arena',
  'coach.mode.rotating',
  'coach.mode.spectator'
])

const uniqueNonEmptyStringArraySchema = z
  .array(z.string().trim().min(1).max(128))
  .min(1)
  .refine((values) => new Set(values).size === values.length, 'values must be unique')

const uniqueNonNegativeIntegerArraySchema = z
  .array(z.number().int().nonnegative())
  .min(1)
  .refine((values) => new Set(values).size === values.length, 'values must be unique')

const patchVersionSchema = z.string().regex(/^\d+\.\d+(?:\.\d+)?$/)

export const liveCoachCapabilityRuleSchema: z.ZodType<LiveCoachCapabilityRule> = z
  .object({
    id: z.string().trim().min(1).max(128),
    version: z.string().trim().min(1).max(64),
    enabled: z.boolean(),
    supportedPlatforms: z
      .array(z.enum(['win32', 'darwin']))
      .min(1)
      .refine((values) => new Set(values).size === values.length, 'values must be unique')
      .optional(),
    supportedRegions: uniqueNonEmptyStringArraySchema.optional(),
    supportedMaps: uniqueNonNegativeIntegerArraySchema.optional(),
    minPatch: patchVersionSchema.optional(),
    maxPatch: patchVersionSchema.optional(),
    supportedQueues: uniqueNonNegativeIntegerArraySchema.optional(),
    requiredModels: uniqueNonEmptyStringArraySchema.optional()
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.minPatch && rule.maxPatch && comparePatchVersions(rule.minPatch, rule.maxPatch) > 0) {
      context.addIssue({
        code: 'custom',
        path: ['maxPatch'],
        message: 'maxPatch must be greater than or equal to minPatch'
      })
    }
  })

export const liveCoachCapabilityPayloadSchema: z.ZodType<LiveCoachCapabilityPayload> = z
  .object({
    schemaVersion: z.literal(1),
    generation: z.number().int().nonnegative(),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    killSwitch: z.boolean(),
    rules: z
      .array(liveCoachCapabilityRuleSchema)
      .max(256)
      .refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length, {
        message: 'capability ids must be unique'
      }),
    models: z.record(
      z.string().trim().min(1).max(128),
      z
        .object({
          version: z.string().trim().min(1).max(64),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          url: z.url().refine((value) => new URL(value).protocol === 'https:', {
            message: 'model URL must use HTTPS'
          })
        })
        .strict()
    )
  })
  .strict()
  .superRefine((payload, context) => {
    if (Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'expiresAt must be later than issuedAt'
      })
    }

    const modelIds = new Set(Object.keys(payload.models))
    payload.rules.forEach((rule, ruleIndex) => {
      rule.requiredModels?.forEach((modelId, modelIndex) => {
        if (!modelIds.has(modelId)) {
          context.addIssue({
            code: 'custom',
            path: ['rules', ruleIndex, 'requiredModels', modelIndex],
            message: `unknown model id: ${modelId}`
          })
        }
      })
    })
  })

export const liveCoachCapabilityEnvelopeSchema: z.ZodType<LiveCoachCapabilityEnvelope> = z
  .object({
    keyId: z.string().trim().min(1).max(128),
    payloadBase64: z
      .string()
      .trim()
      .min(1)
      .max(2 * 1024 * 1024),
    signatureBase64: z.string().trim().min(1).max(1024)
  })
  .strict()

export function comparePatchVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }

  return 0
}
