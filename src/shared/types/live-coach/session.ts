import { z } from 'zod'

import type { LiveGameSourceHealth } from '../live-game-data'
import { CoachUnavailableReason } from './capability'
import { CoachCommunicationAuditRecord, coachCommunicationAuditRecordSchema } from './communication'
import { CoachCooldownRecord, coachCooldownRecordSchema } from './cooldown'
import { CoachCuePublicDto, coachCuePublicDtoSchema } from './cue'
import { CoachPublicError, coachPublicErrorSchema } from './error'
import {
  FogInference,
  ItemPurchaseGuidance,
  fogInferenceSchema,
  itemPurchaseGuidanceSchema
} from './guidance'

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

export type CoachPauseReason =
  'user-pause' | 'global-shortcut' | 'environment-abnormal' | 'feature-unavailable'

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

export interface LiveCoachSessionSummary {
  sessionId: string
  mapId: number | null
  queueId: number | null
  patch: string | null
  startedAt: number
  endedAt: number
  durationSeconds: number
  endReason: string
  totalCues: number
  cueCounts: Record<'information' | 'warning' | 'opportunity' | 'system' | 'review', number>
}

export interface LiveCoachPublicState {
  session: {
    id: string | null
    state: CoachSessionState
    pauseReason: CoachPauseReason | null
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
    resolution: { width: number; height: number } | null
    confidence: number | null
    lastObservationAt: number | null
    modelVersions: Record<string, string>
    captureLatencyMs: number | null
    inferenceLatencyMs: number | null
    dropCount: number
    queueDepth: number | null
    workerHeartbeatAt: number | null
    workerRestartCount: number
  }
  liveData: {
    state: string
    lastSuccessAt: number | null
    sourceHealth: LiveGameSourceHealth[]
  }
  cue: CoachCuePublicDto | null
  recentCues: CoachCuePublicDto[]
  sessionCueStats: LiveCoachSessionSummary['cueCounts'] & { total: number }
  lastSessionSummary: LiveCoachSessionSummary | null
  fogInferences: FogInference[]
  itemGuidance: ItemPurchaseGuidance | null
  cooldowns: CoachCooldownRecord[]
  communicationHistory: CoachCommunicationAuditRecord[]
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

export const liveCoachSessionSummarySchema = z.object({
  sessionId: z.string(),
  mapId: z.number().nullable(),
  queueId: z.number().nullable(),
  patch: z.string().nullable(),
  startedAt: z.number().min(0),
  endedAt: z.number().min(0),
  durationSeconds: z.number().min(0),
  endReason: z.string(),
  totalCues: z.number().int().min(0),
  cueCounts: z.object({
    information: z.number().int().min(0),
    warning: z.number().int().min(0),
    opportunity: z.number().int().min(0),
    system: z.number().int().min(0),
    review: z.number().int().min(0)
  })
})

export const liveCoachPublicStateSchema = z.object({
  session: z.object({
    id: z.string().nullable(),
    state: coachSessionStateSchema,
    pauseReason: z
      .enum(['user-pause', 'global-shortcut', 'environment-abnormal', 'feature-unavailable'])
      .nullable(),
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
    roiState: z.string(),
    resolution: z.object({ width: z.number(), height: z.number() }).nullable(),
    confidence: z.number().nullable(),
    lastObservationAt: z.number().nullable(),
    modelVersions: z.record(z.string(), z.string()),
    captureLatencyMs: z.number().nullable(),
    inferenceLatencyMs: z.number().nullable(),
    dropCount: z.number().int().min(0),
    queueDepth: z.number().int().min(0).nullable(),
    workerHeartbeatAt: z.number().int().min(0).nullable(),
    workerRestartCount: z.number().int().min(0)
  }),
  liveData: z.object({
    state: z.string(),
    lastSuccessAt: z.number().nullable(),
    sourceHealth: z.array(
      z.object({
        domain: z.enum(['game-stats', 'players', 'events', 'active-player']),
        state: z.enum(['idle', 'healthy', 'degraded', 'unavailable']),
        lastSuccessAt: z.number().nullable(),
        lastErrorCode: z.string().nullable(),
        consecutiveFailures: z.number().int().min(0)
      })
    )
  }),
  cue: coachCuePublicDtoSchema.nullable(),
  recentCues: z.array(coachCuePublicDtoSchema),
  sessionCueStats: z.object({
    total: z.number().int().min(0),
    information: z.number().int().min(0),
    warning: z.number().int().min(0),
    opportunity: z.number().int().min(0),
    system: z.number().int().min(0),
    review: z.number().int().min(0)
  }),
  lastSessionSummary: liveCoachSessionSummarySchema.nullable(),
  fogInferences: z.array(fogInferenceSchema),
  itemGuidance: itemPurchaseGuidanceSchema.nullable(),
  cooldowns: z.array(coachCooldownRecordSchema),
  communicationHistory: z.array(coachCommunicationAuditRecordSchema),
  speech: z.object({
    state: z.enum(['idle', 'speaking', 'muted', 'unavailable']),
    cueId: z.string().nullable()
  }),
  conversation: coachConversationPublicDtoSchema,
  lastError: coachPublicErrorSchema.nullable()
})
