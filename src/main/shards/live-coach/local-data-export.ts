import {
  type CoachFeedbackRecord,
  type LiveCoachAcceptanceReport,
  type ReplayAnalysisHistoryEntry,
  type ReplayAnalysisStoredResult,
  coachCommunicationKindSchema,
  coachCooldownKindSchema,
  coachCooldownSourceSchema,
  coachCueCategorySchema,
  coachCueStatusSchema,
  coachErrorCodeSchema,
  coachFeedbackRecordSchema,
  coachSessionStateSchema,
  liveCoachAcceptanceReportSchema,
  replayAnalysisHistoryEntrySchema,
  replayAnalysisStoredResultSchema
} from '@shared/types/live-coach'
import { z } from 'zod'

import type { LiveCoachSettings, LiveCoachState } from './state'

const finiteTimestampSchema = z.number().finite().nonnegative()

const cueOptionExportSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    role: z.enum(['primary', 'alternative']).optional()
  })
  .strict()

const cueExportSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    category: coachCueCategorySchema,
    priority: z.number().finite().min(0).max(100),
    observationText: z.string(),
    impactText: z.string().nullable(),
    options: z.array(cueOptionExportSchema).max(2),
    spokenText: z.string(),
    createdAt: finiteTimestampSchema,
    expiresAt: finiteTimestampSchema,
    status: coachCueStatusSchema,
    cancellationReason: z.string().nullable().optional()
  })
  .strict()

const cueCountsExportSchema = z
  .object({
    total: z.number().int().nonnegative(),
    information: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    opportunity: z.number().int().nonnegative(),
    system: z.number().int().nonnegative(),
    review: z.number().int().nonnegative()
  })
  .strict()

const sessionSummaryExportSchema = z
  .object({
    sessionId: z.string(),
    mapId: z.number().finite().nullable(),
    queueId: z.number().finite().nullable(),
    patch: z.string().nullable(),
    startedAt: finiteTimestampSchema,
    endedAt: finiteTimestampSchema,
    durationSeconds: z.number().finite().nonnegative(),
    endReason: z.string(),
    totalCues: z.number().int().nonnegative(),
    cueCounts: cueCountsExportSchema.omit({ total: true })
  })
  .strict()

const probabilitySchema = z.number().finite().min(0).max(1)

const fogInferenceExportSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    enemyTrackId: z.string(),
    basisEvidenceIds: z.array(z.string()),
    lastSeenAt: finiteTimestampSchema,
    predictedRegions: z.array(
      z
        .object({
          regionId: z.string(),
          probability: probabilitySchema
        })
        .strict()
    ),
    candidateRoutes: z.array(
      z
        .object({
          regionIds: z.array(z.string()),
          probability: probabilitySchema
        })
        .strict()
    ),
    arrivalWindow: z
      .object({
        earliestAt: finiteTimestampSchema,
        latestAt: finiteTimestampSchema
      })
      .strict()
      .refine((window) => window.latestAt >= window.earliestAt, {
        message: 'latestAt must be greater than or equal to earliestAt'
      })
      .nullable(),
    intents: z.array(
      z
        .object({
          kind: z.enum(['roam', 'recall', 'ambush', 'flank', 'objective', 'lane-swap', 'unknown']),
          probability: probabilitySchema
        })
        .strict()
    ),
    confidence: probabilitySchema,
    createdAt: finiteTimestampSchema,
    expiresAt: finiteTimestampSchema,
    modelVersion: z.string()
  })
  .strict()

const itemPurchasePlanExportSchema = z
  .object({
    itemIds: z.array(z.number().int().positive()),
    totalCost: z.number().finite().nonnegative(),
    remainingGold: z.number().finite().nonnegative(),
    missingGold: z.number().finite().nonnegative(),
    reasonCodes: z.array(z.string()),
    conditions: z.array(z.string())
  })
  .strict()

const itemGuidanceExportSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    patch: z.string(),
    championId: z.number().int().positive(),
    mode: z.enum(['system', 'common', 'adaptive', 'custom']),
    currentGold: z.number().finite().nonnegative(),
    inventoryItemIds: z.array(z.number().int().positive()),
    primaryPlan: itemPurchasePlanExportSchema,
    alternativePlans: z.array(itemPurchasePlanExportSchema),
    evidenceIds: z.array(z.string()),
    createdAt: finiteTimestampSchema,
    expiresAt: finiteTimestampSchema,
    ruleVersion: z.string()
  })
  .strict()

const cooldownExportSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    kind: coachCooldownKindSchema,
    label: z.string().min(1).max(64),
    ownerTeam: z.enum(['self', 'ally', 'enemy', 'neutral', 'unknown']),
    championId: z.number().int().positive().nullable(),
    source: coachCooldownSourceSchema,
    confidence: probabilitySchema,
    observedAt: finiteTimestampSchema,
    earliestReadyAt: finiteTimestampSchema,
    latestReadyAt: finiteTimestampSchema,
    status: z.enum(['running', 'ready', 'cancelled']),
    evidenceIds: z.array(z.string())
  })
  .strict()

const communicationAuditExportSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    cueId: z.string(),
    optionId: z.string(),
    kind: coachCommunicationKindSchema,
    action: z.enum(['copied', 'sent', 'blocked']),
    channel: z.enum(['ping', 'chat']),
    message: z.string(),
    reason: z.string().nullable(),
    createdAt: finiteTimestampSchema
  })
  .strict()

