import { CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { CaptureProcessSupervisorController } from './capture-process-supervisor-controller'

vi.mock('../../native', () => ({
  getPidsByName: vi.fn().mockResolvedValue([])
}))

describe('CaptureProcessSupervisorController Deadlock & Gate A Lifecycle Test', () => {
  function createMockContext() {
    let enabled = true
    let canCapture = true
    let phase = 'None'
    let session: any = null
    let roiState = 'unknown'
    let frameAgeMs: number | null = null
    let dropCount = 0
    let queueDepth: number | null = null
    let workerHeartbeatAt: number | null = null
    let workerRestartCount = 0
    let sessionState = 'active'
    let coachSessionId: string | null = null
    let lastError: any = null
    const listeners: Array<() => void> = []

    const triggerReaction = () => {
      for (const listener of listeners) {
        listener()
      }
    }

    return {
      liveCoach: {
        setIdentityModelLoaded: vi.fn(),
        recordCalibrationAttempt: vi.fn(),
        settings: {
          get enabled() {
            return enabled
          },
          captureBackend: 'wgc',
          minimapSide: 'right',
          onboardingCompleted: true,
          privacyConsentVersion: CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
        },
        state: {
          capture: {
            get roiState() {
              return roiState
            },
            get frameAgeMs() {
              return frameAgeMs
            },
            get dropCount() {
              return dropCount
            },
            get queueDepth() {
              return queueDepth
            },
            get workerHeartbeatAt() {
              return workerHeartbeatAt
            },
            get workerRestartCount() {
              return workerRestartCount
            }
          },
          capability: {
            get enabledFeatureIds() {
              return canCapture ? ['coach.capture.screen'] : []
            }
          },
          session: {
            get id() {
              return coachSessionId
            },
            get state() {
              return sessionState
            },
            patch: '16.16.1'
          },
          liveData: { state: 'healthy' },
          get lastError() {
            return lastError
          },
          setCaptureState: vi.fn((info: any) => {
            if (info.roiState !== undefined) roiState = info.roiState
            if (info.frameAgeMs !== undefined) frameAgeMs = info.frameAgeMs
            if (info.dropCount !== undefined) dropCount = info.dropCount
            if (info.queueDepth !== undefined) queueDepth = info.queueDepth
            if (info.workerHeartbeatAt !== undefined) workerHeartbeatAt = info.workerHeartbeatAt
            if (info.workerRestartCount !== undefined) workerRestartCount = info.workerRestartCount
          }),
          setLastError: vi.fn((error) => {
            lastError = error
          })
        },
        refreshRuntimeCapabilities: vi.fn()
      },
      state: {
        setIsCapturing: vi.fn(),
        setBackend: vi.fn(),
        setFps: vi.fn(),
        setWorkerHealth: vi.fn(),
        setRoiHealth: vi.fn(),
        reset: vi.fn()
      },
      leagueClient: {
        data: {
          summoner: { me: null },
          gameflow: {
            get phase() {
              return phase
            },
            get session() {
              return session
            }
          }
        }
      },
      mobxUtils: {
        reaction: vi.fn((fn, effect) => {
          let lastVal: any = undefined
          const check = async () => {
            const val = fn()
            if (JSON.stringify(val) !== JSON.stringify(lastVal)) {
              lastVal = val
              await effect(val)
            }
          }
          listeners.push(check)
          check()
          return () => {
            const idx = listeners.indexOf(check)
            if (idx !== -1) listeners.splice(idx, 1)
          }
        })
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      setGameflow(newPhase: string, newSession: any) {
        phase = newPhase
        session = newSession
        coachSessionId = newSession?.gameData?.gameId
          ? String(newSession.gameData.gameId)
          : coachSessionId
        triggerReaction()
      },
      setGateA(allowed: boolean) {
        canCapture = allowed
        triggerReaction()
      },
      setCoachSessionId(id: string | null) {
        coachSessionId = id
        triggerReaction()
      },
      setCoachSessionState(state: string) {
        sessionState = state
        triggerReaction()
      },
      setRoiState(state: string) {
        roiState = state
        triggerReaction()
      }
    } as any
  }

  it('starts capture on initial unknown ROI without deadlock', () => {
    const ctx = createMockContext()
    const calibrationController = {
      getOrCreateCalibration: vi.fn().mockReturnValue({ roi: { x: 0, y: 0, width: 1, height: 1 } })
    } as any
    const observationController = {} as any

    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      calibrationController,
      observationController
    )
    const startSpy = vi.spyOn(supervisor, 'startSupervising').mockImplementation(async () => {})

    supervisor.init()

    // 初始状态：roiState 为 unknown，对局开始
    ctx.setGameflow('InProgress', { map: { id: 11 }, gameData: { gameId: 1001 } })

    expect(startSpy).toHaveBeenCalledWith('1001', expect.anything(), '16.16.1')

    supervisor.dispose()
  })

  it('uses the authoritative coach session id when LCU has not exposed a game id yet', () => {
    const ctx = createMockContext()
    const calibrationController = {
      getOrCreateCalibration: vi.fn().mockReturnValue({ roi: { x: 0, y: 0, width: 1, height: 1 } })
    } as any
    const supervisor = new CaptureProcessSupervisorController(ctx, calibrationController, {} as any)
    const startSpy = vi.spyOn(supervisor, 'startSupervising').mockImplementation(async () => {})

    supervisor.init()
    ctx.setCoachSessionId('sess-authoritative')
    ctx.setGameflow('InProgress', { map: { id: 11 }, gameData: {} })

    expect(startSpy).toHaveBeenCalledWith('sess-authoritative', expect.anything(), '16.16.1')
    supervisor.dispose()
  })

  it('continues capture when ROI is degraded', () => {
    const ctx = createMockContext()
    const calibrationController = {
      getOrCreateCalibration: vi.fn().mockReturnValue({ roi: { x: 0, y: 0, width: 1, height: 1 } })
    } as any
    const observationController = {} as any

    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      calibrationController,
      observationController
    )
    const stopSpy = vi.spyOn(supervisor, 'stopSupervising')

    supervisor.init()
    ctx.setGameflow('InProgress', { map: { id: 11 }, gameData: { gameId: 1001 } })

    // 清空初始化时的 stop 调用计数
    stopSpy.mockClear()

    // 运行中 ROI 变为 degraded
    ctx.setRoiState('degraded')

    // 断言：degraded 不会调用 stopSupervising
    expect(stopSpy).not.toHaveBeenCalled()

    supervisor.dispose()
  })

  it('stops supervising when Gate A is disabled and resumes automatically when re-enabled', () => {
    const ctx = createMockContext()
    const calibrationController = {
      getOrCreateCalibration: vi.fn().mockReturnValue({ roi: { x: 0, y: 0, width: 1, height: 1 } })
    } as any
    const observationController = {} as any

    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      calibrationController,
      observationController
    )
    const startSpy = vi.spyOn(supervisor, 'startSupervising').mockImplementation(async () => {})
    const stopSpy = vi.spyOn(supervisor, 'stopSupervising')

    supervisor.init()
    ctx.setGameflow('InProgress', { map: { id: 11 }, gameData: { gameId: 1001 } })

    startSpy.mockClear()
    stopSpy.mockClear()

    // 1. 关闭 Gate A
    ctx.setGateA(false)
    expect(stopSpy).toHaveBeenCalledTimes(1)

    // 2. 重新开启 Gate A
    ctx.setGateA(true)
    expect(startSpy).toHaveBeenCalledTimes(1)

    supervisor.dispose()
  })

  it('stops frame collection while paused and restarts it after resume', () => {
    const ctx = createMockContext()
    const calibrationController = {
      getOrCreateCalibration: vi.fn().mockReturnValue({ roi: { x: 0, y: 0, width: 1, height: 1 } })
    } as any
    const supervisor = new CaptureProcessSupervisorController(ctx, calibrationController, {} as any)
    const startSpy = vi.spyOn(supervisor, 'startSupervising').mockImplementation(async () => {})
    const stopSpy = vi.spyOn(supervisor, 'stopSupervising')
    supervisor.init()
    ctx.setGameflow('InProgress', { map: { id: 11 }, gameData: { gameId: 1001 } })

    startSpy.mockClear()
    stopSpy.mockClear()
    ctx.setCoachSessionState('paused')
    expect(stopSpy).toHaveBeenCalledOnce()

    ctx.setCoachSessionState('active')
    expect(startSpy).toHaveBeenCalledWith('1001', expect.anything(), '16.16.1')
    supervisor.dispose()
  })

  it('keeps the complete capture pipeline running in silent shadow mode', () => {
    const ctx = createMockContext()
    const calibrationController = {
      getOrCreateCalibration: vi.fn().mockReturnValue({ roi: { x: 0, y: 0, width: 1, height: 1 } })
    } as any
    const supervisor = new CaptureProcessSupervisorController(ctx, calibrationController, {} as any)
    const startSpy = vi.spyOn(supervisor, 'startSupervising').mockImplementation(async () => {})
    const stopSpy = vi.spyOn(supervisor, 'stopSupervising')
    supervisor.init()
    ctx.setGameflow('InProgress', { map: { id: 11 }, gameData: { gameId: 1001 } })

    startSpy.mockClear()
    stopSpy.mockClear()
    ctx.setCoachSessionState('shadow')

    expect(startSpy).toHaveBeenCalledWith('1001', expect.anything(), '16.16.1')
    expect(stopSpy).not.toHaveBeenCalled()
    supervisor.dispose()
  })

  it('uses desktopCapturer when the native facade exists but no compiled capture addon can load', () => {
    const ctx = createMockContext()
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any, () => ({
      wgc: false,
      dda: false
    }))

    expect((supervisor as any)._getEffectiveBackend()).toBe('desktopCapturer')
    expect(supervisor.probeCaptureSupport()).toMatchObject({
      supported: true,
      realtimeSupported: false,
      backends: ['desktopCapturer'],
      nativeBackends: [],
      fallbackAvailable: true,
      permissionGranted: null
    })
  })

  it('does not read a game-window thumbnail before the current privacy notice is confirmed', async () => {
    const ctx = createMockContext()
    ctx.liveCoach.settings.onboardingCompleted = false
    ctx.liveCoach.settings.privacyConsentVersion = null
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)
    const findSource = vi.spyOn(supervisor as any, '_findGameCaptureSource')

    await expect(supervisor.requestCalibrationPreview(false)).rejects.toMatchObject({
      code: 'consent-required'
    })
    expect(findSource).not.toHaveBeenCalled()
  })

  it('keeps the thumbnail size separate from the inspected target-window size', async () => {
    const ctx = createMockContext()
    let environment: any = null
    const calibration = { confidence: 0.9 }
    const calibrationController = {
      setTargetEnvironment: vi.fn((value) => {
        environment = value
        return true
      }),
      getEnvironmentFingerprint: vi.fn(() => ({
        displayId: environment?.displayId ?? null,
        width: environment?.clientBounds.width ?? null,
        height: environment?.clientBounds.height ?? null,
        dpiScale: environment?.dpiScale ?? null,
        hdr: environment?.hdr ?? null,
        windowMode: environment?.windowMode ?? 'unknown',
        backend: 'desktopCapturer',
        minimapSide: 'right'
      })),
      applyAutomaticDetection: vi.fn(() => calibration)
    }
    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      calibrationController as any,
      {} as any,
      () => ({ wgc: false, dda: false }),
      () => ({
        targetPid: 10,
        displayId: '\\\\.\\DISPLAY2',
        windowBounds: { x: 2000, y: 100, width: 1936, height: 1128 },
        clientBounds: { x: 2008, y: 120, width: 1920, height: 1080 },
        monitorBounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        dpiScale: 1.5,
        hdr: null,
        windowMode: 'windowed'
      })
    )
    vi.spyOn(supervisor as any, '_findGameCaptureSource').mockResolvedValue({
      id: 'window:123:0',
      thumbnail: {
        isEmpty: () => false,
        getSize: () => ({ width: 1280, height: 720 }),
        toBitmap: () => new Uint8Array(1280 * 720 * 4)
      }
    })

    await expect(supervisor.requestCalibrationPreview(false)).resolves.toMatchObject({
      calibration,
      fingerprint: { displayId: '\\\\.\\DISPLAY2', width: 1920, height: 1080, hdr: null },
      sourceSize: { width: 1920, height: 1080 },
      thumbnailSize: { width: 1280, height: 720 }
    })
    expect(ctx.liveCoach.recordCalibrationAttempt).toHaveBeenCalledWith(calibration)
  })

  it('selects the configured native backend only after the compiled addon reports support', () => {
    const ctx = createMockContext()
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any, () => ({
      wgc: true,
      dda: true
    }))

    expect((supervisor as any)._getEffectiveBackend()).toBe('wgc')
    expect(supervisor.probeCaptureSupport()).toMatchObject({
      realtimeSupported: true,
      backends: ['wgc', 'dda', 'desktopCapturer'],
      nativeBackends: ['wgc', 'dda'],
      permissionGranted: null
    })
  })

  it('preserves auto selection so a runtime WGC failure can fall back to DDA in the worker', () => {
    const ctx = createMockContext()
    ctx.liveCoach.settings.captureBackend = 'auto'
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any, () => ({
      wgc: true,
      dda: true
    }))

    expect((supervisor as any)._getEffectiveBackend()).toBe('auto')
  })

  it('partitions champion candidates by the current summoner team and identifies self', () => {
    const ctx = createMockContext()
    ctx.leagueClient.data.summoner.me = { puuid: 'self-puuid', summonerId: 7 }
    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: {
        gameId: 1001,
        teamOne: [
          { championId: 103, puuid: 'self-puuid', summonerId: 7 },
          { championId: 64, puuid: 'ally', summonerId: 8 }
        ],
        teamTwo: [
          { championId: 90, puuid: 'enemy-one', summonerId: 9 },
          { championId: 99, puuid: 'enemy-two', summonerId: 10 }
        ]
      }
    })
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)

    expect((supervisor as any)._getChampionRoster()).toEqual({
      all: [103, 64, 90, 99],
      ally: [103, 64],
      enemy: [90, 99],
      selfChampionId: 103
    })
  })

  it('falls back to desktopCapturer when native capture fails after worker startup', () => {
    const ctx = createMockContext()
    const calibrationController = {
      getOrCreateCalibration: vi.fn().mockReturnValue({
        id: 'desktop-fallback',
        roi: { x: 0.82, y: 0.72, width: 0.18, height: 0.28 }
      })
    }
    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      calibrationController as any,
      {} as any
    )
    const fallbackSpy = vi
      .spyOn(supervisor as any, '_startCaptureLoop')
      .mockImplementation(() => {})
    vi.spyOn(supervisor as any, '_refreshCalibrationFromGameWindow').mockResolvedValue(undefined)

    ;(supervisor as any)._handleWorkerMessage({
      type: 'error',
      code: 'LC_ERR_NATIVE_CAPTURE_FAILED',
      stage: 'capture',
      details: 'native capture failed',
      recoverable: true
    })

    expect(fallbackSpy).toHaveBeenCalledOnce()
    expect(calibrationController.getOrCreateCalibration).toHaveBeenCalledOnce()
    expect(ctx.state.setBackend).toHaveBeenCalledWith('desktopCapturer')
    expect(ctx.liveCoach.state.setCaptureState).toHaveBeenCalledWith({ roiState: 'degraded' })
    expect(ctx.liveCoach.state.setCaptureState).toHaveBeenCalledWith({
      backend: 'desktopCapturer'
    })
    expect(ctx.liveCoach.refreshRuntimeCapabilities).toHaveBeenCalledWith({
      roiHealth: 'degraded',
      state: 'running',
      liveDataHealth: 'healthy',
      backend: 'desktopCapturer'
    })
    expect(ctx.liveCoach.state.setLastError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'capture-stalled', stage: 'minimap-capture' })
    )
  })

  it('logs only stable worker error fields and never raw worker details', () => {
    const ctx = createMockContext()
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)

    ;(supervisor as any)._handleWorkerMessage({
      type: 'error',
      code: 'LC_ERR_IDENTITY_MODEL_LOAD_FAILED',
      stage: 'C:\\Users\\private\\model.onnx',
      details:
        'Authorization=private-token, https://example.test/private, C:\\Users\\private\\model.onnx, /home/private/model.onnx\n at worker.js:1:1',
      recoverable: true
    })

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'Worker reported internal-error at minimap-identity-model; recoverable=true'
    )
    const logged = JSON.stringify(ctx.logger.warn.mock.calls)
    expect(logged).not.toContain('private-token')
    expect(logged).not.toContain('example.test')
    expect(logged).not.toContain('C:\\\\Users')
    expect(logged).not.toContain('/home/private')
  })

  it('sanitizes automatic and runtime calibration errors before logging', async () => {
    const ctx = createMockContext()
    ctx.liveCoach.settings.minimapSide = 'auto'
    const calibration = {
      id: 'automatic-log-sanitization',
      source: 'automatic',
      roi: { x: 0.82, y: 0.72, width: 0.18, height: 0.28 }
    }
    const calibrationController = {
      getOrCreateCalibration: vi.fn().mockReturnValue(calibration)
    }
    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      calibrationController as any,
      {} as any,
      () => ({ wgc: false, dda: false })
    )
    const sensitiveError = new Error(
      'Authorization=private-token, URL https://example.test/private, Windows C:\\Users\\private\\model.onnx, Unix /home/private/model.onnx\n at worker.js:1:1'
    )
    const findSource = vi
      .spyOn(supervisor as any, '_findGameCaptureSource')
      .mockRejectedValueOnce(sensitiveError)
      .mockResolvedValue(null)
    vi.spyOn(supervisor as any, '_spawnWorker').mockImplementation(() => {})
    vi.spyOn(supervisor as any, '_startCaptureLoop').mockImplementation(() => {})

    await supervisor.startSupervising('session-log-sanitization', calibration as any, '16.16.1')

    expect(JSON.stringify(ctx.logger.info.mock.calls)).not.toContain('session-log-sanitization')
    let logged = JSON.stringify(ctx.logger.warn.mock.calls)
    expect(logged).toContain('[redacted]')
    expect(logged).toContain('[url]')
    expect(logged).toContain('[local-path]')
    expect(logged).not.toContain('private-token')
    expect(logged).not.toContain('example.test')
    expect(logged).not.toContain('C:\\\\Users')
    expect(logged).not.toContain('/home/private')

    ctx.logger.warn.mockClear()
    findSource.mockRejectedValueOnce(sensitiveError)
    await (supervisor as any)._refreshCalibrationFromGameWindow(
      (supervisor as any)._lifecycleVersion,
      'session-log-sanitization'
    )
    logged = JSON.stringify(ctx.logger.warn.mock.calls)
    expect(logged).toContain('[redacted]')
    expect(logged).toContain('[url]')
    expect(logged).toContain('[local-path]')
    expect(logged).not.toContain('private-token')
    expect(logged).not.toContain('example.test')
    expect(logged).not.toContain('C:\\\\Users')
    expect(logged).not.toContain('/home/private')

    supervisor.stopSupervising()
  })

  it('sanitizes worker-spawn errors before logging or publishing them', async () => {
    const ctx = createMockContext()
    const calibration = {
      id: 'spawn-log-sanitization',
      source: 'manual',
      roi: { x: 0.82, y: 0.72, width: 0.18, height: 0.28 }
    }
    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      { getOrCreateCalibration: vi.fn().mockReturnValue(calibration) } as any,
      {} as any,
      () => ({ wgc: true, dda: false })
    )
    const sensitiveError = new Error(
      'Authorization=private-token, URL https://example.test/private, Windows C:\\Users\\private\\model.onnx, Unix /home/private/model.onnx'
    )
    vi.spyOn(supervisor as any, '_findGameCaptureSource').mockResolvedValue(null)
    vi.spyOn(supervisor as any, '_spawnWorker').mockImplementation(() => {
      throw sensitiveError
    })

    await supervisor.startSupervising('session-spawn-log', calibration as any, '16.16.1')

    const logged = JSON.stringify(ctx.logger.warn.mock.calls)
    const published = JSON.stringify(ctx.liveCoach.state.setLastError.mock.calls)
    for (const output of [logged, published]) {
      expect(output).toContain('[redacted]')
      expect(output).toContain('[url]')
      expect(output).toContain('[local-path]')
      expect(output).not.toContain('private-token')
      expect(output).not.toContain('example.test')
      expect(output).not.toContain('C:\\\\Users')
      expect(output).not.toContain('/home/private')
    }

    supervisor.stopSupervising()
  })

  it('enables identity analysis only after the worker reports the verified model version', () => {
    const ctx = createMockContext()
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)
    ;(supervisor as any)._identityModelDescriptor = {
      version: '16.16.1-template.1',
      sha256: 'a'.repeat(64)
    }

    ;(supervisor as any)._handleWorkerMessage({
      type: 'ready',
      protocolVersion: '1.0.0',
      runtimeVersions: { 'champion-icon-onnx': '16.16.1-onnx.1' },
      supportedBackends: ['wgc']
    })
    expect(ctx.liveCoach.setIdentityModelLoaded).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ version: expect.any(String), sha256: expect.any(String) })
    )

    ;(supervisor as any)._handleWorkerMessage({
      type: 'error',
      code: 'LC_ERR_IDENTITY_MODEL_LOAD_FAILED',
      stage: 'model-load',
      details: 'hash mismatch',
      recoverable: true
    })
    expect(ctx.liveCoach.setIdentityModelLoaded).toHaveBeenLastCalledWith(false)
  })

  it('keeps main-gated frame freshness when worker metrics arrive later', () => {
    const ctx = createMockContext()
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)
    ctx.liveCoach.state.setCaptureState({ frameAgeMs: 480, dropCount: 3 })
    ctx.liveCoach.state.setCaptureState.mockClear()

    ;(supervisor as any)._handleWorkerMessage({
      type: 'metrics',
      captureLatencyMs: 12,
      inferenceLatencyMs: 18,
      dropCount: 4,
      frameAgeMs: 35
    })

    const metricsUpdate = ctx.liveCoach.state.setCaptureState.mock.calls.at(-1)?.[0]
    expect(metricsUpdate).toEqual({
      captureLatencyMs: 12,
      inferenceLatencyMs: 18,
      dropCount: 4
    })
    expect(metricsUpdate).not.toHaveProperty('frameAgeMs')
    expect(ctx.liveCoach.state.capture.frameAgeMs).toBe(480)
  })

  it('publishes only a real worker heartbeat and its measured queue depth', () => {
    const now = 1_700_000_000_000
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const ctx = createMockContext()
      const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)

      ;(supervisor as any)._handleWorkerMessage({
        type: 'heartbeat',
        sequence: 7,
        captureState: 'running',
        queueDepth: 3,
        memoryBytes: 1024
      })

      expect(ctx.liveCoach.state.setCaptureState).toHaveBeenLastCalledWith({
        queueDepth: 3,
        workerHeartbeatAt: now
      })
      expect(ctx.liveCoach.state.capture.queueDepth).toBe(3)
      expect(ctx.liveCoach.state.capture.workerHeartbeatAt).toBe(now)
    } finally {
      dateNow.mockRestore()
    }
  })

  it('recalibrates after the native ROI resolution changes at runtime', () => {
    const ctx = createMockContext()
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)
    const recalibrate = vi
      .spyOn(supervisor as any, '_refreshCalibrationFromGameWindow')
      .mockResolvedValue(undefined)
    const status = (width: number, height: number) => ({
      type: 'status' as const,
      backend: 'wgc' as const,
      resolution: { width: 250, height: 250 },
      sourceResolution: { width, height },
      hdr: false,
      fps: 10,
      roiHealth: 'healthy' as const
    })

    ;(supervisor as any)._handleWorkerMessage(status(250, 250))
    expect(recalibrate).not.toHaveBeenCalled()
    expect(ctx.liveCoach.refreshRuntimeCapabilities).toHaveBeenCalledWith({
      roiHealth: 'healthy',
      state: 'running',
      liveDataHealth: 'healthy',
      backend: 'wgc'
    })
    ;(supervisor as any)._handleWorkerMessage(status(300, 300))
    expect(recalibrate).toHaveBeenCalledOnce()
  })

  it('recalibrates when the inspected target moves to another display at the same resolution', async () => {
    const ctx = createMockContext()
    let displayId = '\\\\.\\DISPLAY1'
    let previousEnvironment = ''
    const calibrationController = {
      setTargetEnvironment: vi.fn((environment: unknown) => {
        const next = JSON.stringify(environment)
        const changed = next !== previousEnvironment
        previousEnvironment = next
        return changed
      })
    }
    const inspect = vi.fn(() => ({
      targetPid: 10,
      displayId,
      windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      clientBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      monitorBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      dpiScale: displayId.endsWith('1') ? 1 : 1.5,
      hdr: null,
      windowMode: 'unknown' as const
    }))
    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      calibrationController as any,
      {} as any,
      () => ({ wgc: true, dda: false }),
      inspect
    )
    ;(supervisor as any)._targetHwnd = 123
    ;(supervisor as any)._targetPid = 10
    ;(supervisor as any)._isSupervising = true
    ;(supervisor as any)._currentSessionId = 'display-move'
    const recalibrate = vi
      .spyOn(supervisor as any, '_refreshCalibrationFromGameWindow')
      .mockResolvedValue(undefined)
    const status = {
      type: 'status' as const,
      backend: 'wgc' as const,
      resolution: { width: 250, height: 250 },
      sourceResolution: { width: 1920, height: 1080 },
      hdr: false,
      fps: 10,
      roiHealth: 'healthy' as const
    }

    ;(supervisor as any)._handleWorkerMessage(status)
    await Promise.resolve()
    recalibrate.mockClear()
    ;(supervisor as any)._currentCalibration = { id: 'display-1-calibration' }
    ctx.liveCoach.state.setCaptureState.mockClear()
    displayId = '\\\\.\\DISPLAY2'
    ;(supervisor as any)._handleWorkerMessage(status)

    expect(calibrationController.setTargetEnvironment).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayId: '\\\\.\\DISPLAY2', dpiScale: 1.5, hdr: null })
    )
    expect(recalibrate).toHaveBeenCalledOnce()
    expect((supervisor as any)._currentCalibration).toBeNull()
    expect(ctx.liveCoach.state.setCaptureState).toHaveBeenCalledWith(
      expect.objectContaining({ roiState: 'unknown', confidence: null })
    )
  })

  it('does not publish the cropped ROI as the game resolution', () => {
    const ctx = createMockContext()
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)

    ;(supervisor as any)._handleWorkerMessage({
      type: 'status',
      backend: 'wgc',
      resolution: { width: 250, height: 250 },
      sourceResolution: null,
      hdr: null,
      fps: 10,
      roiHealth: 'healthy'
    })

    expect(ctx.liveCoach.state.setCaptureState).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: null })
    )
  })

  it('immediately withdraws realtime capability when the worker falls back to diagnostic capture', () => {
    const ctx = createMockContext()
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)

    ;(supervisor as any)._handleWorkerMessage({
      type: 'status',
      backend: 'desktopCapturer',
      resolution: { width: 250, height: 250 },
      hdr: false,
      fps: 8,
      roiHealth: 'healthy'
    })

    expect(ctx.liveCoach.refreshRuntimeCapabilities).toHaveBeenCalledWith({
      roiHealth: 'healthy',
      state: 'running',
      liveDataHealth: 'healthy',
      backend: 'desktopCapturer'
    })
    expect(ctx.liveCoach.state.setLastError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'capture-stalled',
        stage: 'minimap-capture',
        recoverable: true
      })
    )
  })

  it('kills an unresponsive worker after the heartbeat deadline', () => {
    vi.useFakeTimers()
    try {
      const ctx = createMockContext()
      const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)
      const worker = { postMessage: vi.fn(), kill: vi.fn() }
      ;(supervisor as any)._worker = worker
      ;(supervisor as any)._startHeartbeatMonitor(worker)

      vi.advanceTimersByTime(3001)

      expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ping' }))
      expect(worker.kill).toHaveBeenCalledOnce()
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        'Minimap worker heartbeat timed out; restarting worker'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('publishes an idle capture state when an active supervisor stops', () => {
    const ctx = createMockContext()
    const supervisor = new CaptureProcessSupervisorController(ctx, {} as any, {} as any)
    ;(supervisor as any)._isSupervising = true
    ;(supervisor as any)._currentSessionId = 'session-1'

    supervisor.stopSupervising()

    expect(ctx.liveCoach.state.setCaptureState).toHaveBeenCalledWith({
      state: 'idle',
      backend: null,
      fps: 0,
      frameAgeMs: null,
      roiState: 'unknown',
      resolution: null,
      confidence: null,
      lastObservationAt: null,
      modelVersions: {},
      captureLatencyMs: null,
      inferenceLatencyMs: null,
      dropCount: 0,
      queueDepth: null,
      workerHeartbeatAt: null,
      workerRestartCount: 0
    })
  })

  it('does not advertise a model version while the capture pipeline is degraded', () => {
    vi.useFakeTimers()
    try {
      const ctx = createMockContext()
      const handleObservationBatch = vi.fn()
      const supervisor = new CaptureProcessSupervisorController(
        ctx,
        {} as any,
        { handleObservationBatch } as any
      )

      ;(supervisor as any)._isSupervising = true
      ;(supervisor as any)._startInternalPipeline('session-degraded', {
        x: 0.82,
        y: 0.72,
        width: 0.18,
        height: 0.28
      })
      vi.advanceTimersByTime(1000)

      expect(handleObservationBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-degraded',
          health: 'unknown',
          modelVersions: {}
        })
      )
      expect(ctx.state.setIsCapturing).toHaveBeenCalledWith(false)
      expect(ctx.liveCoach.state.setCaptureState).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'internal-error', roiState: 'unknown' })
      )
      expect(ctx.liveCoach.state.setLastError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'internal-error', stage: 'minimap-capture' })
      )
      supervisor.stopSupervising()
    } finally {
      vi.useRealTimers()
    }
  })

  it('detects the minimap side from the live game window before auto capture starts', async () => {
    const ctx = createMockContext()
    ctx.liveCoach.settings.minimapSide = 'auto'
    const fallbackCalibration = {
      id: 'fallback-right',
      source: 'automatic',
      roi: { x: 0.82, y: 0.72, width: 0.18, height: 0.28 }
    }
    const detectedCalibration = {
      id: 'detected-left',
      source: 'automatic',
      roi: { x: 0, y: 0.72, width: 0.18, height: 0.28 }
    }
    const bitmap = new Uint8Array([1, 2, 3, 4])
    const calibrationController = {
      getOrCreateCalibration: vi.fn().mockReturnValue(fallbackCalibration),
      applyAutomaticDetection: vi.fn().mockReturnValue(detectedCalibration)
    } as any
    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      calibrationController,
      {} as any,
      () => ({ wgc: false, dda: false })
    )
    vi.spyOn(supervisor as any, '_findGameCaptureSource').mockResolvedValue({
      id: 'window:123:0',
      thumbnail: {
        isEmpty: () => false,
        getSize: () => ({ width: 1280, height: 720 }),
        toBitmap: () => bitmap
      }
    })
    const spawnSpy = vi.spyOn(supervisor as any, '_spawnWorker').mockImplementation(() => {})
    vi.spyOn(supervisor as any, '_startCaptureLoop').mockImplementation(() => {})

    await supervisor.startSupervising('session-auto', fallbackCalibration as any, '16.16.1')

    expect(calibrationController.applyAutomaticDetection).toHaveBeenCalledWith(bitmap, 1280, 720)
    expect(spawnSpy).toHaveBeenCalledWith('session-auto', detectedCalibration)
  })

  it('replaces a provisional session only after its worker and capture timers are stopped', async () => {
    vi.useFakeTimers()
    try {
      const ctx = createMockContext()
      const calibration = {
        id: 'stable-calibration',
        source: 'manual',
        roi: { x: 0.82, y: 0.72, width: 0.18, height: 0.28 }
      }
      const calibrationController = {
        getOrCreateCalibration: vi.fn().mockReturnValue(calibration)
      }
      const supervisor = new CaptureProcessSupervisorController(
        ctx,
        calibrationController as any,
        {} as any,
        () => ({ wgc: true, dda: false })
      )
      const lifecycleOrder: string[] = []
      const oldWorker = {
        postMessage: vi.fn(() => {
          throw new Error('worker IPC is already closed')
        }),
        kill: vi.fn(() => lifecycleOrder.push('kill-old'))
      }
      const newWorker = { postMessage: vi.fn(), kill: vi.fn() }
      const oldCaptureTick = vi.fn()

      ;(supervisor as any)._isSupervising = true
      ;(supervisor as any)._currentSessionId = 'pending-game'
      ;(supervisor as any)._currentCalibration = calibration
      ;(supervisor as any)._worker = oldWorker
      ;(supervisor as any)._captureTimer = setInterval(oldCaptureTick, 100)
      ;(supervisor as any)._startHeartbeatMonitor(oldWorker)
      ;(supervisor as any)._handleWorkerMessage({
        type: 'metrics',
        captureLatencyMs: 10,
        inferenceLatencyMs: 20,
        dropCount: 4,
        frameAgeMs: 30
      })
      expect(ctx.liveCoach.state.capture.dropCount).toBe(4)
      vi.spyOn(supervisor as any, '_findGameCaptureSource').mockResolvedValue(null)
      const spawnSpy = vi
        .spyOn(supervisor as any, '_spawnWorker')
        .mockImplementation((...args: unknown[]) => {
          const sessionId = String(args[0])
          lifecycleOrder.push(`spawn-${sessionId}`)
          expect(oldWorker.kill).toHaveBeenCalledOnce()
          expect((supervisor as any)._worker).toBeNull()
          expect((supervisor as any)._captureTimer).toBeNull()
          expect((supervisor as any)._heartbeatTimer).toBeNull()
          ;(supervisor as any)._dropCountBase = ctx.liveCoach.state.capture.dropCount
          ;(supervisor as any)._worker = newWorker
          ;(supervisor as any)._startHeartbeatMonitor(newWorker)
        })

      await supervisor.startSupervising('123456', calibration as any, '16.16.1')

      expect(oldWorker.postMessage).toHaveBeenCalledWith({
        type: 'stop',
        sessionId: 'pending-game',
        reason: 'capture-stopped'
      })
      expect(lifecycleOrder).toEqual(['kill-old', 'spawn-123456'])
      expect(spawnSpy).toHaveBeenCalledWith('123456', calibration)
      expect((supervisor as any)._currentSessionId).toBe('123456')
      expect(ctx.liveCoach.state.capture.dropCount).toBe(4)

      ;(supervisor as any)._handleWorkerMessage({
        type: 'metrics',
        captureLatencyMs: 11,
        inferenceLatencyMs: 21,
        dropCount: 2,
        frameAgeMs: 31
      })
      expect(ctx.liveCoach.state.capture.dropCount).toBe(6)

      vi.advanceTimersByTime(1000)
      expect(oldCaptureTick).not.toHaveBeenCalled()
      expect(oldWorker.postMessage).toHaveBeenCalledTimes(1)
      expect(newWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ping' }))

      supervisor.stopSupervising()
      expect(newWorker.kill).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reinitializes the worker for a resolved patch and preserves drops across calibration starts', async () => {
    vi.useFakeTimers()
    try {
      const ctx = createMockContext()
      const initialCalibration = {
        id: 'calibration-a',
        source: 'manual',
        roi: { x: 0.82, y: 0.72, width: 0.18, height: 0.28 }
      }
      const updatedCalibration = {
        ...initialCalibration,
        id: 'calibration-b',
        roi: { x: 0.81, y: 0.71, width: 0.19, height: 0.29 }
      }
      const calibrationController = {
        getOrCreateCalibration: vi.fn().mockReturnValue(initialCalibration),
        getEnvironmentFingerprint: vi.fn().mockReturnValue({ width: 1920, height: 1080 })
      }
      const supervisor = new CaptureProcessSupervisorController(
        ctx,
        calibrationController as any,
        {} as any,
        () => ({ wgc: true, dda: false })
      )
      const oldWorker = { postMessage: vi.fn(), kill: vi.fn() }
      const newWorker = { postMessage: vi.fn(), kill: vi.fn() }
      const identityModel = {
        version: '16.16.1-accepted.1',
        sha256: 'a'.repeat(64),
        path: 'champion-identity.onnx'
      }

      ;(supervisor as any)._isSupervising = true
      ;(supervisor as any)._currentSessionId = 'game-1001'
      ;(supervisor as any)._currentPatch = 'unknown'
      ;(supervisor as any)._currentCalibration = initialCalibration
      ;(supervisor as any)._worker = oldWorker
      ;(supervisor as any)._handleWorkerMessage({
        type: 'metrics',
        captureLatencyMs: 10,
        inferenceLatencyMs: 20,
        dropCount: 2,
        frameAgeMs: 30
      })
      vi.spyOn(supervisor as any, '_findGameCaptureSource').mockResolvedValue(null)
      const resolveModelSpy = vi
        .spyOn(supervisor as any, '_resolveIdentityModel')
        .mockReturnValue(identityModel)
      const spawnSpy = vi
        .spyOn(supervisor as any, '_spawnWorker')
        .mockImplementation((...args: unknown[]) => {
          const [sessionId, calibration] = args as [string, typeof initialCalibration]
          ;(supervisor as any)._dropCountBase = ctx.liveCoach.state.capture.dropCount
          ;(supervisor as any)._worker = newWorker
          ;(supervisor as any)._initializeWorker(newWorker)
          ;(supervisor as any)._postWorkerStart(sessionId, calibration)
        })

      await supervisor.startSupervising('game-1001', initialCalibration as any, '16.16.1')

      expect(oldWorker.kill).toHaveBeenCalledOnce()
      expect(spawnSpy).toHaveBeenCalledOnce()
      expect(resolveModelSpy).toHaveBeenCalledWith('16.16.1')
      expect(newWorker.postMessage).toHaveBeenCalledWith({
        type: 'initialize',
        protocolVersion: '1.0.0',
        runtimePaths: {},
        modelManifest: { 'champion-icon-onnx': identityModel }
      })

      ;(supervisor as any)._handleWorkerMessage({
        type: 'metrics',
        captureLatencyMs: 11,
        inferenceLatencyMs: 21,
        dropCount: 3,
        frameAgeMs: 31
      })
      expect(ctx.liveCoach.state.capture.dropCount).toBe(5)

      calibrationController.getOrCreateCalibration.mockReturnValue(updatedCalibration)
      await supervisor.startSupervising('game-1001', updatedCalibration as any, '16.16.1')
      expect(spawnSpy).toHaveBeenCalledOnce()
      expect(newWorker.kill).not.toHaveBeenCalled()

      ;(supervisor as any)._handleWorkerMessage({
        type: 'metrics',
        captureLatencyMs: 12,
        inferenceLatencyMs: 22,
        dropCount: 1,
        frameAgeMs: 32
      })
      expect(ctx.liveCoach.state.capture.dropCount).toBe(6)

      const startMessageCount = newWorker.postMessage.mock.calls.filter(
        ([message]) => message.type === 'start'
      ).length
      await supervisor.startSupervising('game-1001', updatedCalibration as any, '16.16.1')
      expect(
        newWorker.postMessage.mock.calls.filter(([message]) => message.type === 'start')
      ).toHaveLength(startMessageCount)

      supervisor.stopSupervising()
      expect(newWorker.kill).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not revive capture when an asynchronous start finishes after the session stopped', async () => {
    const ctx = createMockContext()
    ctx.liveCoach.settings.minimapSide = 'auto'
    const calibration = {
      id: 'pending-auto',
      source: 'automatic',
      roi: { x: 0.82, y: 0.72, width: 0.18, height: 0.28 }
    }
    const supervisor = new CaptureProcessSupervisorController(
      ctx,
      {
        getOrCreateCalibration: vi.fn().mockReturnValue(calibration),
        applyAutomaticDetection: vi.fn()
      } as any,
      {} as any,
      () => ({ wgc: false, dda: false })
    )
    let resolveSource!: (value: null) => void
    vi.spyOn(supervisor as any, '_findGameCaptureSource').mockReturnValue(
      new Promise<null>((resolve) => {
        resolveSource = resolve
      })
    )
    const spawnSpy = vi.spyOn(supervisor as any, '_spawnWorker').mockImplementation(() => {})

    const starting = supervisor.startSupervising(
      'session-stopped-during-start',
      calibration as any,
      '16.16.1'
    )
    supervisor.stopSupervising()
    resolveSource(null)
    await starting

    expect(spawnSpy).not.toHaveBeenCalled()
    expect(ctx.state.setIsCapturing).not.toHaveBeenCalledWith(true)
  })
})
