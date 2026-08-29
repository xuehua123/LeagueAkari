import { coachErrorCodeSchema, coachSessionStateSchema } from '@shared/types/live-coach'
import { z } from 'zod'

import type { LiveCoachSettings, LiveCoachState } from './state'

const finiteTimestampSchema = z.number().finite().nonnegative()
const nullableFiniteNumberSchema = z.number().finite().nullable()

const sourceHealthExportSchema = z
  .object({
    domain: z.enum(['game-stats', 'players', 'events', 'active-player']),
    state: z.enum(['idle', 'healthy', 'degraded', 'unavailable']),
    lastSuccessAt: finiteTimestampSchema.nullable(),
    lastErrorCode: z.string().nullable(),
    consecutiveFailures: z.number().int().nonnegative()
  })
  .strict()

const cueCountersExportSchema = z
  .object({
    total: z.number().int().nonnegative(),
    information: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    opportunity: z.number().int().nonnegative(),
    system: z.number().int().nonnegative(),
    review: z.number().int().nonnegative()
  })
  .strict()

export const liveCoachDiagnosticsReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('league-akari-live-coach-diagnostics'),
    appVersion: z.string().min(1),
    generatedAt: finiteTimestampSchema,
    environment: z
      .object({
        platform: z.string().min(1),
        arch: z.string().min(1),
        buildChannel: z.enum(['public', 'internal'])
      })
      .strict(),
    privacy: z
      .object({
        rawFramesIncluded: z.literal(false),
        gameVideoIncluded: z.literal(false),
        microphoneAudioIncluded: z.literal(false),
        summonerNamesIncluded: z.literal(false),
        fullPathsIncluded: z.literal(false),
        tokensIncluded: z.literal(false),
        customCommunicationTextIncluded: z.literal(false)
      })
      .strict(),
    session: z
      .object({
        state: coachSessionStateSchema,
        pauseReason: z
          .enum(['user-pause', 'global-shortcut', 'environment-abnormal', 'feature-unavailable'])
          .nullable(),
        mapId: nullableFiniteNumberSchema,
        queueId: nullableFiniteNumberSchema,
        patch: z.string().nullable(),
        startedAt: finiteTimestampSchema.nullable(),
        hasSessionId: z.boolean()
      })
      .strict(),
    capability: z
      .object({
        enabledFeatureIds: z.array(z.string()),
        unavailable: z.record(z.string(), z.string())
      })
      .strict(),
    capture: z
      .object({
        state: z.string(),
        backend: z.string().nullable(),
        fps: z.number().finite().nonnegative(),
        frameAgeMs: nullableFiniteNumberSchema,
        roiState: z.string(),
        resolution: z
          .object({
            width: z.number().int().positive(),
            height: z.number().int().positive()
          })
          .strict()
          .nullable(),
        confidence: z.number().finite().min(0).max(1).nullable(),
        lastObservationAt: finiteTimestampSchema.nullable(),
        modelVersions: z.record(z.string(), z.string()),
        captureLatencyMs: nullableFiniteNumberSchema,
        inferenceLatencyMs: nullableFiniteNumberSchema,
        dropCount: z.number().int().nonnegative(),
        queueDepth: z.number().int().nonnegative().nullable(),
        workerHeartbeatAt: finiteTimestampSchema.nullable(),
        workerRestartCount: z.number().int().nonnegative()
      })
      .strict(),
    liveData: z
      .object({
        state: z.string(),
        lastSuccessAt: finiteTimestampSchema.nullable(),
        sourceHealth: z.array(sourceHealthExportSchema)
      })
      .strict(),
    speech: z
      .object({
        state: z.enum(['idle', 'speaking', 'muted', 'unavailable']),
        cueId: z.string().nullable()
      })
      .strict(),
    lastError: z
      .object({
        code: coachErrorCodeSchema,
        stage: z.string(),
        recoverable: z.boolean(),
        occurredAt: finiteTimestampSchema
      })
      .strict()
      .nullable(),
    counters: z
      .object({
        sessionCueStats: cueCountersExportSchema,
        recentCueCount: z.number().int().nonnegative(),
        cooldownCount: z.number().int().nonnegative(),
        communicationAuditCount: z.number().int().nonnegative()
      })
      .strict(),
    lastSession: z
      .object({
        mapId: nullableFiniteNumberSchema,
        queueId: nullableFiniteNumberSchema,
        patch: z.string().nullable(),
        startedAt: finiteTimestampSchema,
        endedAt: finiteTimestampSchema,
        durationSeconds: z.number().finite().nonnegative(),
        endReason: z.string(),
        totalCues: z.number().int().nonnegative(),
        cueCounts: cueCountersExportSchema.omit({ total: true })
      })
      .strict()
      .nullable(),
    settings: z
      .object({
        enabled: z.boolean(),
        autoStartEnabled: z.boolean(),
        coachMode: z.enum(['minimal', 'balanced', 'training']),
        cueDensity: z.enum(['low', 'standard', 'high']),
        minimumCueIntervalSeconds: z.number().finite().min(0),
        outputMode: z.array(z.enum(['sound', 'subtitle', 'speech'])),
        captureBackend: z.enum(['auto', 'wgc', 'dda']),
        minimapSide: z.enum(['auto', 'left', 'right']),
        fogInferenceEnabled: z.boolean(),
        itemGuidanceEnabled: z.boolean(),
        cooldownTrackingEnabled: z.boolean(),
        communicationAssistEnabled: z.boolean(),
        speechEnabled: z.boolean(),
        muted: z.boolean(),
        overlayEnabled: z.boolean()
      })
      .strict()
  })
  .strict()

