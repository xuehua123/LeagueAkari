import type { CoachCue } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { LiveCoachAcceptanceEvidenceController } from './acceptance-evidence-controller'
import { hashAcceptanceIdentifier } from './acceptance-report'

describe('LiveCoachAcceptanceEvidenceController', () => {
  it('fails closed when the persisted document uses the obsolete acceptance contract', async () => {
    const settingService = {
      jsonConfigFileExists: vi.fn().mockResolvedValue(true),
      readFromJsonConfigFile: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        sessions: [{ durationSeconds: 999_999 }],
        offlineRecords: [],
        active: null
      }),
      writeToJsonConfigFile: vi.fn().mockResolvedValue(undefined),
      deleteJsonConfigFile: vi.fn().mockResolvedValue(undefined)
    }
    const context: any = {
      state: {
        session: {
          id: null,
          state: 'idle',
          mapId: null,
          queueId: null,
          patch: null,
          startedAt: null
        },
        lastSessionSummary: null,
        lastError: null
      },
      settings: { minimapSide: 'right', manualCalibration: null },
      settingService,
      mobxUtils: {
        reaction: vi.fn((_reader, _effect, options) => {
          if (options?.fireImmediately) _effect(_reader())
          return () => undefined
        })
      },
      logger: { warn: vi.fn() }
    }
    const controller = new LiveCoachAcceptanceEvidenceController(context, {
      onCueAudit: null
    } as any)

    await controller.init()

    expect(controller.getReport([]).sessions).toEqual([])
    expect(settingService.writeToJsonConfigFile).not.toHaveBeenCalled()
    expect(context.logger.warn).toHaveBeenCalledOnce()
    await controller.dispose()
  })

  it('derives live-game provenance from authoritative gameflow instead of a caller-chosen id', () => {
    const controller = new LiveCoachAcceptanceEvidenceController(
      {
        leagueClient: {
          data: {
            gameflow: {
              phase: 'InProgress',
              session: { gameData: { gameId: 'authoritative-game-id' } }
            }
          }
        }
      } as any,
      { onCueAudit: null } as any
    )

    expect((controller as any)._resolveSource('authoritative-game-id')).toBe('live-game')
    expect((controller as any)._resolveSource('caller-chosen-real-looking-id')).toBe(
      'internal-simulation'
    )
  })

  it('serializes deletion after an in-flight write and does not recreate an empty file on dispose', async () => {
    let releaseWrite!: () => void
    const writeMayFinish = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    let persistedDocument: unknown
    const settingService = {
      writeToJsonConfigFile: vi.fn(async (_name: string, document: unknown) => {
        await writeMayFinish
        persistedDocument = document
      }),
      deleteJsonConfigFile: vi.fn(async () => {
        persistedDocument = undefined
      })
    }
    const context: any = {
      settingService,
      logger: { warn: vi.fn() }
    }
    const controller = new LiveCoachAcceptanceEvidenceController(context, {
      onCueAudit: null
    } as any)

    const record = controller.recordOfflineFailure('json', 'LC_ERR_REPLAY_INVALID')
    await vi.waitFor(() => expect(settingService.writeToJsonConfigFile).toHaveBeenCalledOnce())

    const deletion = controller.clear()
    await Promise.resolve()
    expect(settingService.deleteJsonConfigFile).not.toHaveBeenCalled()

    releaseWrite()
    await record
    await expect(deletion).resolves.toEqual({ sessions: 0, offlineRecords: 1 })
    expect(settingService.deleteJsonConfigFile).toHaveBeenCalledWith('live-coach-acceptance.json')
    expect(persistedDocument).toBeUndefined()

    await controller.dispose()
    expect(settingService.writeToJsonConfigFile).toHaveBeenCalledOnce()
    expect(persistedDocument).toBeUndefined()
  })

  it('counts only fresh healthy analysis time and excludes an unfinished or paused session', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
    const reactions: Array<() => void> = []
    const state: any = {
      buildChannel: 'internal',
      session: {
        id: null,
        state: 'idle',
        mapId: null,
        queueId: null,
        patch: null,
        startedAt: null
      },
      capture: {
        state: 'running',
        backend: 'wgc',
        resolution: { width: 1920, height: 1080 },
        roiState: 'healthy',
        dropCount: 0,
        captureLatencyMs: 12,
        inferenceLatencyMs: 35,
        frameAgeMs: 30,
        fps: 5,
        lastObservationAt: Date.now()
      },
      lastError: null,
      lastSessionSummary: null
    }
    const context: any = {
      state,
      settings: { minimapSide: 'right', manualCalibration: null },
      leagueClient: {
        data: {
          gameflow: {
            phase: 'InProgress',
            session: { gameData: { gameId: 'one-real-shadow-game' } }
          }
        }
      },
      settingService: {
        jsonConfigFileExists: vi.fn().mockResolvedValue(false),
        readFromJsonConfigFile: vi.fn(),
        writeToJsonConfigFile: vi.fn().mockResolvedValue(undefined),
        deleteJsonConfigFile: vi.fn().mockResolvedValue(undefined)
      },
      mobxUtils: {
        reaction: vi.fn((reader, effect, options) => {
          const run = () => effect(reader())
          reactions.push(run)
          if (options?.fireImmediately) run()
          return () => {
            const index = reactions.indexOf(run)
            if (index >= 0) reactions.splice(index, 1)
          }
        })
      },
      logger: { warn: vi.fn() }
    }
    const controller = new LiveCoachAcceptanceEvidenceController(context, {
      onCueAudit: null
    } as any)
    await controller.init()

    state.session = {
      id: 'one-real-shadow-game',
      state: 'shadow',
      mapId: 11,
      queueId: 420,
      patch: '16.17.1',
      startedAt: Date.now()
    }
    reactions.forEach((reaction) => reaction())

    for (let index = 0; index < 12; index++) {
      state.capture.lastObservationAt = Date.now() + 5_000
      await vi.advanceTimersByTimeAsync(5_000)
    }
    expect(controller.getReport([]).counts.validShadowMatches).toBe(0)
    expect(controller.getReport([]).sessions).toEqual([])

    state.session = { ...state.session, state: 'paused' }
    reactions.forEach((reaction) => reaction())
    const samplesBeforePause = (controller as any)._running.samples.captureLatencyMs.length
    const roiCountsBeforePause = { ...(controller as any)._running.roiCounts }
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1_000)
    ;(controller as any)._sample()
    expect((controller as any)._running.samples.captureLatencyMs).toHaveLength(samplesBeforePause)
    expect((controller as any)._running.roiCounts).toEqual(roiCountsBeforePause)

    state.session = { ...state.session, state: 'shadow' }
    state.capture.lastObservationAt = Date.now()
    reactions.forEach((reaction) => reaction())
    for (let index = 0; index < 60; index++) {
      state.capture.lastObservationAt = Date.now() + 5_000
      await vi.advanceTimersByTimeAsync(5_000)
    }

    const durationBeforeSleep = (controller as any)._running.analysisIntervals.reduce(
      (sum: number, interval: { startedAt: number; endedAt: number }) =>
        sum + interval.endedAt - interval.startedAt,
      0
    )
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1_000)
    state.capture.lastObservationAt = Date.now()
    ;(controller as any)._sample()
    const durationAfterSleep = (controller as any)._running.analysisIntervals.reduce(
      (sum: number, interval: { startedAt: number; endedAt: number }) =>
        sum + interval.endedAt - interval.startedAt,
      0
    )
    expect(durationAfterSleep).toBe(durationBeforeSleep)

    controller.recordCalibrationAttempt(null)
    controller.recordCalibrationAttempt(null)
    controller.recordCalibrationAttempt(null)
    controller.recordCalibrationAttempt({
      schemaVersion: 1,
      id: 'final-real-calibration',
      fingerprintHash: 'fingerprint',
      roi: { x: 0.82, y: 0.72, width: 0.18, height: 0.28 },
      transform: 'blue-normal',
      source: 'manual',
      confidence: 1,
      createdAt: Date.now()
    })
    state.capture.lastObservationAt = Date.now()
    ;(controller as any)._sample()

    const endedAt = Date.now()
    context.leagueClient.data.gameflow.phase = 'EndOfGame'
    state.lastSessionSummary = {
      sessionId: 'one-real-shadow-game',
      endedAt,
      endReason: 'completed'
    }
    state.session = {
      id: null,
      state: 'idle',
      mapId: null,
      queueId: null,
      patch: null,
      startedAt: null
    }
    reactions.forEach((reaction) => reaction())

    const report = controller.getReport([])
    expect(report.counts.validShadowMatches).toBe(1)
    expect(report.sessions[0].durationSeconds).toBe(360)
    expect(report.totals.shadowHours).toBeCloseTo(0.1)
    expect(report.counts.roiEpisodes).toBe(4)
    expect(report.counts.successfulRoiEpisodes).toBe(2)
    expect(report.totals.roiStartupSuccessRate).toBe(0.5)
    await controller.dispose()
    vi.useRealTimers()
  })

  it('records a privacy-safe shadow session and persists a completed snapshot', async () => {
    vi.useFakeTimers()
    const reactions: Array<() => void> = []
    const writes: unknown[] = []
    const state: any = {
      buildChannel: 'internal',
      session: {
        id: null,
        state: 'idle',
        mapId: null,
        queueId: null,
        patch: null,
        startedAt: null
      },
      capture: {
        backend: 'wgc',
        resolution: { width: 1920, height: 1080 },
        roiState: 'healthy',
        dropCount: 0,
        captureLatencyMs: 12,
        inferenceLatencyMs: 35,
        frameAgeMs: 47,
        fps: 5
      },
      lastError: null,
      lastSessionSummary: null
    }
    const context: any = {
      state,
      settings: { minimapSide: 'right', manualCalibration: null },
      leagueClient: {
        data: {
          gameflow: {
            phase: 'InProgress',
            session: { gameData: { gameId: 'private-game-id-123' } }
          }
        }
      },
      settingService: {
        jsonConfigFileExists: vi.fn().mockResolvedValue(false),
        readFromJsonConfigFile: vi.fn(),
        writeToJsonConfigFile: vi.fn(async (_name, document) => writes.push(document)),
        deleteJsonConfigFile: vi.fn().mockResolvedValue(undefined)
      },
      mobxUtils: {
        reaction: vi.fn((reader, effect, options) => {
          const run = () => effect(reader())
          reactions.push(run)
          if (options?.fireImmediately) run()
          return () => {
            const index = reactions.indexOf(run)
            if (index >= 0) reactions.splice(index, 1)
          }
        })
      },
      logger: { warn: vi.fn() }
    }
    const scheduler: any = { onCueAudit: null }
    const controller = new LiveCoachAcceptanceEvidenceController(context, scheduler)
    controller.setEvidenceVerifier(
      (cue) =>
        cue.sessionId === 'private-game-id-123' &&
        cue.evidenceIds.length === 1 &&
        cue.evidenceIds[0] === 'private-game-id-123-evidence'
    )
    await controller.init()

    state.session = {
      id: 'private-game-id-123',
      state: 'shadow',
      mapId: 11,
      queueId: 420,
      patch: '16.16.1',
      startedAt: Date.now()
    }
    reactions.forEach((reaction) => reaction())
    const cue: CoachCue = {
      id: 'private-game-id-123-cue',
      sessionId: 'private-game-id-123',
      ruleId: 'rule_missing_enemy',
      ruleVersion: '1',
      category: 'warning',
      priority: 80,
      observationText: 'private text must not be persisted',
      impactText: null,
      options: [],
      spokenText: 'private spoken text',
      evidenceIds: ['private-game-id-123-evidence'],
      createdAt: Date.now(),
      expiresAt: Date.now() + 5_000,
      status: 'suppressed',
      cancellationReason: 'shadow-mode'
    }
    scheduler.onCueAudit(cue)
    await vi.advanceTimersByTimeAsync(5_000)

    const endedAt = Date.now() + 600_000
    context.leagueClient.data.gameflow.phase = 'EndOfGame'
    state.lastSessionSummary = {
      sessionId: 'private-game-id-123',
      endedAt,
      endReason: 'completed'
    }
    state.session = {
      id: null,
      state: 'idle',
      mapId: null,
      queueId: null,
      patch: null,
      startedAt: null
    }
    reactions.forEach((reaction) => reaction())
    await controller.dispose()

    const report = controller.getReport([])
    expect(report.sessions).toHaveLength(1)
    expect(report.sessions[0]).toMatchObject({
      mode: 'shadow',
      source: 'live-game',
      sessionIdHash: hashAcceptanceIdentifier('private-game-id-123')
    })
    expect(report.sessions[0].cues[0]).toMatchObject({
      cueIdHash: hashAcceptanceIdentifier('private-game-id-123-cue'),
      evidenceIdHashes: [hashAcceptanceIdentifier('private-game-id-123-evidence')],
      evidenceVerifiedAtEmission: true
    })
    const serialized = JSON.stringify(writes)
    expect(serialized).not.toContain('private-game-id-123')
    expect(serialized).not.toContain('private text')
    expect(serialized).not.toContain('private spoken text')
    vi.useRealTimers()
  })
})
