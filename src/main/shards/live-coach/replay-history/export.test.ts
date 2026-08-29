import {
  type ReplayAnalysisHistoryEntry,
  type ReplayAnalysisStoredResult,
  coachReplaySidecarV1Schema
} from '@shared/types/live-coach'
import { describe, expect, it } from 'vitest'

import {
  createReplayAnalysisExportDocument,
  createReplayAnalysisMarkdown,
  replayAnalysisExportDocumentSchema
} from './export'

const ID = '00000000-0000-4000-8000-000000000001'
const FINGERPRINT = 'a'.repeat(64)

function createHistory(): ReplayAnalysisHistoryEntry {
  return {
    schemaVersion: 1,
    id: ID,
    sourceKind: 'video',
    status: 'completed',
    stage: 'completed',
    progress: 100,
    artifactSha256: 'b'.repeat(64),
    sidecarSha256: 'c'.repeat(64),
    analysisFingerprint: FINGERPRINT,
    metadata: {
      patch: '16.17.1',
      mapId: 11,
      queueId: 420,
      selfTeam: 'blue',
      selfChampionId: 266,
      minimapSide: 'right',
      videoGameStartMs: 5_000,
      roster: [{ team: 'blue', championId: 266 }]
    },
    roi: { x: 0.8, y: 0.7, width: 0.2, height: 0.3 },
    manifest: {
      pipelineVersion: '1.0.0',
      ruleCatalogVersion: '16.17.1',
      ffmpegVersion: '7.1',
      runtimeVersion: 'onnxruntime-1.29.0-dml',
      models: { champion: { version: '16.17.1', sha256: 'd'.repeat(64) } }
    },
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:01:00.000Z',
    completedAt: '2026-08-29T00:01:00.000Z',
    resultId: ID,
    retryOf: null,
    failureCode: null,
    durationSeconds: 60,
    frameCount: 300,
    analysisFps: 5,
    totalCues: 1
  }
}

function createResult(): ReplayAnalysisStoredResult {
  const history = createHistory()
  return {
    schemaVersion: 1,
    historyId: ID,
    analysisFingerprint: FINGERPRINT,
    generatedAt: '2026-08-29T00:01:00.000Z',
    summary: {
      sourceKind: 'video',
      artifactSha256: history.artifactSha256,
      sidecarSha256: history.sidecarSha256,
      metadata: history.metadata,
      durationSeconds: 60,
      frameCount: 300,
      analysisFps: 5,
      totalCues: 1,
      totalEvidences: 2
    },
    capabilityStatus: {
      available: ['minimap-basic'],
      disabled: [{ capability: 'sidecar-events', reason: 'requires-structured-sidecar' }],
      missingFields: ['metadata.queueId']
    },
    timeline: [
      {
        gameTimeMs: 30_000,
        category: 'macro',
        observation: 'Move to river',
        spokenText: 'Move to river',
        options: ['Contest'],
        evidenceHashes: ['e'.repeat(64)]
      }
    ]
  }
}

describe('replay analysis exports', () => {
  it('exports a strict analysis contract that cannot be mistaken for an import Sidecar', () => {
    const document = createReplayAnalysisExportDocument(
      createHistory(),
      createResult(),
      new Date('2026-08-29T00:02:00.000Z')
    )

    expect(replayAnalysisExportDocumentSchema.parse(document)).toEqual(document)
    expect(document).toMatchObject({
      type: 'league-akari-replay-analysis',
      history: { manifest: { pipelineVersion: '1.0.0', ruleCatalogVersion: '16.17.1' } },
      result: { summary: { analysisFps: 5, totalEvidences: 2 } }
    })
    expect(coachReplaySidecarV1Schema.safeParse(document).success).toBe(false)
  })

  it('includes versions, metrics, capability diagnostics and timeline evidence in Markdown', () => {
    const markdown = createReplayAnalysisMarkdown(createHistory(), createResult())

    for (const expected of [
      '分析帧率：5 FPS',
      '证据数量：2',
      '分析管线版本：`1\\.0\\.0`',
      '规则目录版本：`16\\.17\\.1`',
      String.raw`minimap\-basic`,
      String.raw`requires\-structured\-sidecar`,
      '证据哈希'
    ]) {
      expect(markdown).toContain(expected)
    }
  })
})
