import { z } from 'zod'

import { coachCueCategorySchema, coachCueStatusSchema } from './cue'

export const acceptanceMetricSummarySchema = z
  .object({
    count: z.number().int().nonnegative(),
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
    mean: z.number().finite().nullable(),
    p95: z.number().finite().nullable()
  })
  .strict()

export type AcceptanceMetricSummary = z.infer<typeof acceptanceMetricSummarySchema>

export const liveCoachAcceptanceCueAuditSchema = z
  .object({
    cueIdHash: z.string().regex(/^[a-f\d]{64}$/),
    ruleId: z.string(),
    ruleVersion: z.string(),
    evidenceIdHashes: z.array(z.string().regex(/^[a-f\d]{64}$/)),
    evidenceVerifiedAtEmission: z.boolean(),
    category: coachCueCategorySchema,
    priority: z.number().finite().min(0).max(100),
    createdAt: z.number().finite(),
    expiresAt: z.number().finite(),
    terminalAt: z.number().finite(),
    status: coachCueStatusSchema,
    cancellationReason: z.string().nullable()
  })
  .strict()

export type LiveCoachAcceptanceCueAudit = z.infer<typeof liveCoachAcceptanceCueAuditSchema>

export const liveCoachAcceptanceAnalysisIntervalSchema = z
  .object({
    startedAt: z.number().finite(),
    endedAt: z.number().finite()
  })
  .strict()
  .refine((interval) => interval.endedAt >= interval.startedAt, {
    message: 'analysis interval must not end before it starts'
  })

export type LiveCoachAcceptanceAnalysisInterval = z.infer<
  typeof liveCoachAcceptanceAnalysisIntervalSchema
>

export const liveCoachAcceptanceRoiEpisodeSchema = z
  .object({
    episodeIdHash: z.string().regex(/^[a-f\d]{64}$/),
    trigger: z.enum(['session-start', 'recalibration']),
    calibrationIdHash: z
      .string()
      .regex(/^[a-f\d]{64}$/)
      .nullable(),
    startedAt: z.number().finite(),
    endedAt: z.number().finite(),
    outcome: z.enum(['healthy', 'failed']),
    firstHealthyAt: z.number().finite().nullable()
  })
  .strict()
  .superRefine((episode, context) => {
    if (episode.endedAt < episode.startedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ROI episode must not end before it starts',
        path: ['endedAt']
      })
    }
    if (episode.outcome === 'healthy') {
      if (
        episode.firstHealthyAt === null ||
        episode.firstHealthyAt < episode.startedAt ||
        episode.firstHealthyAt > episode.endedAt
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'healthy ROI episode requires an in-range firstHealthyAt',
          path: ['firstHealthyAt']
        })
      }
    } else if (episode.firstHealthyAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'failed ROI episode cannot contain firstHealthyAt',
        path: ['firstHealthyAt']
      })
    }
  })

export type LiveCoachAcceptanceRoiEpisode = z.infer<typeof liveCoachAcceptanceRoiEpisodeSchema>

const roiCountsSchema = z
  .object({
    healthy: z.number().int().nonnegative(),
    degraded: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative()
  })
  .strict()

export const liveCoachAcceptanceSessionSchema = z
  .object({
    recordId: z.string(),
    source: z.enum(['live-game', 'internal-simulation']),
    mode: z.enum(['shadow', 'audible', 'mixed']),
    sessionIdHash: z.string().regex(/^[a-f\d]{64}$/),
    buildChannel: z.enum(['public', 'internal']),
    mapId: z.number().finite().nullable(),
    queueId: z.number().finite().nullable(),
    patch: z.string().nullable(),
    startedAt: z.number().finite(),
    endedAt: z.number().finite(),
    durationSeconds: z.number().finite().nonnegative(),
    durationBasis: z.literal('fresh-healthy-intervals-v2'),
    analysisIntervals: z.array(liveCoachAcceptanceAnalysisIntervalSchema).max(10_000),
    completionBasis: z.enum(['observed-gameflow-end', 'unverified']),
    endReason: z.string(),
    capture: z
      .object({
        backend: z.string().nullable(),
        resolution: z.string().nullable(),
        minimapSide: z.enum(['auto', 'left', 'right']),
        roiCounts: roiCountsSchema,
        roiEverHealthy: z.boolean(),
        roiFirstHealthyMs: z.number().finite().nonnegative().nullable(),
        dropCountStart: z.number().int().nonnegative(),
        dropCountEnd: z.number().int().nonnegative()
      })
      .strict(),
    roiEpisodes: z.array(liveCoachAcceptanceRoiEpisodeSchema).min(1).max(10_000),
    performance: z
      .object({
        captureLatencyMs: acceptanceMetricSummarySchema,
        inferenceLatencyMs: acceptanceMetricSummarySchema,
        frameAgeMs: acceptanceMetricSummarySchema,
        captureFps: acceptanceMetricSummarySchema,
        appCpuPercent: acceptanceMetricSummarySchema,
        appWorkingSetMiB: acceptanceMetricSummarySchema
      })
      .strict(),
    cues: z.array(liveCoachAcceptanceCueAuditSchema),
    errorCodes: z.array(z.string())
  })
  .strict()
  .superRefine((session, context) => {
    if (session.endedAt < session.startedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'acceptance session must not end before it starts',
        path: ['endedAt']
      })
    }
    const sortedIntervals = session.analysisIntervals.toSorted(
      (left, right) => left.startedAt - right.startedAt
    )
    let intervalDurationMs = 0
    let previousEnd: number | null = null
    for (const [index, interval] of sortedIntervals.entries()) {
      if (
        interval.startedAt < session.startedAt ||
        interval.endedAt > session.endedAt ||
        (previousEnd !== null && interval.startedAt < previousEnd)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'analysis intervals must be in-range and non-overlapping',
          path: ['analysisIntervals', index]
        })
      }
      intervalDurationMs += Math.max(0, interval.endedAt - interval.startedAt)
      previousEnd = Math.max(previousEnd ?? interval.endedAt, interval.endedAt)
    }
    if (Math.abs(session.durationSeconds - intervalDurationMs / 1_000) > 0.001) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'durationSeconds must equal the recorded analysis intervals',
        path: ['durationSeconds']
      })
    }

    const healthyEpisodes = session.roiEpisodes.filter((episode) => episode.outcome === 'healthy')
    if (session.capture.roiEverHealthy !== healthyEpisodes.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'roiEverHealthy must be derived from ROI episodes',
        path: ['capture', 'roiEverHealthy']
      })
    }
    if (session.durationSeconds > 0 && healthyEpisodes.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'analyzed duration requires a healthy ROI episode',
        path: ['analysisIntervals']
      })
    }
    const firstHealthyAt = healthyEpisodes.reduce<number | null>(
      (earliest, episode) =>
        earliest === null
          ? episode.firstHealthyAt
          : Math.min(earliest, episode.firstHealthyAt ?? earliest),
      null
    )
    const expectedFirstHealthyMs =
      firstHealthyAt === null ? null : Math.max(0, firstHealthyAt - session.startedAt)
    if (session.capture.roiFirstHealthyMs !== expectedFirstHealthyMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'roiFirstHealthyMs must be derived from ROI episodes',
        path: ['capture', 'roiFirstHealthyMs']
      })
    }
    for (const [index, episode] of session.roiEpisodes.entries()) {
      if (episode.startedAt < session.startedAt || episode.endedAt > session.endedAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ROI episodes must be within the session interval',
          path: ['roiEpisodes', index]
        })
      }
    }
  })

