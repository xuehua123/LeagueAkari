import {
  type CoachCue,
  type CoachFeedbackRecord,
  type LiveCoachAcceptanceAnalysisInterval,
  type LiveCoachAcceptanceCueAudit,
  type LiveCoachAcceptanceReport,
  type LiveCoachAcceptanceRoiEpisode,
  type LiveCoachAcceptanceSession,
  type LiveCoachOfflineAcceptanceRecord,
  type MinimapCalibration,
  liveCoachAcceptanceSessionSchema,
  liveCoachOfflineAcceptanceRecordSchema
} from '@shared/types/live-coach'
import {
  PROVISIONAL_LIVE_GAME_SESSION_ID,
  resolveLiveGameSessionId
} from '@shared/utils/live-game-session'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import {
  buildLiveCoachAcceptanceReport,
  hashAcceptanceIdentifier,
  summarizeAcceptanceMetric
} from './acceptance-report'
import type { LiveCoachMainContext } from './context'
import type { CueSchedulerController } from './cue-scheduler-controller'

const ACCEPTANCE_FILENAME = 'live-coach-acceptance.json'
const MAX_COMPLETED_SESSIONS = 500
const MAX_OFFLINE_RECORDS = 1000
const SAMPLE_INTERVAL_MS = 5_000
const PERSIST_INTERVAL_MS = 60_000

const acceptanceDocumentSchema = z
  .object({
    schemaVersion: z.literal(2),
    sessions: z.array(liveCoachAcceptanceSessionSchema),
    offlineRecords: z.array(liveCoachOfflineAcceptanceRecordSchema),
    active: liveCoachAcceptanceSessionSchema.nullable()
  })
  .strict()

type AcceptanceDocument = z.infer<typeof acceptanceDocumentSchema>
type MetricKey = keyof LiveCoachAcceptanceSession['performance']

interface RunningRoiEpisode {
  episodeIdHash: string
  trigger: LiveCoachAcceptanceRoiEpisode['trigger']
  calibrationIdHash: string | null
  startedAt: number
  endedAt: number | null
  outcome: LiveCoachAcceptanceRoiEpisode['outcome'] | 'pending'
  firstHealthyAt: number | null
}

interface RunningAcceptanceSession {
  recordId: string
  source: LiveCoachAcceptanceSession['source']
  mode: LiveCoachAcceptanceSession['mode']
  sessionIdHash: string
  buildChannel: LiveCoachAcceptanceSession['buildChannel']
  mapId: number | null
  queueId: number | null
  patch: string | null
  startedAt: number
  backend: string | null
  resolution: string | null
  minimapSide: 'auto' | 'left' | 'right'
  roiCounts: LiveCoachAcceptanceSession['capture']['roiCounts']
  roiEpisodes: RunningRoiEpisode[]
  roiEpisodeRecordingAvailable: boolean
  dropCountStart: number
  dropCountEnd: number
  samples: Record<MetricKey, number[]>
  cues: Map<string, LiveCoachAcceptanceCueAudit>
  errorCodes: Set<string>
  analysisIntervals: LiveCoachAcceptanceAnalysisInterval[]
  analysisEligible: boolean
  lastSampleAt: number
}

