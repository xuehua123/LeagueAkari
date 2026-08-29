import type {
  AcceptanceMetricSummary,
  CoachFeedbackRecord,
  LiveCoachAcceptanceCriterion,
  LiveCoachAcceptanceReport,
  LiveCoachAcceptanceSession,
  LiveCoachOfflineAcceptanceRecord
} from '@shared/types/live-coach'
import { liveCoachAcceptanceReportSchema } from '@shared/types/live-coach'
import { createHash } from 'node:crypto'

export function hashAcceptanceIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function summarizeAcceptanceMetric(values: number[]): AcceptanceMetricSummary {
  const finite = values.filter(Number.isFinite).toSorted((left, right) => left - right)
  if (finite.length === 0) {
    return { count: 0, min: null, max: null, mean: null, p95: null }
  }
  const p95Index = Math.max(0, Math.ceil(finite.length * 0.95) - 1)
  return {
    count: finite.length,
    min: finite[0],
    max: finite[finite.length - 1],
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
    p95: finite[p95Index]
  }
}

function combineMetricSummaries(
  sessions: LiveCoachAcceptanceSession[],
  key: keyof LiveCoachAcceptanceSession['performance']
): AcceptanceMetricSummary {
  const summaries = sessions.map((session) => session.performance[key]).filter((item) => item.count)
  if (summaries.length === 0) {
    return summarizeAcceptanceMetric([])
  }
  const count = summaries.reduce((sum, item) => sum + item.count, 0)
  return {
    count,
    min: Math.min(...summaries.map((item) => item.min!)),
    max: Math.max(...summaries.map((item) => item.max!)),
    mean: summaries.reduce((sum, item) => sum + item.mean! * item.count, 0) / Math.max(1, count),
    // Completed sessions retain their own exact p95. The cross-session value is deliberately the
    // conservative maximum rather than pretending that session summaries are raw independent samples.
    p95: Math.max(...summaries.map((item) => item.p95!))
  }
}

function progressCriterion(
  id: string,
  value: number,
  target: number,
  targetText: string,
  reason: string
): LiveCoachAcceptanceCriterion {
  return {
    id,
    status: value >= target ? 'passed' : 'pending',
    value,
    target: targetText,
    reason: value >= target ? null : reason
  }
}

interface AcceptanceSessionGroup {
  sessionIdHash: string
  sessions: LiveCoachAcceptanceSession[]
  durationSeconds: number
}

function groupAcceptanceSessions(sessions: LiveCoachAcceptanceSession[]): AcceptanceSessionGroup[] {
  const grouped = new Map<string, LiveCoachAcceptanceSession[]>()
  const uniqueRecords = new Map<string, LiveCoachAcceptanceSession>()
  const conflictingRecordIds = new Set<string>()
  for (const session of sessions) {
    const previous = uniqueRecords.get(session.recordId)
    if (!previous) uniqueRecords.set(session.recordId, session)
    else if (JSON.stringify(previous) !== JSON.stringify(session)) {
      conflictingRecordIds.add(session.recordId)
    }
  }
  for (const session of uniqueRecords.values()) {
    if (conflictingRecordIds.has(session.recordId)) continue
    const existing = grouped.get(session.sessionIdHash)
    if (existing) existing.push(session)
    else grouped.set(session.sessionIdHash, [session])
  }
  return Array.from(grouped, ([sessionIdHash, groupedSessions]) => ({
    sessionIdHash,
    sessions: groupedSessions.toSorted((left, right) => left.startedAt - right.startedAt),
    durationSeconds: calculateNonOverlappingAnalyzedSeconds(groupedSessions)
  }))
}