export type LiveCoachAcceptanceSession = z.infer<typeof liveCoachAcceptanceSessionSchema>

export const liveCoachOfflineAcceptanceRecordSchema = z
  .object({
    recordId: z.string(),
    attemptedAt: z.number().finite(),
    format: z.enum(['json', 'video']),
    success: z.boolean(),
    artifactSha256: z
      .string()
      .regex(/^[a-f\d]{64}$/)
      .nullable(),
    patch: z.string().nullable(),
    durationSeconds: z.number().finite().nonnegative().nullable(),
    frameCount: z.number().int().nonnegative().nullable(),
    cueCount: z.number().int().nonnegative(),
    errorCode: z.string().nullable()
  })
  .strict()

export type LiveCoachOfflineAcceptanceRecord = z.infer<
  typeof liveCoachOfflineAcceptanceRecordSchema
>

export const liveCoachAcceptanceCriterionSchema = z
  .object({
    id: z.string(),
    status: z.enum(['passed', 'failed', 'pending']),
    value: z.number().finite().nullable(),
    target: z.string(),
    reason: z.string().nullable()
  })
  .strict()

export type LiveCoachAcceptanceCriterion = z.infer<typeof liveCoachAcceptanceCriterionSchema>

export const liveCoachAcceptanceReportSchema = z
  .object({
    schemaVersion: z.literal(2),
    generatedAt: z.number().finite(),
    counts: z
      .object({
        realtimeSessions: z.number().int().nonnegative(),
        validShadowMatches: z.number().int().nonnegative(),
        offlineAttempts: z.number().int().nonnegative(),
        offlineSuccessful: z.number().int().nonnegative(),
        offlineUniqueArtifacts: z.number().int().nonnegative(),
        totalCues: z.number().int().nonnegative(),
        labeledCues: z.number().int().nonnegative(),
        incorrectCues: z.number().int().nonnegative(),
        roiEpisodes: z.number().int().nonnegative(),
        successfulRoiEpisodes: z.number().int().nonnegative()
      })
      .strict(),
    totals: z
      .object({
        realtimeHours: z.number().finite().nonnegative(),
        shadowHours: z.number().finite().nonnegative(),
        offlineHours: z.number().finite().nonnegative(),
        cueErrorRatePer30Minutes: z.number().finite().nonnegative().nullable(),
        cueLabelCoverage: z.number().finite().min(0).max(1).nullable(),
        traceabilityRate: z.number().finite().min(0).max(1).nullable(),
        roiStartupSuccessRate: z.number().finite().min(0).max(1).nullable()
      })
      .strict(),
    aggregatePerformance: z
      .object({
        captureLatencyMs: acceptanceMetricSummarySchema,
        inferenceLatencyMs: acceptanceMetricSummarySchema,
        frameAgeMs: acceptanceMetricSummarySchema,
        captureFps: acceptanceMetricSummarySchema,
        appCpuPercent: acceptanceMetricSummarySchema,
        appWorkingSetMiB: acceptanceMetricSummarySchema
      })
      .strict(),
    criteria: z.array(liveCoachAcceptanceCriterionSchema),
    sessions: z.array(liveCoachAcceptanceSessionSchema),
    offlineRecords: z.array(liveCoachOfflineAcceptanceRecordSchema),
    privacy: z
      .object({
        rawFramesIncluded: z.literal(false),
        gameVideoIncluded: z.literal(false),
        microphoneAudioIncluded: z.literal(false),
        summonerNamesIncluded: z.literal(false),
        sessionIdsHashed: z.literal(true),
        cueAndEvidenceIdsHashed: z.literal(true),
        fullPathsIncluded: z.literal(false)
      })
      .strict()
  })
  .strict()

export type LiveCoachAcceptanceReport = z.infer<typeof liveCoachAcceptanceReportSchema>
