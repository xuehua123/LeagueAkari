import { z } from 'zod'

export const REPLAY_HISTORY_SCHEMA_VERSION = 1 as const
export const REPLAY_HISTORY_MAX_ENTRIES = 100
export const REPLAY_HISTORY_MAX_TIMELINE_ITEMS = 5_000

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const uuidSchema = z.uuid()
const boundedIdentifierSchema = z.string().trim().min(1).max(128)
const boundedVersionSchema = z.string().trim().min(1).max(128)

export const replayAnalysisSourceKindSchema = z.enum(['json', 'video'])
export type ReplayAnalysisSourceKind = z.infer<typeof replayAnalysisSourceKindSchema>

export const replayAnalysisStatusSchema = z.enum([
  'preparing',
  'analyzing',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])
export type ReplayAnalysisStatus = z.infer<typeof replayAnalysisStatusSchema>

export const replayAnalysisStageSchema = z.enum([
  'queued',
  'hashing',
  'probing',
  'extracting',
  'analyzing',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])
export type ReplayAnalysisStage = z.infer<typeof replayAnalysisStageSchema>

const replayRosterMemberSchema = z
  .object({
    team: z.enum(['blue', 'red']),
    championId: z.number().int().positive()
  })
  .strict()

export const replayAnalysisMetadataSchema = z
  .object({
    patch: z.string().trim().min(1).max(50).nullable(),
    mapId: z.number().int().positive().nullable(),
    queueId: z.number().int().nonnegative().nullable(),
    selfTeam: z.enum(['blue', 'red']).nullable(),
    selfChampionId: z.number().int().positive().nullable(),
    minimapSide: z.enum(['left', 'right']).nullable(),
    videoGameStartMs: z.number().finite().nonnegative().nullable(),
    roster: z.array(replayRosterMemberSchema).max(10).nullable()
  })
  .strict()
export type ReplayAnalysisMetadata = z.infer<typeof replayAnalysisMetadataSchema>

export const replayAnalysisRoiSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1)
  })
  .strict()
  .superRefine((roi, context) => {
    if (roi.x + roi.width > 1) {
      context.addIssue({ code: 'custom', path: ['width'], message: 'ROI exceeds image width' })
    }
    if (roi.y + roi.height > 1) {
      context.addIssue({ code: 'custom', path: ['height'], message: 'ROI exceeds image height' })
    }
  })
export type ReplayAnalysisRoi = z.infer<typeof replayAnalysisRoiSchema>

const replayAnalysisModelManifestSchema = z
  .object({
    version: boundedVersionSchema,
    sha256: sha256Schema.nullable()
  })
  .strict()

export const replayAnalysisRuntimeManifestSchema = z
  .object({
    pipelineVersion: boundedVersionSchema,
    ruleCatalogVersion: boundedVersionSchema,
    ffmpegVersion: boundedVersionSchema.nullable(),
    runtimeVersion: boundedVersionSchema.nullable(),
    models: z
      .record(boundedIdentifierSchema, replayAnalysisModelManifestSchema)
      .refine(
        (models) => Object.keys(models).length <= 32,
        'At most 32 model descriptors may be stored'
      )
  })
  .strict()
export type ReplayAnalysisRuntimeManifest = z.infer<typeof replayAnalysisRuntimeManifestSchema>

export const replayAnalysisFingerprintInputSchema = z
  .object({
    artifactSha256: sha256Schema,
    sidecarSha256: sha256Schema.nullable(),
    metadata: replayAnalysisMetadataSchema,
    roi: replayAnalysisRoiSchema.nullable(),
    manifest: replayAnalysisRuntimeManifestSchema
  })
  .strict()
export type ReplayAnalysisFingerprintInput = z.infer<typeof replayAnalysisFingerprintInputSchema>

export const replayAnalysisHistoryEntrySchema = z
  .object({
    schemaVersion: z.literal(REPLAY_HISTORY_SCHEMA_VERSION),
    id: uuidSchema,
    sourceKind: replayAnalysisSourceKindSchema,
    status: replayAnalysisStatusSchema,
    stage: replayAnalysisStageSchema,
    progress: z.number().finite().min(0).max(100),
    artifactSha256: sha256Schema,
    sidecarSha256: sha256Schema.nullable(),
    analysisFingerprint: sha256Schema,
    metadata: replayAnalysisMetadataSchema,
    roi: replayAnalysisRoiSchema.nullable(),
    manifest: replayAnalysisRuntimeManifestSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    resultId: uuidSchema.nullable(),
    retryOf: uuidSchema.nullable(),
    failureCode: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9._-]*$/)
      .nullable(),
    durationSeconds: z
      .number()
      .finite()
      .positive()
      .max(4 * 60 * 60)
      .nullable(),
    frameCount: z.number().int().nonnegative().nullable(),
    analysisFps: z.number().finite().positive().max(120).nullable(),
    totalCues: z.number().int().nonnegative().nullable()
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.status === 'completed' && (!entry.resultId || !entry.completedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['resultId'],
        message: 'Completed entries require a result and completion time'
      })
    }
    if (entry.status !== 'completed' && entry.resultId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['resultId'],
        message: 'Only completed entries may reference a result'
      })
    }
    if (entry.status !== 'completed' && entry.completedAt !== null) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Only completed entries may have a completion time'
      })
    }
    if ((entry.status === 'failed' || entry.status === 'interrupted') && !entry.failureCode) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Failed and interrupted entries require a stable failure code'
      })
    }
    if (entry.status !== 'failed' && entry.status !== 'interrupted' && entry.failureCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Only failed and interrupted entries may have a failure code'
      })
    }
    if (entry.status === 'completed' && (entry.stage !== 'completed' || entry.progress !== 100)) {
      context.addIssue({
        code: 'custom',
        path: ['stage'],
        message: 'Completed entries require the completed stage and 100% progress'
      })
    }
  })