const conversationExportSchema = z
  .object({
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
  .strict()

const publicErrorExportSchema = z
  .object({
    code: coachErrorCodeSchema,
    stage: z.string(),
    recoverable: z.boolean(),
    occurredAt: finiteTimestampSchema
  })
  .strict()

const manualCalibrationExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    fingerprintHash: z.string(),
    roi: z
      .object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
        width: z.number().finite().positive().max(1),
        height: z.number().finite().positive().max(1)
      })
      .strict(),
    transform: z.enum(['blue-normal', 'red-rotated']),
    source: z.enum(['automatic', 'manual']),
    confidence: probabilitySchema,
    createdAt: finiteTimestampSchema
  })
  .strict()

export const liveCoachLocalDataExportSchema = z
  .object({
    schemaVersion: z.literal(3),
    type: z.literal('league-akari-live-coach-export'),
    appVersion: z.string().min(1),
    exportedAt: finiteTimestampSchema,
    privacy: z
      .object({
        rawFramesIncluded: z.literal(false),
        microphoneAudioIncluded: z.literal(false),
        gameVideoIncluded: z.literal(false),
        fullPathsIncluded: z.literal(false),
        tokensIncluded: z.literal(false),
        diagnosticErrorDetailsIncluded: z.literal(false),
        acceptanceSessionIdsHashed: z.literal(true),
        acceptanceCueAndEvidenceIdsHashed: z.literal(true),
        acceptanceFullPathsIncluded: z.literal(false),
        replaySourceMediaIncluded: z.literal(false),
        replaySourcePathsIncluded: z.literal(false),
        replaySourceFileNamesIncluded: z.literal(false),
        replayRawFramesIncluded: z.literal(false),
        replayRawSidecarPayloadIncluded: z.literal(false)
      })
      .strict(),
    session: z
      .object({
        id: z.string().nullable(),
        state: coachSessionStateSchema,
        pauseReason: z
          .enum(['user-pause', 'global-shortcut', 'environment-abnormal', 'feature-unavailable'])
          .nullable(),
        mapId: z.number().finite().nullable(),
        queueId: z.number().finite().nullable(),
        patch: z.string().nullable(),
        startedAt: finiteTimestampSchema.nullable()
      })
      .strict(),
    cue: cueExportSchema.nullable(),
    recentCues: z.array(cueExportSchema),
    sessionCueStats: cueCountsExportSchema,
    lastSessionSummary: sessionSummaryExportSchema.nullable(),
    fogInferences: z.array(fogInferenceExportSchema),
    itemGuidance: itemGuidanceExportSchema.nullable(),
    cooldowns: z.array(cooldownExportSchema),
    communicationHistory: z.array(communicationAuditExportSchema),
    conversation: conversationExportSchema,
    lastError: publicErrorExportSchema.nullable(),
    feedback: z.array(coachFeedbackRecordSchema.strict()),
    manualCalibration: manualCalibrationExportSchema.nullable(),
    acceptance: liveCoachAcceptanceReportSchema,
    replayHistory: z.array(replayAnalysisHistoryEntrySchema),
    replayResults: z.array(replayAnalysisStoredResultSchema)
  })
  .strict()

export type LiveCoachLocalDataExport = z.infer<typeof liveCoachLocalDataExportSchema>

export interface LiveCoachLocalDataExportInput {
  appVersion: string
  exportedAt?: number
  state: LiveCoachState
  settings: LiveCoachSettings
  feedback: CoachFeedbackRecord[]
  acceptance: LiveCoachAcceptanceReport
  replayHistory: ReplayAnalysisHistoryEntry[]
  replayResults: ReplayAnalysisStoredResult[]
}

/**
 * Builds the user-requested full local-data export. The strict allowlist deliberately excludes
 * raw capture media, source paths, tokens and diagnostic error details.
 */
export function createLiveCoachLocalDataExport(
  input: LiveCoachLocalDataExportInput
): LiveCoachLocalDataExport {
  const { state, settings } = input

  return liveCoachLocalDataExportSchema.parse({
    schemaVersion: 3,
    type: 'league-akari-live-coach-export',
    appVersion: input.appVersion,
    exportedAt: input.exportedAt ?? Date.now(),
    privacy: {
      rawFramesIncluded: false,
      microphoneAudioIncluded: false,
      gameVideoIncluded: false,
      fullPathsIncluded: false,
      tokensIncluded: false,
      diagnosticErrorDetailsIncluded: false,
      acceptanceSessionIdsHashed: true,
      acceptanceCueAndEvidenceIdsHashed: true,
      acceptanceFullPathsIncluded: false,
      replaySourceMediaIncluded: false,
      replaySourcePathsIncluded: false,
      replaySourceFileNamesIncluded: false,
      replayRawFramesIncluded: false,
      replayRawSidecarPayloadIncluded: false
    },
    session: { ...state.session },
    cue: state.cue,
    recentCues: [...state.recentCues],
    sessionCueStats: { ...state.sessionCueStats },
    lastSessionSummary: state.lastSessionSummary
      ? {
          ...state.lastSessionSummary,
          cueCounts: { ...state.lastSessionSummary.cueCounts }
        }
      : null,
    fogInferences: [...state.fogInferences],
    itemGuidance: state.itemGuidance,
    cooldowns: [...state.cooldowns],
    communicationHistory: [...state.communicationHistory],
    conversation: { ...state.conversation },
    lastError: state.lastError
      ? {
          code: state.lastError.code,
          stage: state.lastError.stage,
          recoverable: state.lastError.recoverable,
          occurredAt: state.lastError.occurredAt
        }
      : null,
    feedback: [...input.feedback],
    manualCalibration: settings.manualCalibration,
    acceptance: input.acceptance,
    replayHistory: [...input.replayHistory],
    replayResults: [...input.replayResults]
  })
}
