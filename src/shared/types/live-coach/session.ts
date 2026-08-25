import { z } from 'zod'

import { CoachUnavailableReason } from './capability'
import { CoachCuePublicDto, coachCuePublicDtoSchema } from './cue'
import { CoachPublicError } from './error'

export type CoachSessionState =
  | 'disabled'
  | 'idle'
  | 'awaiting-game'
  | 'starting'
  | 'calibrating'
  | 'shadow'
  | 'active'
  | 'paused'
  | 'degraded'
  | 'ending'
  | 'completed'

export interface CoachConversationPublicDto {
  conversationId: string | null
  state:
    | 'idle'
    | 'listening'
    | 'transcribing'
    | 'understanding'
    | 'grounding'
    | 'generating'
    | 'validating'
    | 'speaking'
    | 'completed'
    | 'cancelling'
    | 'cancelled'
  userTranscript: string | null
  aiResponse: string | null
}

export interface LiveCoachPublicState {
  session: {
    id: string | null
    state: CoachSessionState
    mapId: number | null
    queueId: number | null
    patch: string | null
    startedAt: number | null
  }
  capability: {
    enabledFeatureIds: string[]
    unavailable: Record<string, CoachUnavailableReason>
  }
  capture: {
    state: string
    backend: string | null
    fps: number
    frameAgeMs: number | null
    roiState: string
  }
  liveData: {
    state: string
    lastSuccessAt: number | null
  }
  cue: CoachCuePublicDto | null
  speech: {
    state: 'idle' | 'speaking' | 'muted' | 'unavailable'
    cueId: string | null
  }
  conversation: CoachConversationPublicDto
  lastError: CoachPublicError | null
}

export const coachSessionStateSchema = z.enum([
  'disabled',
  'idle',
  'awaiting-game',
  'starting',
  'calibrating',
  'shadow',
  'active',
  'paused',
  'degraded',
  'ending',
  'completed'
])

export const coachConversationPublicDtoSchema = z.object({
  conversationId: z.string().nullable(),
  state: z.enum([
    'idle',
    'listening',
    'transcribing',
    'understanding',
    'grounding',
    'generating',
    'validating',
    'speaking',
    'completed',
    'cancelling',
    'cancelled'
  ]),
  userTranscript: z.string().nullable(),
  aiResponse: z.string().nullable()
})

export const liveCoachPublicStateSchema = z.object({
  session: z.object({
    id: z.string().nullable(),
    state: coachSessionStateSchema,
    mapId: z.number().nullable(),
    queueId: z.number().nullable(),
    patch: z.string().nullable(),
    startedAt: z.number().nullable()
  }),
  capability: z.object({
    enabledFeatureIds: z.array(z.string()),
    unavailable: z.record(z.string(), z.string() as unknown as z.ZodType<CoachUnavailableReason>)
  }),
  capture: z.object({
    state: z.string(),
    backend: z.string().nullable(),
    fps: z.number(),
    frameAgeMs: z.number().nullable(),
    roiState: z.string()
  }),
  liveData: z.object({
    state: z.string(),
    lastSuccessAt: z.number().nullable()
  }),
  cue: coachCuePublicDtoSchema.nullable(),
  speech: z.object({
    state: z.enum(['idle', 'speaking', 'muted', 'unavailable']),
    cueId: z.string().nullable()
  }),
  conversation: coachConversationPublicDtoSchema,
  lastError: z
    .object({
      code: z.string() as any,
      stage: z.string(),
      recoverable: z.boolean(),
      occurredAt: z.number(),
      details: z.string().nullish()
    })
    .nullable()
})
