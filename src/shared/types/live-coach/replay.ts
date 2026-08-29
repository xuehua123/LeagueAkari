import { z } from 'zod'

import type { LiveGameSnapshot } from '../live-game-data'
import { liveGameSnapshotSchema } from '../live-game-data/schemas'
import { type MinimapCalibration, minimapCalibrationSchema } from './calibration'
import { type MinimapObservationBatch, minimapObservationBatchSchema } from './observation'

export const replayFileGrantPurposeSchema = z.enum(['json', 'video', 'sidecar'])
export type ReplayFileGrantPurpose = z.infer<typeof replayFileGrantPurposeSchema>

export const replayFileGrantTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export const replaySelectedFileGrantSchema = z
  .object({
    token: replayFileGrantTokenSchema,
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[^/\\\u0000-\u001f]+$/),
    purpose: replayFileGrantPurposeSchema,
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
export type ReplaySelectedFileGrant = z.infer<typeof replaySelectedFileGrantSchema>

export interface ReplayVideoPreparationView {
  sourceGrant: ReplaySelectedFileGrant
  sidecarGrant: ReplaySelectedFileGrant | null
  fileName: string
  fileSizeBytes: number
  probe: {
    durationSeconds: number
    width: number
    height: number
    fps: number
    codec: string
  }
  calibration: MinimapCalibration
  metadata: CoachReplayImportMetadata
  capabilityStatus: ReplayCapabilityStatus
  hasExplicitSidecarGameTime: boolean
  imageDataUrl: string
  expiresAt: number
  artifactSha256: string
  sidecarSha256: string | null
}

export interface CoachReplayFrame {
  timestamp: number
  liveData?: LiveGameSnapshot
  minimap?: MinimapObservationBatch
}

export interface CoachReplaySession {
  metadata: {
    sessionId: string
    patch: string
    recordedAt: number
    durationSeconds: number
    mapId: number
    queueId: number
  }
  frames: CoachReplayFrame[]
}

export const coachReplayFrameSchema = z
  .object({
    timestamp: z.number().finite().min(0),
    liveData: liveGameSnapshotSchema.optional(),
    minimap: minimapObservationBatchSchema.optional()
  })
  .refine((frame) => frame.liveData !== undefined || frame.minimap !== undefined, {
    message: 'Each replay frame must contain liveData or minimap observations'
  })

export const coachReplaySessionSchema = z
  .object({
    metadata: z.object({
      sessionId: z.string().min(1).max(200),
      patch: z.string().min(1).max(50),
      recordedAt: z.number().finite().min(0),
      durationSeconds: z
        .number()
        .finite()
        .positive()
        .max(4 * 60 * 60),
      mapId: z.number().int(),
      queueId: z.number().int()
    }),
    frames: z.array(coachReplayFrameSchema).max(500_000)
  })
  .superRefine((session, context) => {
    for (let index = 1; index < session.frames.length; index++) {
      if (session.frames[index].timestamp < session.frames[index - 1].timestamp) {
        context.addIssue({
          code: 'custom',
          path: ['frames', index, 'timestamp'],
          message: 'Replay frame timestamps must be in ascending order'
        })
        return
      }
    }
  })

export interface CoachReplaySidecarV1 {
  schemaVersion: 1
  artifactSha256: string
  source: string
  producerVersion: string
  exportedAt: string
  patch: string | null
  mapId: number | null
  queueId: number | null
  selfTeam: 'blue' | 'red' | null
  selfChampionId?: number | null
  videoGameStartMs: number | null
  calibration?: MinimapCalibration
  roster: Array<{ team: 'blue' | 'red'; championId: number }> | null
  events: Array<{
    videoTimeMs: number
    gameTimeSeconds: number | null
    kind: string
    payload: unknown
  }>
}

export const coachReplaySidecarV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    artifactSha256: z
      .string()
      .regex(/^[a-f\d]{64}$/i, 'artifactSha256 must be a SHA-256 hex digest'),
    source: z.string().trim().min(1).max(200),
    producerVersion: z.string().trim().min(1).max(100),
    exportedAt: z.iso.datetime({ offset: true }),
    patch: z.string().trim().min(1).max(50).nullable(),
    mapId: z.number().int().positive().nullable(),
    queueId: z.number().int().nonnegative().nullable(),
    selfTeam: z.enum(['blue', 'red']).nullable(),
    selfChampionId: z.number().int().positive().nullable().optional(),
    videoGameStartMs: z.number().finite().nonnegative().nullable(),
    calibration: minimapCalibrationSchema.optional(),
    roster: z
      .array(
        z.object({
          team: z.enum(['blue', 'red']),
          championId: z.number().int().positive()
        })
      )
      .max(10)
      .nullable(),
    events: z
      .array(
        z.object({
          videoTimeMs: z.number().finite().nonnegative(),
          gameTimeSeconds: z.number().finite().nonnegative().nullable(),
          kind: z.string().trim().min(1).max(100),
          payload: z.unknown()
        })
      )
      .max(500_000)
  })
  .superRefine((sidecar, context) => {
    for (let index = 1; index < sidecar.events.length; index++) {
      if (sidecar.events[index].videoTimeMs < sidecar.events[index - 1].videoTimeMs) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'videoTimeMs'],
          message: 'Sidecar event video timestamps must be in ascending order'
        })
        return
      }
    }
  })