export class LiveCoachAcceptanceEvidenceController {
  private _sessions: LiveCoachAcceptanceSession[] = []
  private _offlineRecords: LiveCoachOfflineAcceptanceRecord[] = []
  private _running: RunningAcceptanceSession | null = null
  private _sampleTimer: NodeJS.Timeout | null = null
  private _sessionDisposer: (() => void) | null = null
  private _errorDisposer: (() => void) | null = null
  private _writeChain: Promise<void> = Promise.resolve()
  private _persistenceEpoch = 0
  private _lastPersistedAt = 0
  private _evidenceVerifier: ((cue: Readonly<CoachCue>) => boolean) | null = null

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _cueScheduler: CueSchedulerController
  ) {}

  public async init(): Promise<void> {
    await this._load()
    this._cueScheduler.onCueAudit = (cue) => this.recordCue(cue)
    this._sessionDisposer = this._context.mobxUtils.reaction(
      () => ({
        id: this._context.state.session.id,
        state: this._context.state.session.state,
        mapId: this._context.state.session.mapId,
        queueId: this._context.state.session.queueId,
        patch: this._context.state.session.patch,
        startedAt: this._context.state.session.startedAt,
        summary: this._context.state.lastSessionSummary
      }),
      (snapshot) => this._handleSessionSnapshot(snapshot),
      { fireImmediately: true }
    )
    this._errorDisposer = this._context.mobxUtils.reaction(
      () => this._context.state.lastError,
      (error) => {
        if (error && this._running) {
          this._running.errorCodes.add(`${error.stage}:${error.code}`)
        }
      }
    )
    this._sampleTimer = setInterval(() => this._sample(), SAMPLE_INTERVAL_MS)
  }

  public async dispose(): Promise<void> {
    this._sessionDisposer?.()
    this._sessionDisposer = null
    this._errorDisposer?.()
    this._errorDisposer = null
    if (this._sampleTimer) clearInterval(this._sampleTimer)
    this._sampleTimer = null
    this._cueScheduler.onCueAudit = null
    if (this._running) {
      this._finalizeRunning('app-disposed', Date.now())
    }
    await this._persist()
  }

  public setEvidenceVerifier(verifier: (cue: Readonly<CoachCue>) => boolean): void {
    this._evidenceVerifier = verifier
  }

  public recordCalibrationAttempt(
    calibration: MinimapCalibration | null,
    startedAt: number = Date.now()
  ): void {
    const running = this._running
    if (!running) return
    const calibrationIdHash = calibration ? hashAcceptanceIdentifier(calibration.id) : null
    const current = running.roiEpisodes.at(-1)

    if (calibrationIdHash && current?.outcome === 'pending') {
      if (current.calibrationIdHash === null) {
        current.calibrationIdHash = calibrationIdHash
        return
      }
      if (current.calibrationIdHash === calibrationIdHash) return
    }
    if (calibrationIdHash && current?.calibrationIdHash === calibrationIdHash) return
    this._startRoiEpisode('recalibration', calibrationIdHash, startedAt)
  }

  public recordCue(cue: Readonly<CoachCue>, terminalAt: number = Date.now()): void {
    if (!this._running || hashAcceptanceIdentifier(cue.sessionId) !== this._running.sessionIdHash) {
      return
    }
    const cueIdHash = hashAcceptanceIdentifier(cue.id)
    const previous = this._running.cues.get(cueIdHash)
    let evidenceVerifiedAtEmission = previous?.evidenceVerifiedAtEmission ?? false
    if (!evidenceVerifiedAtEmission && cue.evidenceIds.length > 0 && this._evidenceVerifier) {
      try {
        evidenceVerifiedAtEmission = this._evidenceVerifier(cue)
      } catch {
        evidenceVerifiedAtEmission = false
      }
    }
    this._running.cues.set(cueIdHash, {
      cueIdHash,
      ruleId: cue.ruleId,
      ruleVersion: cue.ruleVersion,
      evidenceIdHashes: cue.evidenceIds.map(hashAcceptanceIdentifier),
      evidenceVerifiedAtEmission,
      category: cue.category,
      priority: cue.priority,
      createdAt: cue.createdAt,
      expiresAt: cue.expiresAt,
      terminalAt,
      status: cue.status,
      cancellationReason: cue.cancellationReason
    })
  }

  public async recordOfflineSuccess(params: {
    format: 'json' | 'video'
    artifactSha256: string | null
    patch: string | null
    durationSeconds: number | null
    frameCount: number | null
    cueCount: number
  }): Promise<void> {
    const record: LiveCoachOfflineAcceptanceRecord = {
      recordId: `offline_${randomUUID()}`,
      attemptedAt: Date.now(),
      format: params.format,
      success: true,
      artifactSha256: params.artifactSha256,
      patch: params.patch,
      durationSeconds: params.durationSeconds,
      frameCount: params.frameCount,
      cueCount: params.cueCount,
      errorCode: null
    }
    if (
      record.artifactSha256 &&
      this._offlineRecords.some(
        (item) => item.success && item.artifactSha256 === record.artifactSha256
      )
    ) {
      return
    }
    this._offlineRecords = [...this._offlineRecords, record].slice(-MAX_OFFLINE_RECORDS)
    await this._persist()
  }

  public async recordOfflineFailure(format: 'json' | 'video', errorCode: string): Promise<void> {
    this._offlineRecords = [
      ...this._offlineRecords,
      {
        recordId: `offline_${randomUUID()}`,
        attemptedAt: Date.now(),
        format,
        success: false,
        artifactSha256: null,
        patch: null,
        durationSeconds: null,
        frameCount: null,
        cueCount: 0,
        errorCode: errorCode.slice(0, 120)
      }
    ].slice(-MAX_OFFLINE_RECORDS)
    await this._persist()
  }

  public getReport(feedback: CoachFeedbackRecord[]): LiveCoachAcceptanceReport {
    return buildLiveCoachAcceptanceReport({
      // Acceptance gates are evaluated only after a game has ended. The active snapshot is still
      // persisted for crash recovery, but exposing it here would let an unfinished game advance
      // match and soak counters.
      sessions: this._sessions,
      offlineRecords: this._offlineRecords,
      feedback
    })
  }

  public async clear(): Promise<{ sessions: number; offlineRecords: number }> {
    if (this._running) {
      throw new Error('请先结束当前实时教练会话，再清空一期验收记录')
    }
    const result = {
      sessions: this._sessions.length,
      offlineRecords: this._offlineRecords.length
    }
    // Invalidate snapshots captured by older queued writes before clearing memory. An already
    // running write is allowed to finish, but the deletion below is serialized after it so stale
    // acceptance evidence cannot be recreated after this method resolves.
    this._persistenceEpoch += 1
    this._sessions = []
    this._offlineRecords = []
    const deletion = this._writeChain.then(() =>
      this._context.settingService.deleteJsonConfigFile(ACCEPTANCE_FILENAME)
    )
    this._writeChain = deletion.catch((error) => {
      this._context.logger.warn(
        formatSanitizedErrorLog('Unable to delete persisted live coach acceptance evidence', error)
      )
    })
    await deletion
    return result
  }

  private _handleSessionSnapshot(snapshot: {
    id: string | null
    state: string
    mapId: number | null
    queueId: number | null
    patch: string | null
    startedAt: number | null
    summary: { sessionId: string; endedAt: number; endReason: string } | null
  }): void {
    if (this._running) this._sample()
    const isRunningState = ['active', 'shadow', 'paused'].includes(snapshot.state)
    if (isRunningState && snapshot.id && snapshot.startedAt !== null) {
      const sessionIdHash = hashAcceptanceIdentifier(snapshot.id)
      if (!this._running) {
        this._running = this._createRunning(
          {
            id: snapshot.id,
            state: snapshot.state,
            mapId: snapshot.mapId,
            queueId: snapshot.queueId,
            patch: snapshot.patch,
            startedAt: snapshot.startedAt
          },
          sessionIdHash
        )
        this._sample()
        return
      }
      if (
        this._running.sessionIdHash !== sessionIdHash &&
        this._running.startedAt === snapshot.startedAt
      ) {
        // LCU may promote a provisional id after the game is already running. Keep one acceptance
        // record while replacing the opaque hash with the authoritative game-session hash.
        this._running.sessionIdHash = sessionIdHash
        this._running.source = this._resolveSource(snapshot.id)
      }
      this._running.mapId = snapshot.mapId
      this._running.queueId = snapshot.queueId
      this._running.patch = snapshot.patch
      if (snapshot.state === 'active' || snapshot.state === 'shadow') {
        const mode = snapshot.state === 'shadow' ? 'shadow' : 'audible'
        if (this._running.mode !== mode) this._running.mode = 'mixed'
      }
      return
    }

    if (!this._running) return
    const endedAt = snapshot.summary?.endedAt ?? Date.now()
    const endReason = snapshot.summary?.endReason ?? `session-state-${snapshot.state}`
    this._finalizeRunning(endReason, endedAt)
    void this._persist()
  }

  private _createRunning(
    snapshot: {
      id: string
      state: string
      mapId: number | null
      queueId: number | null
      patch: string | null
      startedAt: number
    },
    sessionIdHash: string
  ): RunningAcceptanceSession {
    const capture = this._context.state.capture
    const running: RunningAcceptanceSession = {
      recordId: `realtime_${randomUUID()}`,
      source: this._resolveSource(snapshot.id),
      mode: snapshot.state === 'shadow' ? 'shadow' : 'audible',
      sessionIdHash,
      buildChannel: this._context.state.buildChannel,
      mapId: snapshot.mapId,
      queueId: snapshot.queueId,
      patch: snapshot.patch,
      startedAt: snapshot.startedAt,
      backend: capture.backend,
      resolution: capture.resolution
        ? `${capture.resolution.width}x${capture.resolution.height}`
        : null,
      minimapSide: this._context.settings.minimapSide,
      roiCounts: { healthy: 0, degraded: 0, unknown: 0, unsupported: 0 },
      roiEpisodes: [],
      roiEpisodeRecordingAvailable: true,
      dropCountStart: capture.dropCount,
      dropCountEnd: capture.dropCount,
      samples: {
        captureLatencyMs: [],
        inferenceLatencyMs: [],
        frameAgeMs: [],
        captureFps: [],
        appCpuPercent: [],
        appWorkingSetMiB: []
      },
      cues: new Map(),
      errorCodes: new Set(),
      analysisIntervals: [],
      analysisEligible: false,
      lastSampleAt: Date.now()
    }
    this._running = running
    this._startRoiEpisode(
      'session-start',
      this._context.settings.manualCalibration
        ? hashAcceptanceIdentifier(this._context.settings.manualCalibration.id)
        : null,
      snapshot.startedAt
    )
    return running
  }

  private _resolveSource(sessionId: string): LiveCoachAcceptanceSession['source'] {
    const gameflow = this._context.leagueClient?.data?.gameflow
    if (gameflow?.phase !== 'InProgress') return 'internal-simulation'
    const expectedSessionId = resolveLiveGameSessionId(gameflow.session?.gameData?.gameId)
    return sessionId === expectedSessionId ||
      (sessionId === PROVISIONAL_LIVE_GAME_SESSION_ID &&
        expectedSessionId === PROVISIONAL_LIVE_GAME_SESSION_ID)
      ? 'live-game'
      : 'internal-simulation'
  }

  private _sample(): void {
    const running = this._running
    if (!running) return
    const now = Date.now()
    const capture = this._context.state.capture
    const sampleEligible = this._isSampleEligible(now)
    const analysisEligible =
      sampleEligible && capture.roiState === 'healthy' && running.roiEpisodeRecordingAvailable
    const elapsedSinceLastSample = Math.max(0, now - running.lastSampleAt)
    // Require both ends of an interval to be healthy. This deliberately under-counts transitions
    // rather than crediting paused, sleeping, stale, or not-yet-started capture time. A delayed
    // timer is rejected instead of capped so waking from suspend cannot manufacture soak time.
    if (
      running.analysisEligible &&
      analysisEligible &&
      elapsedSinceLastSample <= SAMPLE_INTERVAL_MS * 2
    ) {
      this._recordAnalysisInterval(running.lastSampleAt, now)
    }
    running.analysisEligible = analysisEligible
    running.lastSampleAt = now
    running.backend = capture.backend ?? running.backend
    running.resolution = capture.resolution
      ? `${capture.resolution.width}x${capture.resolution.height}`
      : running.resolution
    running.dropCountEnd = capture.dropCount
    if (sampleEligible) {
      const roiState = ['healthy', 'degraded', 'unsupported'].includes(capture.roiState)
        ? (capture.roiState as 'healthy' | 'degraded' | 'unsupported')
        : 'unknown'
      running.roiCounts[roiState]++
    }
    if (analysisEligible) {
      this._markCurrentRoiEpisodeHealthy(now)
      this._pushSample(running.samples.captureLatencyMs, capture.captureLatencyMs)
      this._pushSample(running.samples.inferenceLatencyMs, capture.inferenceLatencyMs)
      this._pushSample(running.samples.frameAgeMs, capture.frameAgeMs)
      this._pushSample(running.samples.captureFps, capture.fps)
      const processMetrics = this._readProcessMetrics()
      this._pushSample(running.samples.appCpuPercent, processMetrics.cpuPercent)
      this._pushSample(running.samples.appWorkingSetMiB, processMetrics.workingSetMiB)
    }
    if (now - this._lastPersistedAt >= PERSIST_INTERVAL_MS) {
      this._lastPersistedAt = now
      void this._persist()
    }
  }

  private _isSampleEligible(now: number): boolean {
    const sessionState = this._context.state.session.state
    const capture = this._context.state.capture
    const lastObservationAt = capture.lastObservationAt
    return (
      (sessionState === 'active' || sessionState === 'shadow') &&
      capture.state === 'running' &&
      (capture.backend === 'wgc' || capture.backend === 'dda') &&
      capture.fps > 0 &&
      capture.frameAgeMs !== null &&
      capture.frameAgeMs >= 0 &&
      capture.frameAgeMs <= 300 &&
      lastObservationAt !== null &&
      lastObservationAt <= now + 1_000 &&
      now - lastObservationAt <= 2_000
    )
  }

  private _recordAnalysisInterval(startedAt: number, endedAt: number): void {
    const running = this._running
    if (!running || endedAt <= startedAt) return
    const previous = running.analysisIntervals.at(-1)
    if (previous && startedAt <= previous.endedAt) {
      previous.endedAt = Math.max(previous.endedAt, endedAt)
      return
    }
    // A pathological pause/resume loop must not grow the local acceptance file without bound.
    // Once the audit-safe limit is reached, further time is deliberately under-counted.
    if (running.analysisIntervals.length >= 10_000) return
    running.analysisIntervals.push({ startedAt, endedAt })
  }

  private _startRoiEpisode(
    trigger: RunningRoiEpisode['trigger'],
    calibrationIdHash: string | null,
    startedAt: number
  ): void {
    const running = this._running
    if (!running) return
    const previous = running.roiEpisodes.at(-1)
    if (previous?.outcome === 'pending') {
      previous.outcome = 'failed'
      previous.endedAt = Math.max(previous.startedAt, startedAt)
    }
    if (running.roiEpisodes.length >= 10_000) {
      running.roiEpisodeRecordingAvailable = false
      running.analysisEligible = false
      running.lastSampleAt = Math.max(running.lastSampleAt, startedAt)
      return
    }
    running.roiEpisodes.push({
      episodeIdHash: hashAcceptanceIdentifier(randomUUID()),
      trigger,
      calibrationIdHash,
      startedAt: Math.max(running.startedAt, startedAt),
      endedAt: null,
      outcome: 'pending',
      firstHealthyAt: null
    })
    // A new calibration is a hard analysis boundary. Even when the previous frame was healthy,
    // the next interval must re-establish fresh/healthy eligibility under the new calibration.
    running.analysisEligible = false
    running.lastSampleAt = Math.max(running.lastSampleAt, startedAt)
  }

  private _markCurrentRoiEpisodeHealthy(at: number): void {
    const episode = this._running?.roiEpisodes.at(-1)
    if (!episode || episode.outcome !== 'pending') return
    episode.outcome = 'healthy'
    episode.firstHealthyAt = Math.max(episode.startedAt, at)
    episode.endedAt = episode.firstHealthyAt
  }

  private _pushSample(target: number[], value: number | null): void {
    if (value === null || !Number.isFinite(value)) return
    target.push(value)
    if (target.length > 100_000) target.splice(0, target.length - 100_000)
  }

  private _readProcessMetrics(): { cpuPercent: number | null; workingSetMiB: number | null } {
    try {
      const metrics = app.getAppMetrics()
      return {
        cpuPercent: metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
        workingSetMiB:
          metrics.reduce((sum, metric) => sum + (metric.memory?.workingSetSize ?? 0), 0) / 1024
      }
    } catch {
      return { cpuPercent: null, workingSetMiB: null }
    }
  }

  private _snapshotRunning(endReason: string, endedAt: number): LiveCoachAcceptanceSession {
    const running = this._running!
    const safeEndedAt = Math.max(
      running.startedAt,
      endedAt,
      ...running.analysisIntervals.map((interval) => interval.endedAt),
      ...running.roiEpisodes.flatMap((episode) =>
        episode.endedAt === null ? [episode.startedAt] : [episode.startedAt, episode.endedAt]
      )
    )
    const roiEpisodes: LiveCoachAcceptanceRoiEpisode[] = running.roiEpisodes.map((episode) =>
      episode.outcome === 'pending'
        ? {
            ...episode,
            endedAt: Math.max(episode.startedAt, safeEndedAt),
            outcome: 'failed',
            firstHealthyAt: null
          }
        : {
            ...episode,
            endedAt: episode.endedAt ?? Math.max(episode.startedAt, safeEndedAt),
            outcome: episode.outcome
          }
    )
    const healthyEpisodeTimes = roiEpisodes.flatMap((episode) =>
      episode.outcome === 'healthy' && episode.firstHealthyAt !== null
        ? [episode.firstHealthyAt]
        : []
    )
    const durationSeconds =
      running.analysisIntervals.reduce(
        (sum, interval) => sum + Math.max(0, interval.endedAt - interval.startedAt),
        0
      ) / 1_000
    return {
      recordId: running.recordId,
      source: running.source,
      mode: running.mode,
      sessionIdHash: running.sessionIdHash,
      buildChannel: running.buildChannel,
      mapId: running.mapId,
      queueId: running.queueId,
      patch: running.patch,
      startedAt: running.startedAt,
      endedAt: safeEndedAt,
      durationSeconds,
      durationBasis: 'fresh-healthy-intervals-v2',
      analysisIntervals: running.analysisIntervals.map((interval) => ({ ...interval })),
      completionBasis: this._resolveCompletionBasis(),
      endReason,
      capture: {
        backend: running.backend,
        resolution: running.resolution,
        minimapSide: running.minimapSide,
        roiCounts: { ...running.roiCounts },
        roiEverHealthy: healthyEpisodeTimes.length > 0,
        roiFirstHealthyMs:
          healthyEpisodeTimes.length > 0
            ? Math.max(0, Math.min(...healthyEpisodeTimes) - running.startedAt)
            : null,
        dropCountStart: running.dropCountStart,
        dropCountEnd: running.dropCountEnd
      },
      roiEpisodes,
      performance: {
        captureLatencyMs: summarizeAcceptanceMetric(running.samples.captureLatencyMs),
        inferenceLatencyMs: summarizeAcceptanceMetric(running.samples.inferenceLatencyMs),
        frameAgeMs: summarizeAcceptanceMetric(running.samples.frameAgeMs),
        captureFps: summarizeAcceptanceMetric(running.samples.captureFps),
        appCpuPercent: summarizeAcceptanceMetric(running.samples.appCpuPercent),
        appWorkingSetMiB: summarizeAcceptanceMetric(running.samples.appWorkingSetMiB)
      },
      cues: Array.from(running.cues.values()).toSorted(
        (left, right) => left.createdAt - right.createdAt
      ),
      errorCodes: Array.from(running.errorCodes).toSorted()
    }
  }

  private _resolveCompletionBasis(): LiveCoachAcceptanceSession['completionBasis'] {
    const phase = this._context.leagueClient?.data?.gameflow?.phase
    return phase === 'PreEndOfGame' || phase === 'EndOfGame' || phase === 'WaitingForStats'
      ? 'observed-gameflow-end'
      : 'unverified'
  }

  private _finalizeRunning(endReason: string, endedAt: number): void {
    if (!this._running) return
    this._sessions = [
      ...this._sessions.filter((session) => session.recordId !== this._running!.recordId),
      this._snapshotRunning(endReason, endedAt)
    ].slice(-MAX_COMPLETED_SESSIONS)
    this._running = null
  }

  private async _load(): Promise<void> {
    if (!(await this._context.settingService.jsonConfigFileExists(ACCEPTANCE_FILENAME))) return
    try {
      const raw = await this._context.settingService.readFromJsonConfigFile(ACCEPTANCE_FILENAME)
      const document = acceptanceDocumentSchema.parse(raw)
      this._sessions = document.sessions.slice(-MAX_COMPLETED_SESSIONS)
      this._offlineRecords = document.offlineRecords.slice(-MAX_OFFLINE_RECORDS)
      if (document.active) {
        this._sessions = [
          ...this._sessions,
          { ...document.active, endReason: 'unexpected-app-exit' }
        ].slice(-MAX_COMPLETED_SESSIONS)
      }
      await this._persist()
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Unable to load persisted live coach acceptance evidence', error)
      )
    }
  }

  private _persist(): Promise<void> {
    if (this._sessions.length === 0 && this._offlineRecords.length === 0 && !this._running) {
      return this._writeChain
    }
    const persistenceEpoch = this._persistenceEpoch
    const document: AcceptanceDocument = {
      schemaVersion: 2,
      sessions: this._sessions,
      offlineRecords: this._offlineRecords,
      active: this._running ? this._snapshotRunning('active-snapshot', Date.now()) : null
    }
    const write = this._writeChain.then(() => {
      if (persistenceEpoch !== this._persistenceEpoch) return
      return this._context.settingService.writeToJsonConfigFile(ACCEPTANCE_FILENAME, document)
    })
    this._writeChain = write.catch((error) => {
      this._context.logger.warn(
        formatSanitizedErrorLog('Unable to persist live coach acceptance evidence', error)
      )
    })
    return write
  }
}
