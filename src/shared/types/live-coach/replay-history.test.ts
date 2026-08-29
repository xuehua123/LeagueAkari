import { describe, expect, it } from 'vitest'

import {
  createReplayAnalysisFingerprint,
  projectReplayAnalysisResult
} from '../../../main/shards/live-coach/replay-history/projection'
import {
  REPLAY_HISTORY_SCHEMA_VERSION,
  replayAnalysisHistoryDocumentSchema,
  replayAnalysisStoredResultSchema
} from './replay-history'

const HISTORY_ID = '1602a2cc-9796-4b7d-a58b-77b337eb31cd'
const ARTIFACT_SHA = 'a'.repeat(64)
const SIDECAR_SHA = 'b'.repeat(64)

function createFingerprintInput() {
  return {
    artifactSha256: ARTIFACT_SHA,
    sidecarSha256: SIDECAR_SHA,
    metadata: {
      patch: '16.17.1',
      mapId: 11,
      queueId: 420,
      selfTeam: 'blue' as const,
      selfChampionId: 266,
      minimapSide: 'right' as const,
      videoGameStartMs: 5_000,
      roster: [{ team: 'blue' as const, championId: 266 }]
    },
    roi: { x: 0.8, y: 0.7, width: 0.2, height: 0.3 },
    manifest: {
      pipelineVersion: '1',
      ruleCatalogVersion: '16.17.1',
      ffmpegVersion: '7.1',
      runtimeVersion: 'node-22',
      models: {
        minimap: { version: '1', sha256: 'c'.repeat(64) }
      }
    }
  }
}

describe('replay history privacy contracts', () => {
  it('creates a deterministic fingerprint from the artifact, sidecar, metadata, ROI and manifest', () => {
    const input = createFingerprintInput()
    const first = createReplayAnalysisFingerprint(input)
    const reordered = createReplayAnalysisFingerprint({
      ...input,
      manifest: {
        ...input.manifest,
        models: {
          second: { version: '2', sha256: null },
          minimap: input.manifest.models.minimap
        }
      }
    })
    const sameReordered = createReplayAnalysisFingerprint({
      ...input,
      manifest: {
        ...input.manifest,
        models: {
          minimap: input.manifest.models.minimap,
          second: { version: '2', sha256: null }
        }
      }
    })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(reordered).toBe(sameReordered)
    expect(createReplayAnalysisFingerprint({ ...input, sidecarSha256: null })).not.toBe(first)
    expect(
      createReplayAnalysisFingerprint({
        ...input,
        roi: { ...input.roi, x: 0.79 }
      })
    ).not.toBe(first)
  })

  it('projects only bounded relative analysis data and redacts local paths and tokens', () => {
    const fingerprint = createReplayAnalysisFingerprint(createFingerprintInput())
    const result = projectReplayAnalysisResult({
      historyId: HISTORY_ID,
      analysisFingerprint: fingerprint,
      generatedAt: '2026-08-29T00:00:00.000Z',
      summary: {
        sourceKind: 'video',
        artifactSha256: ARTIFACT_SHA,
        sidecarSha256: SIDECAR_SHA,
        metadata: createFingerprintInput().metadata,
        durationSeconds: 60,
        frameCount: 300,
        analysisFps: 5,
        totalCues: 1,
        totalEvidences: 2
      },
      capabilityStatus: {
        available: ['minimap-basic'],
        disabled: [],
        missingFields: []
      },
      timeline: [
        {
          gameTimeFormatted: '01:23',
          category: 'macro',
          observation:
            'Source C:\\Users\\Alice\\My Videos\\match.mp4, then /Users/alice/My Videos/match.mp4',
          spokenText: 'Authorization: secret-value Bearer abc.def.ghi',
          options: ['read D:\\Private\\note.txt'],
          evidenceIds: ['raw-session-evidence-id']
        }
      ]
    })

    expect(result.timeline[0].gameTimeMs).toBe(83_000)
    expect(JSON.stringify(result)).not.toContain('Alice')
    expect(JSON.stringify(result)).not.toContain('Private')
    expect(JSON.stringify(result)).not.toContain('secret-value')
    expect(JSON.stringify(result)).not.toContain('raw-session-evidence-id')
    expect(result.timeline[0].evidenceHashes[0]).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects path, frame, preview and raw payload fields at every persisted boundary', () => {
    const fingerprint = createReplayAnalysisFingerprint(createFingerprintInput())
    const result = projectReplayAnalysisResult({
      historyId: HISTORY_ID,
      analysisFingerprint: fingerprint,
      summary: {
        sourceKind: 'video',
        artifactSha256: ARTIFACT_SHA,
        sidecarSha256: SIDECAR_SHA,
        metadata: createFingerprintInput().metadata,
        durationSeconds: 60,
        frameCount: 300,
        analysisFps: 5,
        totalCues: 0,
        totalEvidences: 0
      },
      capabilityStatus: { available: [], disabled: [], missingFields: [] },
      timeline: []
    })
    expect(
      replayAnalysisStoredResultSchema.safeParse({ ...result, videoPath: 'C:\\secret.mp4' }).success
    ).toBe(false)
    expect(replayAnalysisStoredResultSchema.safeParse({ ...result, frames: [] }).success).toBe(
      false
    )
    expect(
      replayAnalysisStoredResultSchema.safeParse({ ...result, previewDataUrl: 'data:image/jpeg' })
        .success
    ).toBe(false)
    expect(
      replayAnalysisStoredResultSchema.safeParse({ ...result, payload: { raw: true } }).success
    ).toBe(false)

    const entry = {
      schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION,
      id: HISTORY_ID,
      sourceKind: 'video',
      status: 'preparing',
      stage: 'queued',
      progress: 0,
      artifactSha256: ARTIFACT_SHA,
      sidecarSha256: SIDECAR_SHA,
      analysisFingerprint: fingerprint,
      metadata: createFingerprintInput().metadata,
      roi: createFingerprintInput().roi,
      manifest: createFingerprintInput().manifest,
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
      completedAt: null,
      resultId: null,
      retryOf: null,
      failureCode: null,
      durationSeconds: null,
      frameCount: null,
      analysisFps: null,
      totalCues: null,
      sourceFileName: 'identity-match.mp4'
    }
    expect(
      replayAnalysisHistoryDocumentSchema.safeParse({
        schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION,
        generation: 1,
        entries: [entry]
      }).success
    ).toBe(false)
  })
})