export const coachReplayImportMetadataSchema = z.object({
  patch: z.string().trim().min(1).max(50).nullable(),
  mapId: z.number().int().positive().nullable(),
  queueId: z.number().int().nonnegative().nullable(),
  selfTeam: z.enum(['blue', 'red']).nullable(),
  selfChampionId: z.number().int().positive().nullable(),
  minimapSide: z.enum(['left', 'right']).nullable(),
  videoGameStartMs: z.number().finite().nonnegative().nullable(),
  roster: z
    .array(
      z.object({
        team: z.enum(['blue', 'red']),
        championId: z.number().int().positive()
      })
    )
    .max(10)
    .nullable()
})

export type CoachReplayImportMetadata = z.infer<typeof coachReplayImportMetadataSchema>

const replayImportRoiSchema = minimapCalibrationSchema.shape.roi
  .strict()
  .superRefine((roi, context) => {
    if (roi.width <= 0 || roi.height <= 0 || roi.x + roi.width > 1 || roi.y + roi.height > 1) {
      context.addIssue({ code: 'custom', message: 'Replay ROI must stay within the source frame' })
    }
  })

export const prepareVideoReplayRequestSchema = z
  .object({
    sourceToken: replayFileGrantTokenSchema,
    sidecarToken: replayFileGrantTokenSchema.optional()
  })
  .strict()
export type PrepareVideoReplayRequest = z.infer<typeof prepareVideoReplayRequestSchema>

export const importVideoReplayRequestSchema = prepareVideoReplayRequestSchema
  .extend({
    roi: replayImportRoiSchema.optional(),
    metadata: coachReplayImportMetadataSchema.strict().optional()
  })
  .strict()
export type ImportVideoReplayRequest = z.infer<typeof importVideoReplayRequestSchema>

export const retryReplayAnalysisRequestSchema = z
  .object({
    analysisId: z.uuid(),
    sourceToken: replayFileGrantTokenSchema,
    sidecarToken: replayFileGrantTokenSchema.optional()
  })
  .strict()
export type RetryReplayAnalysisRequest = z.infer<typeof retryReplayAnalysisRequestSchema>

export const revokeReplayFileGrantsRequestSchema = z
  .object({ tokens: z.array(replayFileGrantTokenSchema).max(8) })
  .strict()
export type RevokeReplayFileGrantsRequest = z.infer<typeof revokeReplayFileGrantsRequestSchema>

export interface ReplayCapabilityStatus {
  available: string[]
  disabled: Array<{ capability: string; reason: string }>
  missingFields: string[]
}

export function getReplayCapabilityStatus(
  metadata: CoachReplayImportMetadata,
  hasSidecar: boolean,
  hasExplicitSidecarGameTime: boolean = false
): ReplayCapabilityStatus {
  const available = ['minimap-basic']
  const disabled: ReplayCapabilityStatus['disabled'] = []
  const missingFields: string[] = []

  if (!metadata.patch) missingFields.push('patch')
  if (!metadata.mapId) missingFields.push('mapId')
  if (!metadata.selfTeam) missingFields.push('selfTeam')
  if (!metadata.selfChampionId) missingFields.push('selfChampionId')
  if (!metadata.roster?.length) missingFields.push('roster')
  if (metadata.videoGameStartMs === null) missingFields.push('videoGameStartMs')

  if (metadata.mapId === 11 && metadata.selfTeam) {
    available.push('region-change', 'visible-grouping')
  } else {
    disabled.push({
      capability: 'region-change',
      reason: 'requires-summoners-rift-and-team'
    })
  }

  if (metadata.patch && metadata.selfTeam && metadata.roster?.length) {
    available.push('champion-identity-candidate')
  } else {
    disabled.push({
      capability: 'champion-identity',
      reason: 'requires-patch-team-roster-and-validated-model'
    })
  }

  if (metadata.selfChampionId && metadata.roster?.length && metadata.selfTeam) {
    available.push('approaching-player-candidate')
  } else {
    disabled.push({
      capability: 'approaching-player',
      reason: 'requires-self-champion-team-roster-and-position'
    })
  }

  if (hasSidecar && (metadata.videoGameStartMs !== null || hasExplicitSidecarGameTime)) {
    available.push('sidecar-events')
  } else if (hasSidecar) {
    disabled.push({
      capability: 'sidecar-dependent-rules',
      reason: 'requires-sidecar-time-alignment'
    })
  } else {
    disabled.push({
      capability: 'sidecar-dependent-rules',
      reason: 'requires-structured-sidecar'
    })
  }

  return { available, disabled, missingFields }
}