function calculateNonOverlappingAnalyzedSeconds(sessions: LiveCoachAcceptanceSession[]): number {
  const intervals = sessions
    .flatMap((session) => session.analysisIntervals)
    .map((interval) => ({ start: interval.startedAt, end: interval.endedAt }))
    .filter((interval) => interval.end > interval.start)
    .toSorted((left, right) => left.start - right.start)
  let unionMilliseconds = 0
  let currentStart: number | null = null
  let currentEnd: number | null = null
  for (const interval of intervals) {
    if (currentStart === null || currentEnd === null) {
      currentStart = interval.start
      currentEnd = interval.end
      continue
    }
    if (interval.start > currentEnd) {
      unionMilliseconds += currentEnd - currentStart
      currentStart = interval.start
      currentEnd = interval.end
    } else {
      currentEnd = Math.max(currentEnd, interval.end)
    }
  }
  if (currentStart !== null && currentEnd !== null) {
    unionMilliseconds += currentEnd - currentStart
  }
  return unionMilliseconds / 1_000
}

function isCompletedShadowGroup(group: AcceptanceSessionGroup): boolean {
  return (
    group.sessions.some((session) => session.completionBasis === 'observed-gameflow-end') &&
    group.sessions.every(
      (session) =>
        session.mode === 'shadow' &&
        session.mapId === 11 &&
        (session.capture.backend === null ||
          session.capture.backend === 'wgc' ||
          session.capture.backend === 'dda')
    )
  )
}

function isValidShadowGroup(group: AcceptanceSessionGroup): boolean {
  const analyzedSegments = group.sessions.filter((session) => session.durationSeconds > 0)
  return (
    isCompletedShadowGroup(group) &&
    analyzedSegments.length > 0 &&
    group.durationSeconds >= 300 &&
    analyzedSegments.every((session) => ['wgc', 'dda'].includes(session.capture.backend ?? '')) &&
    collectUniqueRoiEpisodes([group]).some((episode) => episode.outcome === 'healthy')
  )
}

function collectUniqueRoiEpisodes(groups: AcceptanceSessionGroup[]) {
  const episodes = new Map<string, LiveCoachAcceptanceSession['roiEpisodes'][number]>()
  for (const episode of groups.flatMap((group) =>
    group.sessions.flatMap((session) => session.roiEpisodes)
  )) {
    const previous = episodes.get(episode.episodeIdHash)
    if (!previous) {
      episodes.set(episode.episodeIdHash, episode)
    } else if (JSON.stringify(previous) !== JSON.stringify(episode)) {
      // Conflicting duplicate records fail closed: a claimed success never overwrites a failure.
      episodes.set(episode.episodeIdHash, {
        ...previous,
        endedAt: Math.max(previous.endedAt, episode.endedAt),
        outcome: 'failed',
        firstHealthyAt: null
      })
    }
  }
  return Array.from(episodes.values())
}

function collectUniqueCues(sessions: LiveCoachAcceptanceSession[]) {
  const cues = new Map<string, LiveCoachAcceptanceSession['cues'][number]>()
  for (const cue of sessions.flatMap((session) => session.cues)) {
    const previous = cues.get(cue.cueIdHash)
    if (!previous) {
      cues.set(cue.cueIdHash, cue)
      continue
    }
    const traceFieldsMatch =
      previous.ruleId === cue.ruleId &&
      previous.ruleVersion === cue.ruleVersion &&
      previous.createdAt === cue.createdAt &&
      previous.expiresAt === cue.expiresAt &&
      previous.evidenceIdHashes.length === cue.evidenceIdHashes.length &&
      previous.evidenceIdHashes.every(
        (evidenceIdHash, index) => cue.evidenceIdHashes[index] === evidenceIdHash
      )
    cues.set(cue.cueIdHash, {
      ...(previous.terminalAt >= cue.terminalAt ? previous : cue),
      evidenceVerifiedAtEmission:
        traceFieldsMatch && previous.evidenceVerifiedAtEmission && cue.evidenceVerifiedAtEmission
    })
  }
  return Array.from(cues.values())
}