export type LiveCoachDiagnosticsReport = z.infer<typeof liveCoachDiagnosticsReportSchema>

export interface LiveCoachDiagnosticsReportInput {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  generatedAt?: number
  state: LiveCoachState
  settings: LiveCoachSettings
}

export function createLiveCoachDiagnosticsReport(
  input: LiveCoachDiagnosticsReportInput
): LiveCoachDiagnosticsReport {
  const { state, settings } = input
  const lastSession = state.lastSessionSummary

  return liveCoachDiagnosticsReportSchema.parse({
    schemaVersion: 1,
    type: 'league-akari-live-coach-diagnostics',
    appVersion: input.appVersion,
    generatedAt: input.generatedAt ?? Date.now(),
    environment: {
      platform: input.platform,
      arch: input.arch,
      buildChannel: state.buildChannel
    },
    privacy: {
      rawFramesIncluded: false,
      gameVideoIncluded: false,
      microphoneAudioIncluded: false,
      summonerNamesIncluded: false,
      fullPathsIncluded: false,
      tokensIncluded: false,
      customCommunicationTextIncluded: false
    },
    session: {
      state: state.session.state,
      pauseReason: state.session.pauseReason,
      mapId: state.session.mapId,
      queueId: state.session.queueId,
      patch: state.session.patch,
      startedAt: state.session.startedAt,
      hasSessionId: Boolean(state.session.id)
    },
    capability: {
      enabledFeatureIds: [...state.capability.enabledFeatureIds],
      unavailable: { ...state.capability.unavailable }
    },
    capture: {
      ...state.capture,
      modelVersions: { ...state.capture.modelVersions },
      resolution: state.capture.resolution ? { ...state.capture.resolution } : null
    },
    liveData: {
      ...state.liveData,
      sourceHealth: state.liveData.sourceHealth.map((health) => ({ ...health }))
    },
    speech: { ...state.speech },
    lastError: state.lastError
      ? {
          code: state.lastError.code,
          stage: state.lastError.stage,
          recoverable: state.lastError.recoverable,
          occurredAt: state.lastError.occurredAt
        }
      : null,
    counters: {
      sessionCueStats: { ...state.sessionCueStats },
      recentCueCount: state.recentCues.length,
      cooldownCount: state.cooldowns.length,
      communicationAuditCount: state.communicationHistory.length
    },
    lastSession: lastSession
      ? {
          mapId: lastSession.mapId,
          queueId: lastSession.queueId,
          patch: lastSession.patch,
          startedAt: lastSession.startedAt,
          endedAt: lastSession.endedAt,
          durationSeconds: lastSession.durationSeconds,
          endReason: lastSession.endReason,
          totalCues: lastSession.totalCues,
          cueCounts: { ...lastSession.cueCounts }
        }
      : null,
    settings: {
      enabled: settings.enabled,
      autoStartEnabled: settings.autoStartEnabled,
      coachMode: settings.coachMode,
      cueDensity: settings.cueDensity,
      minimumCueIntervalSeconds: settings.minimumCueIntervalSeconds,
      outputMode: [...settings.outputMode],
      captureBackend: settings.captureBackend,
      minimapSide: settings.minimapSide,
      fogInferenceEnabled: settings.fogInferenceEnabled,
      itemGuidanceEnabled: settings.itemGuidanceEnabled,
      cooldownTrackingEnabled: settings.cooldownTrackingEnabled,
      communicationAssistEnabled: settings.communicationAssistEnabled,
      speechEnabled: settings.speechEnabled,
      muted: settings.muted,
      overlayEnabled: settings.overlayEnabled
    }
  })
}
