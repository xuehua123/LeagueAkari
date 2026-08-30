import { CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { LiveCoachIpcHandlers } from './ipc-handlers'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('LiveCoachIpcHandlers privacy gate', () => {
  it.each([
    'startInternalSession',
    'startManualSession',
    'simulateReplaySession',
    'selectReplayFile',
    'selectReplaySidecarFile',
    'prepareVideoReplay',
    'importVideoReplay'
  ])('rejects %s with a stable consent-required IPC code', async (callName) => {
    const calls: Record<string, (...args: any[]) => any> = {}
    const context = {
      namespace: 'live-coach-main',
      ipc: {
        onCall: vi.fn((_namespace, name, handler) => {
          calls[name] = handler
        })
      },
      settings: {
        enabled: true,
        onboardingCompleted: false
      },
      state: {
        buildChannel: 'internal'
      }
    }
    const sessionController = { startSession: vi.fn() }
    new LiveCoachIpcHandlers(
      context as any,
      sessionController as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    ).register()

    await expect(calls[callName]({} as any, {})).rejects.toMatchObject({
      code: 'consent-required'
    })
    expect(sessionController.startSession).not.toHaveBeenCalled()
  })

  it('allows built-in replay simulation only after consent to the current notice version', async () => {
    const calls: Record<string, (...args: any[]) => any> = {}
    const context = {
      namespace: 'live-coach-main',
      ipc: {
        onCall: vi.fn((_namespace, name, handler) => {
          calls[name] = handler
        })
      },
      settings: {
        enabled: true,
        onboardingCompleted: true,
        privacyConsentVersion: CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
      },
      state: {
        buildChannel: 'internal'
      }
    }
    new LiveCoachIpcHandlers(
      context as any,
      { startSession: vi.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    ).register()

    const sample = await calls.getSampleReplay({} as any)
    const result = await calls.simulateReplaySession({} as any, sample.session)

    expect(result.cues).toEqual(expect.any(Array))
    expect(result.sidecar.sessionId).toBe(sample.session.metadata.sessionId)
  })

  it('manually starts a Tencent custom game with its regional queue id', async () => {
    const calls: Record<string, (...args: any[]) => any> = {}
    const context = {
      namespace: 'live-coach-main',
      ipc: {
        onCall: vi.fn((_namespace, name, handler) => {
          calls[name] = handler
        })
      },
      settings: {
        enabled: true,
        onboardingCompleted: true,
        privacyConsentVersion: CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
      },
      state: {
        buildChannel: 'internal',
        session: { state: 'idle', patch: null }
      },
      leagueClient: {
        data: {
          gameflow: {
            phase: 'InProgress',
            session: {
              map: { id: 11, gameMode: 'CLASSIC' },
              gameData: {
                gameId: 9001,
                isCustomGame: true,
                queue: { id: 3100, isCustom: true, gameMode: 'CLASSIC', mapId: 11 }
              }
            }
          }
        }
      }
    }
    const sessionController = {
      latestPatch: '16.17.1',
      startSession: vi.fn(() => {
        context.state.session.state = 'active'
      })
    }
    new LiveCoachIpcHandlers(
      context as any,
      sessionController as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    ).register()

    await expect(calls.startManualSession({} as any)).resolves.toEqual({
      success: true,
      sessionId: '9001'
    })
    expect(sessionController.startSession).toHaveBeenCalledWith('9001', 11, 0, '16.17.1')
  })
})

describe('LiveCoachIpcHandlers durable privacy withdrawal', () => {
  function registerWithdrawalHandler(
    setAndPersist: (key: string, value: unknown) => Promise<void>
  ) {
    const calls: Record<string, (...args: any[]) => any> = {}
    const settings = {
      enabled: true,
      onboardingCompleted: true,
      privacyConsentVersion: CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
    }
    const replayImport = {
      activeTaskId: null,
      cancelImport: vi.fn(async () => ({ cancelled: false, taskId: null })),
      revokeUnassociatedReplayFileGrants: vi.fn(),
      revokeAllReplayFileGrants: vi.fn()
    }
    const context = {
      namespace: 'live-coach-main',
      ipc: {
        onCall: vi.fn((_namespace, name, handler) => {
          calls[name] = handler
        })
      },
      settings,
      settingService: {
        setAndPersist: vi.fn(async (key: keyof typeof settings, value: unknown) => {
          Object.assign(settings, { [key]: value })
          await setAndPersist(key, value)
        })
      },
      state: { buildChannel: 'internal' }
    }

    new LiveCoachIpcHandlers(
      context as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      replayImport as any,
      {} as any
    ).register()

    return { calls, context, replayImport, settings }
  }

  it('returns success only after all three fail-closed values are durably written', async () => {
    const persistence = deferred()
    const { calls, context, replayImport, settings } = registerWithdrawalHandler(async (key) => {
      if (key === 'enabled') {
        await persistence.promise
      }
    })

    let completed = false
    const operation = calls.withdrawPrivacyConsent({} as any).then((result: unknown) => {
      completed = true
      return result
    })
    await vi.waitFor(() => {
      expect(context.settingService.setAndPersist).toHaveBeenCalledTimes(3)
    })

    expect(context.settingService.setAndPersist.mock.calls).toEqual([
      ['privacyConsentVersion', null],
      ['onboardingCompleted', false],
      ['enabled', false]
    ])

    expect(settings).toEqual({
      enabled: false,
      onboardingCompleted: false,
      privacyConsentVersion: null
    })
    expect(completed).toBe(false)
    expect(replayImport.revokeAllReplayFileGrants).not.toHaveBeenCalled()

    persistence.resolve()
    await expect(operation).resolves.toEqual({ success: true })

    expect(replayImport.revokeAllReplayFileGrants).toHaveBeenCalledTimes(1)
  })

  it('surfaces storage failure after attempting every write and keeps memory fail-closed', async () => {
    const { calls, context, replayImport, settings } = registerWithdrawalHandler(async (key) => {
      if (key === 'privacyConsentVersion') {
        throw new Error('storage unavailable')
      }
    })

    await expect(calls.withdrawPrivacyConsent({} as any)).rejects.toThrow('storage unavailable')

    expect(context.settingService.setAndPersist).toHaveBeenCalledTimes(3)
    expect(settings).toEqual({
      enabled: false,
      onboardingCompleted: false,
      privacyConsentVersion: null
    })
    expect(replayImport.revokeAllReplayFileGrants).toHaveBeenCalledTimes(1)
  })

  it('revokes file grants even when cancellation fails after consent is persisted', async () => {
    const { calls, replayImport } = registerWithdrawalHandler(async () => undefined)
    replayImport.cancelImport.mockRejectedValueOnce(new Error('cancel failed'))

    await expect(calls.withdrawPrivacyConsent({} as any)).rejects.toThrow('cancel failed')

    expect(replayImport.revokeAllReplayFileGrants).toHaveBeenCalledTimes(1)
  })
})

describe('LiveCoachIpcHandlers replay persistence contract', () => {
  function registerReplayHandlers(options: {
    replayImport: Record<string, any>
    replayHistory: Record<string, any>
    acceptance?: Record<string, any>
  }) {
    const calls: Record<string, (...args: any[]) => any> = {}
    const logger = { warn: vi.fn() }
    const context = {
      namespace: 'live-coach-main',
      ipc: {
        onCall: vi.fn((_namespace, name, handler) => {
          calls[name] = handler
        })
      },
      logger,
      settings: {
        enabled: true,
        onboardingCompleted: true,
        privacyConsentVersion: CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
      },
      state: { buildChannel: 'internal' }
    }
    const acceptance = options.acceptance ?? {
      recordOfflineSuccess: vi.fn(),
      recordOfflineFailure: vi.fn()
    }
    const replayImport = {
      activeTaskId: null,
      cancelImport: vi.fn(async () => ({ cancelled: false, taskId: null })),
      revokeReplayFileGrants: vi.fn(() => 0),
      revokeAnalysisFileGrants: vi.fn(() => 0),
      revokeUnassociatedReplayFileGrants: vi.fn(() => 0),
      revokeAllReplayFileGrants: vi.fn(() => 0),
      associateReplayFileGrants: vi.fn(),
      ...options.replayImport
    }
    new LiveCoachIpcHandlers(
      context as any,
      {} as any,
      {} as any,
      {} as any,
      { list: vi.fn(() => []) } as any,
      acceptance as any,
      {} as any,
      {} as any,
      replayImport as any,
      options.replayHistory as any
    ).register()
    return { calls, acceptance, replayImport, logger }
  }

  it('lists and really deletes persisted analysis records through thin IPC calls', async () => {
    const entry = { id: '11111111-1111-4111-8111-111111111111', status: 'completed' }
    const replayHistory = {
      list: vi.fn(() => [entry]),
      get: vi.fn(() => entry),
      getResult: vi.fn(async () => null),
      delete: vi.fn(async () => ({ deleted: true, deletedBytes: 512 })),
      clear: vi.fn(async () => ({ deletedEntries: 1, deletedBytes: 512 }))
    }
    const replayImport = {
      activeTaskId: null,
      cancelImport: vi.fn(async () => ({ cancelled: false, taskId: null }))
    }
    const { calls } = registerReplayHandlers({ replayImport, replayHistory })

    await expect(calls.listReplayAnalyses({} as any)).resolves.toEqual([entry])
    await expect(calls.deleteReplayAnalysis({} as any, entry.id)).resolves.toEqual({
      deleted: true,
      deletedBytes: 512
    })
    await expect(calls.clearReplayAnalyses({} as any)).resolves.toEqual({
      deletedEntries: 1,
      deletedBytes: 512
    })
    expect(replayHistory.delete).toHaveBeenCalledWith(entry.id)
    expect(replayImport.cancelImport).toHaveBeenCalled()
  })

  it('persists and returns only the projected result instead of source paths or frames', async () => {
    const historyId = '22222222-2222-4222-8222-222222222222'
    const metadata = {
      patch: '16.17.1',
      mapId: 11,
      queueId: 420,
      selfTeam: 'blue',
      selfChampionId: 266,
      minimapSide: 'right',
      videoGameStartMs: 0,
      roster: null
    }
    const manifest = {
      pipelineVersion: 'replay-analysis-v1',
      ruleCatalogVersion: '16.17.1',
      ffmpegVersion: null,
      runtimeVersion: '1.5.1',
      models: {}
    }
    const replayImport = {
      activeTaskId: null,
      resolveReplayFileGrant: vi.fn(async (token: string) => ({
        token,
        displayName: 'match.mp4',
        purpose: 'video',
        expiresAt: Date.now() + 60_000,
        filePath: 'C:\\Users\\private\\match.mp4'
      })),
      createAnalysisIdentity: vi.fn(async () => ({
        artifactSha256: 'a'.repeat(64),
        sidecarSha256: null,
        metadata,
        manifest
      })),
      importVideoReplay: vi.fn(async () => ({
        session: {
          videoPath: 'C:\\Users\\private\\match.mp4',
          frames: [{ private: true }],
          durationSeconds: 60,
          frameCount: 300,
          analysisFps: 5,
          metadata,
          capabilityStatus: { available: ['minimap-basic'], disabled: [], missingFields: [] }
        },
        sidecar: {
          gameDurationSeconds: 60,
          totalCues: 1,
          timeline: [
            {
              gameTimeFormatted: '00:10',
              category: 'warning',
              observation: 'River pressure',
              spokenText: 'Back away',
              options: ['Retreat'],
              evidenceIds: ['private-evidence-id']
            }
          ],
          evidencesSummary: { totalEvidences: 1 }
        },
        cues: [{}]
      }))
    }
    const replayHistory = {
      startTask: vi.fn(async (input) => ({
        entry: { ...input, id: historyId, status: 'preparing' },
        duplicate: null
      })),
      updateProgress: vi.fn(),
      completeTask: vi.fn(async (_id, result) => ({
        id: historyId,
        status: 'completed',
        analysisFingerprint: result.analysisFingerprint
      })),
      get: vi.fn(() => null)
    }
    const { calls, acceptance } = registerReplayHandlers({ replayImport, replayHistory })
    const sourceToken = 'A'.repeat(43)

    const response = await calls.importVideoReplay({} as any, {
      sourceToken,
      roi: { x: 0.8, y: 0.7, width: 0.2, height: 0.3 },
      metadata
    })

    expect(response.duplicate).toBe(false)
    expect(response.result.historyId).toBe(historyId)
    expect(JSON.stringify(response.result)).not.toContain('videoPath')
    expect(JSON.stringify(response.result)).not.toContain('C:\\\\Users')
    expect(JSON.stringify(response.result)).not.toContain('"frames"')
    expect(replayHistory.completeTask).toHaveBeenCalledWith(historyId, response.result)
    expect(acceptance.recordOfflineSuccess).toHaveBeenCalled()
    expect(replayImport.resolveReplayFileGrant).toHaveBeenCalledWith(sourceToken, ['json', 'video'])
    await expect(
      calls.importVideoReplay({} as any, { videoPath: 'C:\\Users\\private\\match.mp4' })
    ).rejects.toThrow()
  })

  it.each([
    {
      name: '文件在 grant resolve 后消失',
      thrown: (filePath: string) => new Error(`录像文件不存在: ${filePath}`),
      expectedCode: 'replay-source-not-found'
    },
    {
      name: 'FFmpeg 返回含路径的错误',
      thrown: (filePath: string) => new Error(`FFmpeg 无法解码 ${filePath}`),
      expectedCode: 'replay-decoder-error'
    }
  ])('将$name映射为无路径的稳定 IPC 错误', async ({ thrown, expectedCode }) => {
    const historyId = '33333333-3333-4333-8333-333333333333'
    const sourceToken = 'F'.repeat(43)
    const filePath = 'C:\\Users\\private\\vanished-match.mp4'
    const metadata = {
      patch: null,
      mapId: null,
      queueId: null,
      selfTeam: null,
      selfChampionId: null,
      minimapSide: null,
      videoGameStartMs: null,
      roster: null
    }
    const decoderFailure = expectedCode === 'replay-decoder-error'
    const replayImport = {
      resolveReplayFileGrant: vi.fn(async () => ({
        token: sourceToken,
        displayName: 'vanished-match.mp4',
        purpose: 'video',
        expiresAt: Date.now() + 60_000,
        filePath
      })),
      createAnalysisIdentity: decoderFailure
        ? vi.fn(async () => ({
            artifactSha256: 'a'.repeat(64),
            sidecarSha256: null,
            metadata,
            manifest: {
              pipelineVersion: 'replay-analysis-v1',
              ruleCatalogVersion: '16.17.1',
              ffmpegVersion: null,
              runtimeVersion: '1.5.1',
              models: {}
            }
          }))
        : vi.fn(async () => {
            throw thrown(filePath)
          }),
      importVideoReplay: vi.fn(async () => {
        throw thrown(filePath)
      })
    }
    const replayHistory = {
      startTask: vi.fn(async (input) => ({
        entry: { ...input, id: historyId, status: 'preparing' },
        duplicate: null
      })),
      updateProgress: vi.fn(),
      get: vi.fn(() => ({ id: historyId, status: 'analyzing' })),
      failTask: vi.fn()
    }
    const { calls, logger } = registerReplayHandlers({ replayImport, replayHistory })

    const error = await calls
      .importVideoReplay({} as any, { sourceToken })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: expectedCode })
    expect(String((error as Error).message)).not.toContain(filePath)
    expect(String((error as Error).message)).not.toContain('C:\\Users')
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(filePath)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('C:\\\\Users')
    expect(logger.warn).toHaveBeenCalledWith('Replay IPC operation failed', {
      failureCode: expectedCode
    })
  })

  it('returns only opaque descriptors from video preparation and rejects path-shaped IPC input', async () => {
    const sourceToken = 'V'.repeat(43)
    const sidecarToken = 'S'.repeat(43)
    const sourcePath = 'C:\\Users\\private\\match.mp4'
    const sidecarPath = `${sourcePath}.sidecar.json`
    const replayImport = {
      resolveReplayFileGrant: vi.fn(async () => ({
        token: sourceToken,
        displayName: 'match.mp4',
        purpose: 'video',
        expiresAt: Date.now() + 60_000,
        filePath: sourcePath
      })),
      prepareVideoReplay: vi.fn(async () => ({
        videoPath: sourcePath,
        sidecarPath,
        fileName: 'match.mp4',
        fileSizeBytes: 1,
        probe: { durationSeconds: 1, width: 640, height: 360, fps: 30, codec: 'h264' },
        calibration: {
          schemaVersion: 1,
          id: 'calibration',
          fingerprintHash: 'fingerprint',
          roi: { x: 0.8, y: 0.7, width: 0.2, height: 0.3 },
          transform: 'blue-normal',
          source: 'automatic',
          confidence: 1,
          createdAt: Date.now()
        },
        metadata: {
          patch: null,
          mapId: null,
          queueId: null,
          selfTeam: null,
          selfChampionId: null,
          minimapSide: null,
          videoGameStartMs: null,
          roster: null
        },
        capabilityStatus: { available: [], disabled: [], missingFields: [] },
        hasExplicitSidecarGameTime: false,
        imageDataUrl: 'data:image/jpeg;base64,AA==',
        expiresAt: Date.now() + 30_000,
        artifactSha256: 'a'.repeat(64),
        sidecarSha256: 'b'.repeat(64)
      })),
      grantReplaySidecarFile: vi.fn(async () => ({
        token: sidecarToken,
        displayName: 'match.mp4.sidecar.json',
        purpose: 'sidecar',
        expiresAt: Date.now() + 60_000
      }))
    }
    const { calls } = registerReplayHandlers({ replayImport, replayHistory: {} })

    const response = await calls.prepareVideoReplay({} as any, { sourceToken })

    expect(response.sourceGrant).toMatchObject({ token: sourceToken, purpose: 'video' })
    expect(response.sidecarGrant).toMatchObject({ token: sidecarToken, purpose: 'sidecar' })
    expect(JSON.stringify(response)).not.toContain(sourcePath)
    expect(JSON.stringify(response)).not.toContain(sidecarPath)
    await expect(
      calls.prepareVideoReplay({} as any, { sourceToken, videoPath: sourcePath })
    ).rejects.toThrow()
  })
})