export function buildLiveCoachAcceptanceReport(params: {
  sessions: LiveCoachAcceptanceSession[]
  offlineRecords: LiveCoachOfflineAcceptanceRecord[]
  feedback: CoachFeedbackRecord[]
  generatedAt?: number
}): LiveCoachAcceptanceReport {
  const generatedAt = params.generatedAt ?? Date.now()
  const sessions = params.sessions.toSorted((left, right) => left.startedAt - right.startedAt)
  const offlineRecords = params.offlineRecords.toSorted(
    (left, right) => left.attemptedAt - right.attemptedAt
  )
  // Active snapshots remain useful for crash recovery on disk, but they are not completed
  // acceptance evidence and must never advance a gate while a game is still running.
  const closedLiveSessions = sessions.filter(
    (session) => session.source === 'live-game' && session.endReason !== 'active-snapshot'
  )
  const liveSessionGroups = groupAcceptanceSessions(closedLiveSessions)
  const completedShadowGroups = liveSessionGroups.filter(isCompletedShadowGroup)
  const validShadowGroups = completedShadowGroups.filter(isValidShadowGroup)
  const validShadowSessions = validShadowGroups.flatMap((group) => group.sessions)
  const roiEpisodes = collectUniqueRoiEpisodes(completedShadowGroups)
  const successfulRoiEpisodes = roiEpisodes.filter((episode) => episode.outcome === 'healthy')
  const successfulOffline = offlineRecords.filter((record) => record.success)
  const uniqueOfflineArtifacts = new Set(
    successfulOffline.flatMap((record) => (record.artifactSha256 ? [record.artifactSha256] : []))
  )
  const allCues = collectUniqueCues(validShadowSessions)
  const allCueHashes = new Set(allCues.map((cue) => cue.cueIdHash))
  const activeFeedback = params.feedback.filter((feedback) => feedback.status === 'active')
  const labeledCueHashes = new Set(
    activeFeedback
      .map((feedback) => hashAcceptanceIdentifier(feedback.cueId))
      .filter((cueIdHash) => allCueHashes.has(cueIdHash))
  )
  const incorrectCueHashes = new Set(
    activeFeedback
      .filter((feedback) => feedback.type === 'incorrect')
      .map((feedback) => hashAcceptanceIdentifier(feedback.cueId))
      .filter((cueIdHash) => allCueHashes.has(cueIdHash))
  )
  const realtimeHours =
    liveSessionGroups.reduce((sum, group) => sum + group.durationSeconds, 0) / 3600
  const shadowHours =
    validShadowGroups.reduce((sum, group) => sum + group.durationSeconds, 0) / 3600
  const offlineHours =
    successfulOffline.reduce((sum, record) => sum + (record.durationSeconds ?? 0), 0) / 3600
  const labelCoverage = allCues.length > 0 ? labeledCueHashes.size / allCues.length : null
  const traceableCues = allCues.filter(
    (cue) =>
      cue.ruleId.length > 0 &&
      cue.ruleVersion.length > 0 &&
      cue.evidenceIdHashes.length > 0 &&
      cue.evidenceVerifiedAtEmission &&
      cue.expiresAt >= cue.createdAt &&
      cue.terminalAt >= cue.createdAt
  )
  const traceabilityRate = allCues.length > 0 ? traceableCues.length / allCues.length : null
  const roiStartupSuccessRate =
    roiEpisodes.length > 0 ? successfulRoiEpisodes.length / roiEpisodes.length : null
  const cueErrorRatePer30Minutes =
    shadowHours > 0 ? incorrectCueHashes.size / (shadowHours * 2) : null

  const criteria: LiveCoachAcceptanceCriterion[] = [
    progressCriterion(
      'shadow-match-count',
      validShadowGroups.length,
      50,
      '>=50',
      'requires-more-real-shadow-matches'
    ),
    progressCriterion(
      'offline-replay-count',
      uniqueOfflineArtifacts.size,
      100,
      '>=100',
      'requires-more-unique-offline-replays'
    ),
    progressCriterion('soak-hours', shadowHours, 100, '>=100h', 'requires-more-real-shadow-hours'),
    {
      id: 'roi-startup-success',
      status:
        roiEpisodes.length >= 50 && roiStartupSuccessRate !== null && roiStartupSuccessRate < 0.99
          ? 'failed'
          : 'pending',
      value: roiStartupSuccessRate,
      target:
        '>=99% across >=50 session-start/recalibration episodes with cluster-aware 95% lower bound >=99%',
      reason:
        roiEpisodes.length < 50
          ? 'requires-more-roi-startup-episodes'
          : roiStartupSuccessRate !== null && roiStartupSuccessRate < 0.99
            ? 'roi-startup-rate-below-threshold'
            : 'requires-cluster-confidence-analysis'
    },
    {
      id: 'cue-traceability',
      status: traceabilityRate === null ? 'pending' : traceabilityRate === 1 ? 'passed' : 'failed',
      value: traceabilityRate,
      target: '100%',
      reason:
        traceabilityRate === null
          ? 'requires-cue-samples'
          : traceabilityRate === 1
            ? null
            : 'cue-evidence-traceability-incomplete'
    },
    {
      id: 'cue-error-rate',
      status:
        labelCoverage !== null && labelCoverage >= 0.95 && cueErrorRatePer30Minutes !== null
          ? cueErrorRatePer30Minutes <= 0.5
            ? 'passed'
            : 'failed'
          : 'pending',
      value: cueErrorRatePer30Minutes,
      target: '<=0.5 per 30 minutes with >=95% cue labels',
      reason:
        labelCoverage !== null && labelCoverage >= 0.95
          ? cueErrorRatePer30Minutes !== null && cueErrorRatePer30Minutes <= 0.5
            ? null
            : 'cue-error-rate-above-threshold'
          : 'requires-complete-cue-labels'
    },
    {
      id: 'visual-accuracy',
      status: 'pending',
      value: null,
      target: 'Precision lower bound >=98%; Recall lower bound >=85%',
      reason: 'requires-independent-ground-truth-annotations'
    },
    {
      id: 'false-healthy',
      status: 'pending',
      value: null,
      target: '0 confirmed events',
      reason: 'requires-reviewed-roi-failure-labels'
    },
    {
      id: 'paired-performance',
      status: 'pending',
      value: null,
      target: 'CPU/GPU/memory/VRAM incremental limits',
      reason: 'requires-paired-disabled-enabled-benchmark'
    },
    {
      id: 'game-fps-impact',
      status: 'pending',
      value: null,
      target: '<5% 1% low FPS reduction',
      reason: 'requires-game-frame-time-capture'
    }
  ]

  return liveCoachAcceptanceReportSchema.parse({
    schemaVersion: 2,
    generatedAt,
    counts: {
      realtimeSessions: liveSessionGroups.length,
      validShadowMatches: validShadowGroups.length,
      offlineAttempts: offlineRecords.length,
      offlineSuccessful: successfulOffline.length,
      offlineUniqueArtifacts: uniqueOfflineArtifacts.size,
      totalCues: allCues.length,
      labeledCues: labeledCueHashes.size,
      incorrectCues: incorrectCueHashes.size,
      roiEpisodes: roiEpisodes.length,
      successfulRoiEpisodes: successfulRoiEpisodes.length
    },
    totals: {
      realtimeHours,
      shadowHours,
      offlineHours,
      cueErrorRatePer30Minutes,
      cueLabelCoverage: labelCoverage,
      traceabilityRate,
      roiStartupSuccessRate
    },
    aggregatePerformance: {
      captureLatencyMs: combineMetricSummaries(validShadowSessions, 'captureLatencyMs'),
      inferenceLatencyMs: combineMetricSummaries(validShadowSessions, 'inferenceLatencyMs'),
      frameAgeMs: combineMetricSummaries(validShadowSessions, 'frameAgeMs'),
      captureFps: combineMetricSummaries(validShadowSessions, 'captureFps'),
      appCpuPercent: combineMetricSummaries(validShadowSessions, 'appCpuPercent'),
      appWorkingSetMiB: combineMetricSummaries(validShadowSessions, 'appWorkingSetMiB')
    },
    criteria,
    sessions,
    offlineRecords,
    privacy: {
      rawFramesIncluded: false,
      gameVideoIncluded: false,
      microphoneAudioIncluded: false,
      summonerNamesIncluded: false,
      sessionIdsHashed: true,
      cueAndEvidenceIdsHashed: true,
      fullPathsIncluded: false
    }
  })
}