export type ReplayAnalysisHistoryEntry = z.infer<typeof replayAnalysisHistoryEntrySchema>

export const replayAnalysisTimelineItemSchema = z
  .object({
    gameTimeMs: z
      .number()
      .int()
      .nonnegative()
      .max(4 * 60 * 60 * 1_000),
    category: z.string().trim().min(1).max(128),
    observation: z.string().trim().min(1).max(2_048),
    spokenText: z.string().trim().max(2_048),
    options: z.array(z.string().trim().min(1).max(512)).max(8),
    evidenceHashes: z.array(sha256Schema).max(32)
  })
  .strict()
export type ReplayAnalysisTimelineItem = z.infer<typeof replayAnalysisTimelineItemSchema>

const replayCapabilityStatusSchema = z
  .object({
    available: z.array(boundedIdentifierSchema).max(128),
    disabled: z
      .array(
        z
          .object({
            capability: boundedIdentifierSchema,
            reason: boundedIdentifierSchema
          })
          .strict()
      )
      .max(128),
    missingFields: z.array(boundedIdentifierSchema).max(128)
  })
  .strict()

export const replayAnalysisStoredResultSchema = z
  .object({
    schemaVersion: z.literal(REPLAY_HISTORY_SCHEMA_VERSION),
    historyId: uuidSchema,
    analysisFingerprint: sha256Schema,
    generatedAt: z.iso.datetime({ offset: true }),
    summary: z
      .object({
        sourceKind: replayAnalysisSourceKindSchema,
        artifactSha256: sha256Schema,
        sidecarSha256: sha256Schema.nullable(),
        metadata: replayAnalysisMetadataSchema,
        durationSeconds: z
          .number()
          .finite()
          .positive()
          .max(4 * 60 * 60),
        frameCount: z.number().int().nonnegative(),
        analysisFps: z.number().finite().positive().max(120),
        totalCues: z.number().int().nonnegative(),
        totalEvidences: z.number().int().nonnegative()
      })
      .strict(),
    capabilityStatus: replayCapabilityStatusSchema,
    timeline: z.array(replayAnalysisTimelineItemSchema).max(REPLAY_HISTORY_MAX_TIMELINE_ITEMS)
  })
  .strict()
export type ReplayAnalysisStoredResult = z.infer<typeof replayAnalysisStoredResultSchema>

export const replayAnalysisHistoryDocumentSchema = z
  .object({
    schemaVersion: z.literal(REPLAY_HISTORY_SCHEMA_VERSION),
    generation: z.number().int().nonnegative(),
    entries: z.array(replayAnalysisHistoryEntrySchema).max(REPLAY_HISTORY_MAX_ENTRIES)
  })
  .strict()
  .superRefine((document, context) => {
    if (new Set(document.entries.map((entry) => entry.id)).size !== document.entries.length) {
      context.addIssue({ code: 'custom', path: ['entries'], message: 'History ids must be unique' })
    }
  })
export type ReplayAnalysisHistoryDocument = z.infer<typeof replayAnalysisHistoryDocumentSchema>

export const startReplayAnalysisTaskInputSchema = replayAnalysisFingerprintInputSchema
  .extend({
    analysisFingerprint: sha256Schema,
    sourceKind: replayAnalysisSourceKindSchema,
    retryOf: uuidSchema.nullable().optional()
  })
  .strict()
export type StartReplayAnalysisTaskInput = z.infer<typeof startReplayAnalysisTaskInputSchema>

export const updateReplayAnalysisProgressInputSchema = z
  .object({
    stage: replayAnalysisStageSchema,
    progress: z.number().finite().min(0).max(100)
  })
  .strict()
export type UpdateReplayAnalysisProgressInput = z.infer<
  typeof updateReplayAnalysisProgressInputSchema
>

export const failReplayAnalysisTaskInputSchema = z
  .object({
    failureCode: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    stage: replayAnalysisStageSchema.optional()
  })
  .strict()
export type FailReplayAnalysisTaskInput = z.infer<typeof failReplayAnalysisTaskInputSchema>
