import type {
  CoachFeedbackRecord,
  LiveCoachAcceptanceSession,
  LiveCoachOfflineAcceptanceRecord
} from '@shared/types/live-coach'
import { liveCoachAcceptanceReportSchema } from '@shared/types/live-coach'
import { describe, expect, it } from 'vitest'

import {
  buildLiveCoachAcceptanceReport,
  hashAcceptanceIdentifier,
  summarizeAcceptanceMetric
} from './acceptance-report'

function createSession(index: number): LiveCoachAcceptanceSession {
  const cueId = `private-session-${index}-cue`
  const startedAt = index * 10_000_000
  const endedAt = startedAt + 7_200_000
  return {
    recordId: `record-${index}`,
    source: 'live-game',
    mode: 'shadow',
    sessionIdHash: hashAcceptanceIdentifier(`private-session-${index}`),
    buildChannel: 'internal',
    mapId: 11,
    queueId: 420,
    patch: '16.16.1',
    startedAt,
    endedAt,
    durationSeconds: 7_200,
    durationBasis: 'fresh-healthy-intervals-v2',
    analysisIntervals: [{ startedAt, endedAt }],
    completionBasis: 'observed-gameflow-end',
    endReason: 'gameflow-phase-EndOfGame',
    capture: {
      backend: 'wgc',
      resolution: '1920x1080',
      minimapSide: 'right',
      roiCounts: { healthy: 100, degraded: 0, unknown: 0, unsupported: 0 },
      roiEverHealthy: true,
      roiFirstHealthyMs: 250,
      dropCountStart: 0,
      dropCountEnd: 0
    },
    roiEpisodes: [
      {
        episodeIdHash: hashAcceptanceIdentifier(`roi-episode-${index}`),
        trigger: 'session-start',
        calibrationIdHash: hashAcceptanceIdentifier(`calibration-${index}`),
        startedAt,
        endedAt: startedAt + 250,
        outcome: 'healthy',
        firstHealthyAt: startedAt + 250
      }
    ],
    performance: {
      captureLatencyMs: summarizeAcceptanceMetric([10, 20]),
      inferenceLatencyMs: summarizeAcceptanceMetric([30, 40]),
      frameAgeMs: summarizeAcceptanceMetric([40, 60]),
      captureFps: summarizeAcceptanceMetric([5, 5]),
      appCpuPercent: summarizeAcceptanceMetric([2, 3]),
      appWorkingSetMiB: summarizeAcceptanceMetric([200, 210])
    },
    cues: [
      {
        cueIdHash: hashAcceptanceIdentifier(cueId),
        ruleId: 'rule_missing_enemy',
        ruleVersion: '1',
        evidenceIdHashes: [hashAcceptanceIdentifier(`private-evidence-${index}`)],
        category: 'warning',
        priority: 80,
        evidenceVerifiedAtEmission: true,
        createdAt: startedAt + 10_000,
        expiresAt: startedAt + 20_000,
        terminalAt: startedAt + 10_500,
        status: 'suppressed',
        cancellationReason: 'shadow-mode'
      }
    ],
    errorCodes: []
  }
}

describe('live coach acceptance report', () => {
  it('evaluates locally measurable gates and never exposes raw session, cue, or evidence ids', () => {
    const sessions = Array.from({ length: 50 }, (_, index) => createSession(index))
    const offlineRecords: LiveCoachOfflineAcceptanceRecord[] = Array.from(
      { length: 100 },
      (_, index) => ({
        recordId: `offline-${index}`,
        attemptedAt: index,
        format: 'video',
        success: true,
        artifactSha256: index.toString(16).padStart(64, '0'),
        patch: '16.16.1',
        durationSeconds: 1_800,
        frameCount: 9_000,
        cueCount: 1,
        errorCode: null
      })
    )
    const feedback: CoachFeedbackRecord[] = sessions.map((_, index) => ({
      id: `feedback-${index}`,
      cueId: `private-session-${index}-cue`,
      sessionId: `private-session-${index}`,
      ruleId: 'rule_missing_enemy',
      ruleVersion: '1',
      evidenceIds: [`private-evidence-${index}`],
      type: 'useful',
      comment: null,
      status: 'active',
      createdAt: index,
      withdrawnAt: null
    }))

    const report = buildLiveCoachAcceptanceReport({
      sessions,
      offlineRecords,
      feedback,
      generatedAt: 123
    })

    expect(report.counts.validShadowMatches).toBe(50)
    expect(report.counts.offlineUniqueArtifacts).toBe(100)
    expect(report.totals.shadowHours).toBe(100)
    expect(report.criteria.find((item) => item.id === 'shadow-match-count')?.status).toBe('passed')
    expect(report.criteria.find((item) => item.id === 'soak-hours')?.status).toBe('passed')
    expect(report.criteria.find((item) => item.id === 'cue-traceability')?.status).toBe('passed')
    expect(report.criteria.find((item) => item.id === 'roi-startup-success')).toMatchObject({
      status: 'pending',
      reason: 'requires-cluster-confidence-analysis'
    })
    expect(report.criteria.find((item) => item.id === 'visual-accuracy')?.status).toBe('pending')
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('private-session')
    expect(serialized).not.toContain('private-evidence')
    expect(liveCoachAcceptanceReportSchema.parse(report)).toEqual(report)
    expect(() =>
      liveCoachAcceptanceReportSchema.parse({
        ...report,
        sessions: [
          {
            ...report.sessions[0],
            videoPath: 'C:\\Users\\private\\match.mp4',
            rawFrames: ['private-frame-payload']
          },
          ...report.sessions.slice(1)
        ]
      })
    ).toThrow()
  })

  it('uses a nearest-rank p95 and ignores non-finite samples', () => {
    expect(summarizeAcceptanceMetric([1, 2, 3, 4, 100, Number.NaN])).toEqual({
      count: 5,
      min: 1,
      max: 100,
      mean: 22,
      p95: 100
    })
  })

  it('ignores feedback for cues outside the retained acceptance sessions', () => {
    const session = createSession(1)
    const feedback: CoachFeedbackRecord[] = [
      {
        id: 'unrelated-feedback',
        cueId: 'cue-from-an-old-pruned-session',
        sessionId: 'old-session',
        ruleId: 'old-rule',
        ruleVersion: '1',
        evidenceIds: ['old-evidence'],
        type: 'incorrect',
        comment: null,
        status: 'active',
        createdAt: 1,
        withdrawnAt: null
      }
    ]

    const report = buildLiveCoachAcceptanceReport({
      sessions: [session],
      offlineRecords: [],
      feedback,
      generatedAt: 123
    })

    expect(report.counts.labeledCues).toBe(0)
    expect(report.counts.incorrectCues).toBe(0)
    expect(report.totals.cueLabelCoverage).toBe(0)
    expect(report.totals.cueErrorRatePer30Minutes).toBe(0)
  })

  it('does not let active snapshots or internal simulation cues advance formal gates', () => {
    const active = {
      ...createSession(1),
      endReason: 'active-snapshot'
    }
    const internal = {
      ...createSession(2),
      source: 'internal-simulation' as const,
      cues: [
        {
          ...createSession(2).cues[0],
          evidenceIdHashes: []
        }
      ]
    }
    const report = buildLiveCoachAcceptanceReport({
      sessions: [active, internal],
      offlineRecords: [],
      feedback: [
        {
          id: 'internal-feedback',
          cueId: 'private-session-2-cue',
          sessionId: 'private-session-2',
          ruleId: 'rule_missing_enemy',
          ruleVersion: '1',
          evidenceIds: [],
          type: 'incorrect',
          comment: null,
          status: 'active',
          createdAt: 1,
          withdrawnAt: null
        }
      ],
      generatedAt: 123
    })

    expect(report.counts).toMatchObject({
      realtimeSessions: 0,
      validShadowMatches: 0,
      totalCues: 0,
      labeledCues: 0,
      incorrectCues: 0
    })
    expect(report.totals).toMatchObject({ realtimeHours: 0, shadowHours: 0 })
    expect(report.criteria.find((item) => item.id === 'cue-traceability')).toMatchObject({
      status: 'pending',
      reason: 'requires-cue-samples'
    })
  })

  it('does not trust a caller-controlled completed end reason without observed gameflow completion', () => {
    const spoofed = {
      ...createSession(6),
      completionBasis: 'unverified' as const,
      endReason: 'completed'
    }

    const report = buildLiveCoachAcceptanceReport({
      sessions: [spoofed],
      offlineRecords: [],
      feedback: [],
      generatedAt: 123
    })

    expect(report.counts.realtimeSessions).toBe(1)
    expect(report.counts.validShadowMatches).toBe(0)
    expect(report.counts.roiEpisodes).toBe(0)
    expect(report.counts.totalCues).toBe(0)
  })

  it('fails cue traceability when a cue only self-reports arbitrary evidence hashes', () => {
    const session = createSession(7)
    session.cues.push({
      ...session.cues[0],
      cueIdHash: hashAcceptanceIdentifier('fake-evidence-cue'),
      evidenceIdHashes: [hashAcceptanceIdentifier('arbitrary-nonexistent-evidence')],
      evidenceVerifiedAtEmission: false
    })

    const report = buildLiveCoachAcceptanceReport({
      sessions: [session],
      offlineRecords: [],
      feedback: [],
      generatedAt: 123
    })

    expect(report.totals.traceabilityRate).toBe(0.5)
    expect(report.criteria.find((item) => item.id === 'cue-traceability')).toMatchObject({
      status: 'failed',
      reason: 'cue-evidence-traceability-incomplete'
    })
  })

  it('counts every session-start and recalibration episode instead of the final success only', () => {
    const session = createSession(8)
    const startedAt = session.startedAt
    session.roiEpisodes = [
      {
        episodeIdHash: hashAcceptanceIdentifier('roi-startup-failed'),
        trigger: 'session-start',
        calibrationIdHash: null,
        startedAt,
        endedAt: startedAt + 1_000,
        outcome: 'failed',
        firstHealthyAt: null
      },
      {
        episodeIdHash: hashAcceptanceIdentifier('roi-recalibration-failed'),
        trigger: 'recalibration',
        calibrationIdHash: null,
        startedAt: startedAt + 1_000,
        endedAt: startedAt + 2_000,
        outcome: 'failed',
        firstHealthyAt: null
      },
      {
        episodeIdHash: hashAcceptanceIdentifier('roi-recalibration-healthy'),
        trigger: 'recalibration',
        calibrationIdHash: hashAcceptanceIdentifier('final-calibration'),
        startedAt: startedAt + 2_000,
        endedAt: startedAt + 2_500,
        outcome: 'healthy',
        firstHealthyAt: startedAt + 2_500
      }
    ]
    session.capture.roiFirstHealthyMs = 2_500

    const report = buildLiveCoachAcceptanceReport({
      sessions: [session],
      offlineRecords: [],
      feedback: [],
      generatedAt: 123
    })

    expect(report.counts.roiEpisodes).toBe(3)
    expect(report.counts.successfulRoiEpisodes).toBe(1)
    expect(report.totals.roiStartupSuccessRate).toBeCloseTo(1 / 3)
    expect(report.criteria.find((item) => item.id === 'roi-startup-success')).toMatchObject({
      status: 'pending',
      reason: 'requires-more-roi-startup-episodes'
    })
  })

  it('unions overlapping restart segments and deduplicates one real game and its cues', () => {
    const sessionIdHash = hashAcceptanceIdentifier('one-real-game')
    const first = {
      ...createSession(1),
      recordId: 'restart-segment-1',
      sessionIdHash,
      startedAt: 0,
      endedAt: 240_000,
      durationSeconds: 240,
      analysisIntervals: [{ startedAt: 0, endedAt: 240_000 }],
      completionBasis: 'unverified' as const,
      roiEpisodes: [
        {
          ...createSession(1).roiEpisodes[0],
          episodeIdHash: hashAcceptanceIdentifier('restart-roi-1'),
          startedAt: 0,
          endedAt: 250,
          firstHealthyAt: 250
        }
      ],
      endReason: 'unexpected-app-exit'
    }
    const second = {
      ...createSession(1),
      recordId: 'restart-segment-2',
      sessionIdHash,
      startedAt: 120_000,
      endedAt: 360_000,
      durationSeconds: 240,
      analysisIntervals: [{ startedAt: 120_000, endedAt: 360_000 }],
      roiEpisodes: [
        {
          ...createSession(1).roiEpisodes[0],
          episodeIdHash: hashAcceptanceIdentifier('restart-roi-2'),
          startedAt: 120_000,
          endedAt: 120_250,
          firstHealthyAt: 120_250
        }
      ],
      endReason: 'gameflow-phase-EndOfGame'
    }
    const duplicate = {
      ...second,
      recordId: 'duplicate-segment'
    }

    const report = buildLiveCoachAcceptanceReport({
      sessions: [first, second, duplicate],
      offlineRecords: [],
      feedback: [],
      generatedAt: 123
    })

    expect(report.counts.realtimeSessions).toBe(1)
    expect(report.counts.validShadowMatches).toBe(1)
    expect(report.counts.totalCues).toBe(1)
    expect(report.totals.shadowHours).toBeCloseTo(0.1)
  })

  it('uses deduplicated completed Shadow candidates for the ROI startup denominator', () => {
    const sessions = Array.from({ length: 50 }, (_, index) => {
      const session = createSession(index)
      return {
        ...session,
        durationSeconds: index === 0 ? 0 : 300,
        endedAt: session.startedAt + 300_000,
        analysisIntervals:
          index === 0
            ? []
            : [{ startedAt: session.startedAt, endedAt: session.startedAt + 300_000 }],
        capture: {
          ...session.capture,
          roiEverHealthy: index !== 0,
          roiFirstHealthyMs: index === 0 ? null : session.capture.roiFirstHealthyMs
        },
        roiEpisodes:
          index === 0
            ? [
                {
                  ...session.roiEpisodes[0],
                  endedAt: session.startedAt + 300_000,
                  outcome: 'failed' as const,
                  firstHealthyAt: null
                }
              ]
            : session.roiEpisodes
      }
    })

    const report = buildLiveCoachAcceptanceReport({
      sessions,
      offlineRecords: [],
      feedback: [],
      generatedAt: 123
    })

    expect(report.counts.validShadowMatches).toBe(49)
    expect(report.counts.roiEpisodes).toBe(50)
    expect(report.counts.successfulRoiEpisodes).toBe(49)
    expect(report.totals.roiStartupSuccessRate).toBe(0.98)
    expect(report.criteria.find((item) => item.id === 'roi-startup-success')).toMatchObject({
      status: 'failed',
      reason: 'roi-startup-rate-below-threshold'
    })
  })
})
