import {
  CaptureEnvironmentFingerprint,
  type CoachPublicError,
  MinimapCalibration,
  MinimapObservationBatch,
  WorkerToMainMessage,
  hasCurrentLiveCoachPrivacyConsent,
  workerToMainMessageSchema
} from '@shared/types/live-coach'
import {
  type DesktopCapturerSource,
  type UtilityProcess,
  app,
  desktopCapturer,
  utilityProcess
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { getPidsByName } from '../../native'
import {
  loadTrustedNativeRuntime,
  resolveTrustedNativeRuntimeRoot
} from '../../native/trusted-native-runtime'
import { AkariIpcError } from '../ipc'
import { LIVE_COACH_CONSENT_REQUIRED_REASON } from '../live-coach/privacy-consent'
import type {
  CaptureTargetEnvironment,
  MinimapCalibrationController
} from './calibration-controller'
import {
  createChampionIdentityModelRoots,
  resolveChampionIdentityModelFromRoots
} from './champion-identity-model'
import type { MinimapObserverMainContext } from './context'
import type { MinimapObservationController } from './observation-controller'
import {
  createSanitizedPublicError,
  createWorkerPublicError,
  formatSanitizedErrorLog,
  sanitizeCaughtErrorDetails
} from './public-error'

interface NativeCaptureSupport {
  wgc: boolean
  dda: boolean
}

interface NativeCaptureTargetEnvironment extends CaptureTargetEnvironment {
  targetPid: number
  windowBounds: { x: number; y: number; width: number; height: number }
  monitorBounds: { x: number; y: number; width: number; height: number }
}

type InspectNativeCaptureTarget = (options: {
  targetHwnd?: number | null
  targetPid?: number | null
}) => NativeCaptureTargetEnvironment | null

const LEAGUE_GAME_WINDOW_TITLE = 'League of Legends (TM) Client'
const NATIVE_CAPTURE_RETRY_DELAYS_MS = [15_000, 30_000, 60_000] as const
const NATIVE_CAPTURE_PROBE_TIMEOUT_MS = 5000
const WORKER_INITIALIZATION_TIMEOUT_MS = 30_000
const NATIVE_CAPTURE_FPS = 10
const COMPATIBILITY_CAPTURE_FPS = 5
const COMPATIBILITY_CAPTURE_SIZE = { width: 1600, height: 900 } as const
const AUTOMATIC_RECALIBRATION_DELAYS_MS = [2000, 5000, 15_000, 30_000] as const

function parseDesktopCapturerWindowHandle(sourceId: string): number | null {
  const match = sourceId.match(/^window:(\d+):/)
  if (!match) return null
  const windowHandle = Number(match[1])
  return Number.isSafeInteger(windowHandle) && windowHandle > 0 ? windowHandle : null
}

export function selectLeagueGameCaptureSource<
  TSource extends Pick<DesktopCapturerSource, 'id' | 'name'>
>(
  sources: readonly TSource[],
  targetPids: ReadonlySet<number>,
  inspectTarget: InspectNativeCaptureTarget
): TSource | null {
  const candidates = sources.filter(
    (source) =>
      source.name === LEAGUE_GAME_WINDOW_TITLE ||
      (source.name.includes('League of Legends') && !source.name.includes('LeagueClient'))
  )

  if (targetPids.size > 0) {
    let exactTitleWithoutEnvironment: TSource | null = null
    for (const source of candidates) {
      const targetHwnd = parseDesktopCapturerWindowHandle(source.id)
      if (targetHwnd === null) continue
      const environment = inspectTarget({ targetHwnd })
      if (environment !== null) {
        if (targetPids.has(environment.targetPid)) return source
        continue
      }
      if (source.name === LEAGUE_GAME_WINDOW_TITLE && exactTitleWithoutEnvironment === null) {
        exactTitleWithoutEnvironment = source
      }
    }
    // Native inspection can temporarily return null while the game changes display mode. The
    // exact Riot game title remains safe, but a verified PID mismatch must never be accepted.
    return exactTitleWithoutEnvironment
  }

  // The LeagueClientUx window is titled simply "League of Legends" on Tencent clients.
  // Never use that fuzzy title when the real game window cannot be verified.
  return candidates.find((source) => source.name === LEAGUE_GAME_WINDOW_TITLE) ?? null
}

function detectNativeCaptureSupport(): NativeCaptureSupport {
  if (process.platform !== 'win32') return { wgc: false, dda: false }

  try {
    const native = loadTrustedNativeRuntime<typeof import('league-akari-native-win32')>()
    native.capture.load()
    return {
      wgc: Boolean(native.capture.isWgcSupported()),
      dda: Boolean(native.capture.isDdaSupported())
    }
  } catch {
    // The TypeScript facade can exist while the compiled .node addon is absent.
    return { wgc: false, dda: false }
  }
}

function inspectNativeCaptureTarget(options: {
  targetHwnd?: number | null
  targetPid?: number | null
}): NativeCaptureTargetEnvironment | null {
  if (process.platform !== 'win32') return null
  try {
    const native = loadTrustedNativeRuntime<typeof import('league-akari-native-win32')>()
    native.capture.load()
    return native.capture.inspectTargetEnvironment(options)
  } catch {
    return null
  }
}

export class CaptureProcessSupervisorController {
  private _worker: UtilityProcess | null = null
  private _workerReady = false
  private _isSupervising = false
  private _currentSessionId = ''
  private readonly _maxCrashLimit = 3
  private readonly _crashWindowMs = 10 * 60 * 1000
  private _workerCrashTimestamps: number[] = []
  private _gameflowDisposer: (() => void) | null = null
  private _captureTimer: NodeJS.Timeout | null = null
  private _captureInFlight = false
  private _nativeCaptureFailed = false
  private _nativeCaptureRetryTimer: NodeJS.Timeout | null = null
  private _nativeCaptureRetryCount = 0
  private _nativeCaptureRetryInFlight = false
  private _nativeCaptureRetryGeneration = 0
  private _nativeCaptureProbeTimer: NodeJS.Timeout | null = null
  private _nativeCaptureAttemptActive = false
  private _lifecycleVersion = 0
  private _simulationTimer: NodeJS.Timeout | null = null
  private _heartbeatTimer: NodeJS.Timeout | null = null
  private _workerInitializationTimer: NodeJS.Timeout | null = null
  private _lastWorkerHeartbeatAt = 0
  private _heartbeatSequence = 0
  private _workerRestartCount = 0
  private _dropCountBase = 0
  private _lastCaptureResolution: { width: number; height: number } | null = null
  private _recalibrationInFlight = false
  private _automaticRecalibrationAttempt = 0
  private _nextAutomaticRecalibrationAt = 0
  private _onObservationBatchCallback: ((batch: MinimapObservationBatch) => void) | null = null
  private _currentCalibration: MinimapCalibration | null = null
  private _targetPid: number | null = null
  private _targetPids = new Set<number>()

  constructor(
    private readonly _context: MinimapObserverMainContext,
    private readonly _calibrationController: MinimapCalibrationController,
    private readonly _observationController: MinimapObservationController,
    private readonly _detectNativeCaptureSupport: () => NativeCaptureSupport = detectNativeCaptureSupport,
    private readonly _inspectNativeCaptureTarget: InspectNativeCaptureTarget = inspectNativeCaptureTarget,
    private readonly _resolveTrustedNativeRuntimeRoot: () => string = resolveTrustedNativeRuntimeRoot
  ) {}

  public init(): void {
    // 监听对局阶段、会话活跃状态、总开关与 Gate A 采集能力门禁，严格控制采集生命周期
    this._gameflowDisposer = this._context.mobxUtils.reaction(
      () => ({
        enabled: this._context.liveCoach.settings.enabled,
        sessionState: this._context.liveCoach.state.session.state,
        coachSessionId: this._context.liveCoach.state.session.id,
        canCapture:
          this._context.liveCoach.state.capability.enabledFeatureIds.includes(
            'coach.capture.screen'
          ),
        phase: this._context.leagueClient.data.gameflow.phase,
        session: this._context.leagueClient.data.gameflow.session,
        patch: this._context.liveCoach.state.session.patch
      }),
      ({ enabled, sessionState, coachSessionId, canCapture, phase, session, patch }) => {
        const mapId = session?.map?.id ?? null
        if (
          enabled &&
          canCapture &&
          (sessionState === 'active' || sessionState === 'shadow') &&
          phase === 'InProgress' &&
          mapId === 11
        ) {
          if (!coachSessionId) {
            this.stopSupervising()
            return
          }
          const effectivePatch = patch || 'unknown'
          this.startSupervising(
            coachSessionId,
            this._calibrationController.getOrCreateCalibration(),
            effectivePatch
          )
        } else {
          this.stopSupervising()
        }
      },
      { fireImmediately: true }
    )
  }

  public dispose(): void {
    this.stopSupervising()
    if (this._gameflowDisposer) {
      this._gameflowDisposer()
      this._gameflowDisposer = null
    }
  }

  public onObservationBatch(cb: (batch: MinimapObservationBatch) => void): void {
    this._onObservationBatchCallback = cb
  }

  public probeCaptureSupport(): {
    supported: boolean
    realtimeSupported: boolean
    platform: NodeJS.Platform
    backends: Array<'wgc' | 'dda' | 'desktopCapturer'>
    nativeBackends: Array<'wgc' | 'dda'>
    fallbackAvailable: boolean
    hdrSupported: boolean
    permissionGranted: boolean | null
  } {
    const platform = process.platform
    if (platform !== 'win32') {
      return {
        supported: false,
        realtimeSupported: false,
        platform,
        backends: [],
        nativeBackends: [],
        fallbackAvailable: false,
        hdrSupported: false,
        permissionGranted: null
      }
    }

    const nativeSupport = this._detectNativeCaptureSupport()
    const nativeBackends: Array<'wgc' | 'dda'> = []
    if (nativeSupport.wgc) nativeBackends.push('wgc')
    if (nativeSupport.dda) nativeBackends.push('dda')

    return {
      supported: true,
      // WGC/DDA remain preferred, but Electron window capture is a real compatibility backend.
      // A missing or temporarily unavailable native addon must not make the whole coach unusable.
      realtimeSupported: true,
      platform,
      backends: [...nativeBackends, 'desktopCapturer'],
      nativeBackends,
      fallbackAvailable: true,
      hdrSupported: nativeSupport.dda,
      // The native facade can report backend support, but it cannot prove that the current game
      // window is capturable. Only an actively running WGC/DDA session confirms permission.
      permissionGranted: null
    }
  }

  public async requestCalibrationPreview(includeImage: boolean): Promise<{
    calibration: MinimapCalibration
    fingerprint: CaptureEnvironmentFingerprint
    imageDataUrl?: string
    sourceSize: { width: number; height: number } | null
    thumbnailSize: { width: number; height: number }
  }> {
    if (!hasCurrentLiveCoachPrivacyConsent(this._context.liveCoach.settings)) {
      throw new AkariIpcError(
        '请先确认当前隐私说明，再读取游戏窗口用于诊断或标定',
        LIVE_COACH_CONSENT_REQUIRED_REASON
      )
    }

    // 标定预览始终使用 Electron 的一次性窗口缩略图；它不能冒充实时 WGC/DDA
    // 后端状态，否则诊断页会在正式采集尚未启动时显示虚假的“WGC 正常”。
    if (process.platform === 'win32') {
      try {
        this._targetPids = new Set((await getPidsByName('League of Legends.exe')) ?? [])
      } catch {
        this._targetPids.clear()
      }
    }
    const source = await this._findGameCaptureSource(1280, 720)
    if (!source?.thumbnail || source.thumbnail.isEmpty()) {
      throw new Error('未找到正在运行的英雄联盟游戏窗口，无法生成小地图标定预览')
    }

    if (
      process.platform === 'win32' &&
      !this._updateTargetWindowFromSource(source) &&
      source.name !== LEAGUE_GAME_WINDOW_TITLE
    ) {
      throw new Error('无法验证英雄联盟游戏窗口所属进程，未应用标定预览')
    }

    const size = source.thumbnail.getSize()
    const calibration = this._calibrationController.applyAutomaticDetection(
      source.thumbnail.toBitmap(),
      size.width,
      size.height
    )
    this.applyCalibration(calibration)

    let imageDataUrl: string | undefined
    if (includeImage) {
      const scale = Math.min(1, 512 / Math.max(size.width, size.height))
      const preview = source.thumbnail.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'good'
      })
      let jpeg = preview.toJPEG(72)
      if (jpeg.byteLength > 512 * 1024) jpeg = preview.toJPEG(45)
      if (jpeg.byteLength > 512 * 1024) {
        throw new Error('标定预览超过 512 KiB 安全上限')
      }
      imageDataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
    }

    const fingerprint = this._calibrationController.getEnvironmentFingerprint()
    const sourceSize =
      fingerprint.width !== null && fingerprint.height !== null
        ? { width: fingerprint.width, height: fingerprint.height }
        : null
    return {
      calibration,
      fingerprint,
      imageDataUrl,
      sourceSize,
      thumbnailSize: size
    }
  }

  public applyCalibration(calibration: MinimapCalibration): void {
    this._context.liveCoach.recordCalibrationAttempt(calibration)
    this._currentCalibration = calibration
    if (this._worker && this._currentSessionId) {
      this._postWorkerStart(this._currentSessionId, calibration)
    }
  }

  private _currentPatch: string = 'unknown'
  private _identityModelDescriptor: { version: string; sha256: string } | null = null
  private _identityModelLoading = false
  private _skipIdentityModelForSession = false

  private _targetHwnd: number | null = null

  private _getEffectiveBackend(
    ignoreNativeCaptureFailure = false
  ): 'auto' | 'wgc' | 'dda' | 'desktopCapturer' {
    if (this._nativeCaptureFailed && !ignoreNativeCaptureFailure) return 'desktopCapturer'
    const configured = this._context.liveCoach.settings.captureBackend
    const support = this._detectNativeCaptureSupport()
    if (configured === 'dda') {
      if (support.dda) return 'dda'
      if (support.wgc) return 'wgc'
    }
    if (configured === 'wgc') {
      if (support.wgc) return 'wgc'
      if (support.dda) return 'dda'
    }
    if (configured === 'auto') {
      if (support.wgc && support.dda) return 'auto'
      if (support.wgc) return 'wgc'
      if (support.dda) return 'dda'
    }

    // 只有 facade 而没有真实 .node，或系统不支持所选后端时，必须走真实可用的 Electron 采集。
    return 'desktopCapturer'
  }

  public async startSupervising(
    sessionId: string,
    calibration: MinimapCalibration,
    patch: string = 'unknown'
  ): Promise<void> {
    if (
      !this._context.liveCoach.state.capability.enabledFeatureIds.includes('coach.capture.screen')
    ) {
      this.stopSupervising()
      return
    }

    const backend = this._getEffectiveBackend()
    this._context.state.setBackend(backend === 'auto' ? 'wgc' : backend)
    calibration = this._calibrationController.getOrCreateCalibration()

    const isSameSession = this._isSupervising && this._currentSessionId === sessionId
    const patchChanged = isSameSession && patch !== this._currentPatch
    if (isSameSession && !patchChanged) {
      if (calibration.id !== this._currentCalibration?.id) {
        this.applyCalibration(calibration)
      }
      return
    }

    // A coach session can begin with a provisional id (for example, `pending-game`) and be
    // promoted once LCU exposes the real game id. A newly resolved patch must also reload the
    // identity-model manifest, which is only sent during worker initialization. Replace the
    // runtime in either case while retaining logical-session metrics such as cumulative drops.
    if (this._isSupervising) {
      this._replaceWorkerRuntime()
    }

    const lifecycleVersion = ++this._lifecycleVersion
    this._currentSessionId = sessionId
    this._currentPatch = patch
    this._isSupervising = true
    this._workerCrashTimestamps = []
    this._workerRestartCount = 0
    this._currentCalibration = calibration
    this._context.liveCoach.state.setCaptureState({
      queueDepth: null,
      workerHeartbeatAt: null,
      workerRestartCount: 0
    })
    let calibrationUsesCurrentTarget = false

    // Resolve the current game process set before reading any window thumbnail. A window and its
    // inspected owner are committed only as one verified pair against this latest snapshot.
    if (process.platform === 'win32') {
      try {
        const pids = await getPidsByName('League of Legends.exe')
        if (!this._isCurrentLifecycle(lifecycleVersion, sessionId)) return
        this._targetPids = new Set(pids ?? [])
      } catch {
        if (!this._isCurrentLifecycle(lifecycleVersion, sessionId)) return
        this._targetPids.clear()
      }
    }

    // Every unconfirmed automatic ROI is measured from the real game window at session start.
    // A fixed left/right preference only chooses the anchor; it must not disable zero-click size
    // calibration on windowed, 4:3, ultrawide, or desktopCapturer-only systems.
    if (calibration.source !== 'manual') {
      try {
        const source = await this._findGameCaptureSource(1280, 720)
        if (!this._isCurrentLifecycle(lifecycleVersion, sessionId)) return
        if (source?.thumbnail && !source.thumbnail.isEmpty()) {
          const targetVerified =
            process.platform !== 'win32' ||
            this._updateTargetWindowFromSource(source) ||
            source.name === LEAGUE_GAME_WINDOW_TITLE
          const size = source.thumbnail.getSize()
          if (targetVerified && size.width >= 320 && size.height >= 240) {
            this._currentCalibration = this._calibrationController.applyAutomaticDetection(
              source.thumbnail.toBitmap(),
              size.width,
              size.height
            )
            calibrationUsesCurrentTarget = true
          }
        }
      } catch (error) {
        this._context.logger.warn(
          formatSanitizedErrorLog('Automatic minimap calibration failed; using fallback ROI', error)
        )
      }
    }

    // 查找英雄联盟游戏客户端进程 PID 与 HWND
    try {
      if (process.platform === 'win32') {
        const gameSource = await this._findGameCaptureSource(1, 1)
        if (!this._isCurrentLifecycle(lifecycleVersion, sessionId)) return
        if (gameSource) {
          const previousHwnd = this._targetHwnd
          const previousPid = this._targetPid
          if (
            this._updateTargetWindowFromSource(gameSource) &&
            (this._targetHwnd !== previousHwnd || this._targetPid !== previousPid)
          ) {
            calibrationUsesCurrentTarget = false
          }
        }
        if (this._refreshTargetEnvironment()) calibrationUsesCurrentTarget = false
      }
    } catch {
      // 忽略未找到进程错误
    }

    if (!this._isCurrentLifecycle(lifecycleVersion, sessionId)) return

    // Resolving the actual target can change the display/DPI/window-size binding. Re-select the
    // calibration after that resolution so a persisted primary-display calibration cannot leak
    // into a game window on another monitor.
    if (!calibrationUsesCurrentTarget) {
      const targetCalibration = this._calibrationController.getOrCreateCalibration()
      if (targetCalibration.id !== this._currentCalibration?.id) {
        this._currentCalibration = targetCalibration
      }
    }
    const effectiveCalibration =
      this._currentCalibration ?? this._calibrationController.getOrCreateCalibration()

    this._context.logger.info(
      `Starting MinimapObserver capture supervisor, backend: ${backend}, targetPid: ${this._targetPid}, targetHwnd: ${this._targetHwnd}`
    )
    this._context.state.setIsCapturing(true)
    this._context.state.setFps(
      backend === 'desktopCapturer' ? COMPATIBILITY_CAPTURE_FPS : NATIVE_CAPTURE_FPS
    )

    try {
      const workerCalibration = this._currentCalibration ?? effectiveCalibration
      this._spawnWorker(sessionId, workerCalibration)
    } catch (error) {
      const warningMessage = formatSanitizedErrorLog(
        'Failed to spawn utility worker; falling back to degraded status',
        error
      )
      this._context.logger.warn(warningMessage)
      this._startInternalPipeline(
        sessionId,
        effectiveCalibration.roi,
        'internal-error',
        sanitizeCaughtErrorDetails(error) ?? 'Utility worker failed to start'
      )
    }
  }

  public stopSupervising(): void {
    if (!this._isSupervising) {
      return
    }

    const stoppedSessionId = this._currentSessionId
    this._lifecycleVersion++
    this._isSupervising = false
    this._currentSessionId = ''
    this._currentCalibration = null
    this._targetPid = null
    this._targetPids.clear()
    this._targetHwnd = null
    this._calibrationController.setTargetEnvironment?.(null)
    this._dropCountBase = 0
    this._context.state.reset()
    this._context.liveCoach.state.setCaptureState({
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
    this._stopWorkerRuntime(stoppedSessionId)

    this._context.logger.info('Stopped MinimapObserver capture supervisor')
  }

  private _replaceWorkerRuntime(): void {
    const stoppedSessionId = this._currentSessionId
    this._lifecycleVersion++
    this._isSupervising = false
    this._currentSessionId = ''
    this._currentCalibration = null
    this._targetPid = null
    this._targetPids.clear()
    this._targetHwnd = null
    this._calibrationController.setTargetEnvironment?.(null)
    this._stopWorkerRuntime(stoppedSessionId)
  }

  private _stopWorkerRuntime(stoppedSessionId: string): void {
    this._captureInFlight = false
    this._nativeCaptureFailed = false
    this._nativeCaptureAttemptActive = false
    this._clearNativeCaptureRetry(true)
    this._clearNativeCaptureProbe()
    this._lastCaptureResolution = null
    this._recalibrationInFlight = false
    this._automaticRecalibrationAttempt = 0
    this._nextAutomaticRecalibrationAt = 0
    this._context.liveCoach.setIdentityModelLoaded(false)
    this._identityModelDescriptor = null
    this._identityModelLoading = false
    this._skipIdentityModelForSession = false

    if (this._captureTimer) {
      clearInterval(this._captureTimer)
      this._captureTimer = null
    }

    if (this._simulationTimer) {
      clearInterval(this._simulationTimer)
      this._simulationTimer = null
    }

    this._stopHeartbeatMonitor()
    this._stopWorkerInitializationTimeout()

    if (this._worker) {
      const worker = this._worker
      // Detach first so a synchronous/late exit event from this lifecycle cannot affect the next
      // worker assigned during a session-id promotion.
      this._worker = null
      this._workerReady = false
      try {
        worker.postMessage({
          type: 'stop',
          sessionId: stoppedSessionId,
          reason: 'capture-stopped'
        })
      } catch {
        // ignore
      }
      try {
        worker.kill()
      } catch {
        // ignore
      }
    }
  }

  private _spawnWorker(sessionId: string, calibration: MinimapCalibration): void {
    this._dropCountBase = Math.max(0, Number(this._context.liveCoach.state.capture.dropCount) || 0)
    const candidatePaths = [
      path.join(__dirname, 'minimap-observer-worker.js'),
      path.join(__dirname, '../utility-processes/minimap-observer/index.js'),
      path.join(app.getAppPath(), 'out/main/minimap-observer-worker.js')
    ]

    const workerPath = candidatePaths.find((p) => fs.existsSync(p))

    if (!workerPath) {
      this._context.logger.info(
        'Worker bundle not found on disk, running internal observation pipeline'
      )
      this._startInternalPipeline(
        sessionId,
        calibration.roi,
        'internal-error',
        'Minimap observer worker bundle is missing'
      )
      return
    }

    const child = utilityProcess.fork(workerPath, [], {
      serviceName: 'LeagueAkari Minimap Observer'
    })

    this._worker = child
    this._workerReady = false

    child.on('message', (rawMsg: unknown) => {
      if (this._worker !== child) return
      const parsed = workerToMainMessageSchema.safeParse(rawMsg)
      if (parsed.success) {
        this._handleWorkerMessage(parsed.data as WorkerToMainMessage)
      }
    })

    child.on('exit', (code) => {
      this._handleWorkerExit(child, code, sessionId, calibration)
    })

    this._initializeWorker(child)
  }

  private _handleWorkerExit(
    child: UtilityProcess,
    code: number,
    sessionId: string,
    calibration: MinimapCalibration
  ): void {
    // 被 stop() 杀掉的旧进程可能晚于新会话退出；它无权清空或重启新 Worker。
    if (this._worker !== child) return
    this._context.logger.warn(`Minimap worker exited with code ${code}`)
    this._worker = null
    this._workerReady = false
    this._clearNativeCaptureRetry(false)
    this._clearNativeCaptureProbe()
    this._stopHeartbeatMonitor()
    this._stopWorkerInitializationTimeout()
    if (this._identityModelLoading) {
      this._identityModelLoading = false
      this._skipIdentityModelForSession = true
      this._context.logger.warn(
        'Optional identity model stalled with the worker; restarting without identity analysis'
      )
    }
    this._context.liveCoach.setIdentityModelLoaded(false)
    const now = Date.now()
    this._workerCrashTimestamps = this._workerCrashTimestamps
      .filter((timestamp) => now - timestamp < this._crashWindowMs)
      .concat(now)

    if (!this._isSupervising) return
    if (this._workerCrashTimestamps.length >= this._maxCrashLimit) {
      this._context.logger.error('Worker exceeded crash limit, stopping capture for this game')
      this._startInternalPipeline(
        sessionId,
        calibration.roi,
        'capture-crash-loop',
        `Minimap worker crashed ${this._workerCrashTimestamps.length} times within 10 minutes`
      )
      return
    }

    this._workerRestartCount++
    this._context.liveCoach.state.setCaptureState({
      queueDepth: null,
      workerHeartbeatAt: null,
      workerRestartCount: this._workerRestartCount
    })
    this._spawnWorker(sessionId, this._currentCalibration ?? calibration)
    if (this._nativeCaptureFailed) {
      this._scheduleNativeCaptureRetry()
    }
  }

  private _resolveIdentityModel(patch: string) {
    return resolveChampionIdentityModelFromRoots(
      patch,
      createChampionIdentityModelRoots(app.getAppPath(), process.resourcesPath)
    )
  }

  private _initializeWorker(child: UtilityProcess): void {
    const identityModel = this._resolveIdentityModel(this._currentPatch)
    if (!identityModel) {
      this._context.logger.warn(
        `No verified champion identity model is registered for patch ${this._currentPatch}`
      )
    }
    this._identityModelDescriptor = identityModel
      ? { version: identityModel.version, sha256: identityModel.sha256 }
      : null
    const workerIdentityModel = this._skipIdentityModelForSession ? null : identityModel
    this._identityModelLoading = Boolean(workerIdentityModel)
    this._context.liveCoach.setIdentityModelLoaded(false)
    let nativeRuntimeRoot: string | undefined
    if (process.platform === 'win32') {
      try {
        nativeRuntimeRoot = this._resolveTrustedNativeRuntimeRoot()
      } catch {
        this._context.logger.warn('Trusted native runtime root is unavailable for capture worker')
      }
    }
    child.postMessage({
      type: 'initialize',
      protocolVersion: '1.0.0',
      runtimePaths: nativeRuntimeRoot ? { nativeRuntimeRoot } : {},
      modelManifest: workerIdentityModel ? { 'champion-icon-onnx': workerIdentityModel } : {}
    })
    this._startWorkerInitializationTimeout(child)
  }

  private _postWorkerStart(
    sessionId: string,
    calibration: MinimapCalibration,
    backend = this._getEffectiveBackend()
  ): void {
    if (!this._worker || !this._workerReady) return
    // The worker resets its raw frameDropCount for every start message (including calibration
    // refreshes). Carry the published logical total forward before triggering that reset.
    this._dropCountBase = Math.max(
      this._dropCountBase,
      Number(this._context.liveCoach.state.capture.dropCount) || 0
    )
    const fingerprint = this._calibrationController.getEnvironmentFingerprint()
    const sourceWidth = fingerprint.width ?? 1
    const sourceHeight = fingerprint.height ?? 1
    const championRoster = this._getChampionRoster()
    const fps = backend === 'desktopCapturer' ? COMPATIBILITY_CAPTURE_FPS : NATIVE_CAPTURE_FPS
    this._worker.postMessage({
      type: 'start',
      sessionId,
      patch: this._currentPatch,
      targetHwnd: this._targetHwnd,
      targetPid: this._targetPid,
      backend,
      detectors: ['enemy-champions', 'neutral-objectives'],
      championCandidates: championRoster.all,
      allyChampionCandidates: championRoster.ally,
      enemyChampionCandidates: championRoster.enemy,
      selfChampionId: championRoster.selfChampionId,
      captureConfig: {
        fps,
        normalizedRoi: calibration.roi,
        roi: {
          x: Math.round(calibration.roi.x * sourceWidth),
          y: Math.round(calibration.roi.y * sourceHeight),
          width: Math.max(1, Math.round(calibration.roi.width * sourceWidth)),
          height: Math.max(1, Math.round(calibration.roi.height * sourceHeight))
        }
      }
    })
    if (backend === 'desktopCapturer') {
      this._nativeCaptureAttemptActive = false
      this._clearNativeCaptureProbe()
      if (!this._captureTimer) this._startCaptureLoop()
    } else {
      this._nativeCaptureAttemptActive = true
      this._startNativeCaptureProbe(this._worker)
    }
  }

  private _startNativeCaptureProbe(worker: UtilityProcess): void {
    this._clearNativeCaptureProbe()
    const lifecycleVersion = this._lifecycleVersion
    const sessionId = this._currentSessionId
    const timer = setTimeout(() => {
      if (
        this._nativeCaptureProbeTimer !== timer ||
        !this._isCurrentLifecycle(lifecycleVersion, sessionId) ||
        this._worker !== worker
      ) {
        return
      }
      this._nativeCaptureProbeTimer = null
      this._context.logger.warn('Native capture produced no fresh frame; using compatibility mode')
      this._activateCompatibilityCapture('原生采集暂时没有画面，已自动切换兼容模式')
    }, NATIVE_CAPTURE_PROBE_TIMEOUT_MS)
    this._nativeCaptureProbeTimer = timer
    timer.unref?.()
  }

  private _clearNativeCaptureProbe(): void {
    if (!this._nativeCaptureProbeTimer) return
    clearTimeout(this._nativeCaptureProbeTimer)
    this._nativeCaptureProbeTimer = null
  }

  private _activateCompatibilityCapture(details?: string): void {
    if (!this._isSupervising || !this._worker || !this._currentSessionId) return
    const compatibilityAlreadyRunning = this._nativeCaptureFailed && Boolean(this._captureTimer)
    const shouldResetWorkerToCompatibility =
      this._nativeCaptureAttemptActive || !compatibilityAlreadyRunning
    if (!this._nativeCaptureFailed) {
      this._context.logger.warn('Native capture unavailable; activating compatibility mode')
    }
    this._nativeCaptureFailed = true
    this._nativeCaptureAttemptActive = false
    this._clearNativeCaptureProbe()
    this._context.state.setBackend('desktopCapturer')
    this._context.state.setRoiHealth('unknown')
    this._context.liveCoach.state.setCaptureState({
      backend: 'desktopCapturer',
      roiState: 'unknown'
    })
    this._context.liveCoach.refreshRuntimeCapabilities({
      roiHealth: 'unknown',
      state: 'running',
      liveDataHealth: this._context.liveCoach.state.liveData.state,
      backend: 'desktopCapturer'
    })
    if (!this._currentCalibration) {
      this._currentCalibration = this._calibrationController.getOrCreateCalibration()
    }
    if (shouldResetWorkerToCompatibility) {
      this._postWorkerStart(this._currentSessionId, this._currentCalibration, 'desktopCapturer')
    }
    if (details) {
      this._setPublicError({
        code: 'capture-stalled',
        stage: 'minimap-capture',
        recoverable: true,
        details
      })
    }
    this._scheduleNativeCaptureRetry()
  }

  private async _findGameCaptureSource(thumbnailWidth: number, thumbnailHeight: number) {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight }
    })
    return selectLeagueGameCaptureSource(
      sources,
      this._targetPids,
      this._inspectNativeCaptureTarget
    )
  }

  private _clearNativeCaptureRetry(resetBudget: boolean): void {
    this._nativeCaptureRetryGeneration++
    if (this._nativeCaptureRetryTimer) {
      clearTimeout(this._nativeCaptureRetryTimer)
      this._nativeCaptureRetryTimer = null
    }
    this._nativeCaptureRetryInFlight = false
    if (resetBudget) this._nativeCaptureRetryCount = 0
  }

  private _scheduleNativeCaptureRetry(): void {
    if (
      this._nativeCaptureRetryTimer ||
      this._nativeCaptureRetryInFlight ||
      !this._isSupervising ||
      !this._worker ||
      !this._currentSessionId
    ) {
      return
    }

    const retryIndex = Math.min(
      this._nativeCaptureRetryCount,
      NATIVE_CAPTURE_RETRY_DELAYS_MS.length - 1
    )
    const lifecycleVersion = this._lifecycleVersion
    const sessionId = this._currentSessionId
    const worker = this._worker
    const retryGeneration = this._nativeCaptureRetryGeneration
    const timer = setTimeout(() => {
      if (this._nativeCaptureRetryTimer !== timer) return
      this._nativeCaptureRetryTimer = null
      if (
        this._nativeCaptureRetryGeneration !== retryGeneration ||
        !this._isCurrentLifecycle(lifecycleVersion, sessionId) ||
        this._worker !== worker
      ) {
        return
      }
      this._nativeCaptureRetryCount++
      this._nativeCaptureRetryInFlight = true
      void this._retryNativeCapture(lifecycleVersion, sessionId, worker, retryGeneration)
    }, NATIVE_CAPTURE_RETRY_DELAYS_MS[retryIndex])
    this._nativeCaptureRetryTimer = timer
    timer.unref?.()
  }

  private async _retryNativeCapture(
    lifecycleVersion: number,
    sessionId: string,
    worker: UtilityProcess,
    retryGeneration: number
  ): Promise<void> {
    let retryAgain = false
    try {
      const pids = await getPidsByName('League of Legends.exe')
      if (
        this._nativeCaptureRetryGeneration !== retryGeneration ||
        !this._isCurrentLifecycle(lifecycleVersion, sessionId) ||
        this._worker !== worker
      ) {
        return
      }

      this._targetPids = new Set(pids ?? [])
      if (this._targetPids.size === 0) {
        retryAgain = true
        return
      }

      const gameSource = await this._findGameCaptureSource(1, 1)
      if (
        this._nativeCaptureRetryGeneration !== retryGeneration ||
        !this._isCurrentLifecycle(lifecycleVersion, sessionId) ||
        this._worker !== worker
      ) {
        return
      }
      if (!gameSource || !this._updateTargetWindowFromSource(gameSource)) {
        retryAgain = true
        return
      }

      const calibration = this._currentCalibration
      if (!calibration) {
        retryAgain = true
        return
      }

      const backend = this._getEffectiveBackend(true)
      if (backend === 'desktopCapturer') {
        retryAgain = true
        return
      }
      this._postWorkerStart(sessionId, calibration, backend)
    } catch {
      retryAgain = true
    } finally {
      if (
        this._nativeCaptureRetryGeneration === retryGeneration &&
        this._isCurrentLifecycle(lifecycleVersion, sessionId) &&
        this._worker === worker
      ) {
        this._nativeCaptureRetryInFlight = false
        if (retryAgain) {
          this._scheduleNativeCaptureRetry()
        }
      }
    }
  }

  private _markNativeCaptureRecovered(): void {
    this._nativeCaptureFailed = false
    this._nativeCaptureAttemptActive = false
    this._clearNativeCaptureProbe()
    this._clearNativeCaptureRetry(true)
    if (this._captureTimer) {
      clearInterval(this._captureTimer)
      this._captureTimer = null
    }
  }

  private _updateTargetWindowFromSource(source: DesktopCapturerSource): boolean {
    const hwnd = parseDesktopCapturerWindowHandle(source.id)
    if (hwnd === null || this._targetPids.size === 0) return false

    // Resolve first, then commit HWND, PID, and environment together. A transient null inspection
    // or a stale/mismatched owner must leave the previous verified target completely untouched.
    const environment = this._inspectNativeCaptureTarget({ targetHwnd: hwnd })
    if (!environment || !this._targetPids.has(environment.targetPid)) return false

    this._targetHwnd = hwnd
    this._targetPid = environment.targetPid
    this._calibrationController.setTargetEnvironment?.(environment)
    return true
  }

  private _refreshTargetEnvironment(): boolean {
    if (!this._targetHwnd && !this._targetPid) return false
    const environment = this._inspectNativeCaptureTarget({
      targetHwnd: this._targetHwnd,
      targetPid: this._targetPid
    })
    if (
      !environment ||
      this._targetPids.size === 0 ||
      !this._targetPids.has(environment.targetPid)
    ) {
      return false
    }
    this._targetPid = environment.targetPid
    return this._calibrationController.setTargetEnvironment?.(environment) ?? false
  }

  private _getChampionRoster(): {
    all: number[]
    ally: number[]
    enemy: number[]
    selfChampionId: number | null
  } {
    const session = this._context.leagueClient.data.gameflow.session
    const myTeam = session?.gameData?.teamOne || []
    const theirTeam = session?.gameData?.teamTwo || []
    const currentSummoner = this._context.leagueClient.data.summoner?.me
    const isSelf = (player: (typeof myTeam)[number]) =>
      Boolean(
        (currentSummoner?.puuid && player.puuid === currentSummoner.puuid) ||
        (currentSummoner?.summonerId && player.summonerId === currentSummoner.summonerId)
      )
    const selfInTeamOne = myTeam.find(isSelf)
    const selfInTeamTwo = theirTeam.find(isSelf)
    const toIds = (players: typeof myTeam) =>
      players
        .map((player) => Number(player?.championId))
        .filter((championId) => Number.isInteger(championId) && championId > 0)
    const all = Array.from(new Set([...toIds(myTeam), ...toIds(theirTeam)]))
    if (!selfInTeamOne && !selfInTeamTwo) {
      return { all, ally: [], enemy: [], selfChampionId: null }
    }
    const allyTeam = selfInTeamTwo ? theirTeam : myTeam
    const enemyTeam = selfInTeamTwo ? myTeam : theirTeam
    const ally = toIds(allyTeam)
    const enemy = toIds(enemyTeam)
    const selfChampionId = Number(selfInTeamOne?.championId ?? selfInTeamTwo?.championId) || null
    return {
      all,
      ally: Array.from(new Set(ally)),
      enemy: Array.from(new Set(enemy)),
      selfChampionId
    }
  }

  private _captureSequence = 0

  private _startCaptureLoop(): void {
    if (this._captureTimer) {
      clearInterval(this._captureTimer)
    }

    // Compatibility capture intentionally runs at a lower rate and bounded thumbnail size so
    // low-end machines and 4K desktops remain usable while native WGC/DDA is unavailable.
    const intervalMs = Math.floor(1000 / COMPATIBILITY_CAPTURE_FPS)
    this._captureTimer = setInterval(async () => {
      if (
        this._captureInFlight ||
        !this._isSupervising ||
        !this._worker ||
        !this._currentCalibration
      ) {
        return
      }

      const lifecycleVersion = this._lifecycleVersion
      const sessionId = this._currentSessionId
      const worker = this._worker
      const calibration = this._currentCalibration
      this._captureInFlight = true
      try {
        // 精准匹配英雄联盟游戏客户端窗口，严禁回退到随机桌面或无关窗口
        const gameSource = await this._findGameCaptureSource(
          COMPATIBILITY_CAPTURE_SIZE.width,
          COMPATIBILITY_CAPTURE_SIZE.height
        )
        if (!this._isCurrentLifecycle(lifecycleVersion, sessionId) || this._worker !== worker) {
          return
        }

        if (gameSource && gameSource.thumbnail) {
          const size = gameSource.thumbnail.getSize()
          if (size.width > 100 && size.height > 100) {
            const cal = calibration
            const pixelRoi = {
              x: Math.max(0, Math.round(cal.roi.x * size.width)),
              y: Math.max(0, Math.round(cal.roi.y * size.height)),
              width: Math.min(
                size.width - Math.max(0, Math.round(cal.roi.x * size.width)),
                Math.round(cal.roi.width * size.width)
              ),
              height: Math.min(
                size.height - Math.max(0, Math.round(cal.roi.y * size.height)),
                Math.round(cal.roi.height * size.height)
              )
            }

            if (pixelRoi.width > 20 && pixelRoi.height > 20) {
              const minimapCrop = gameSource.thumbnail.crop(pixelRoi)
              const rawBitmap = minimapCrop.toBitmap()
              const fingerprint = this._calibrationController.getEnvironmentFingerprint()
              this._captureSequence++

              worker.postMessage({
                type: 'frame-buffer',
                buffer: rawBitmap,
                pixelFormat: process.platform === 'win32' ? 'bgra' : 'rgba',
                width: pixelRoi.width,
                height: pixelRoi.height,
                sourceWidth: fingerprint.width ?? undefined,
                sourceHeight: fingerprint.height ?? undefined,
                observedAt: Date.now(),
                sequence: this._captureSequence
              })
            }
          }
        }
      } catch {
        // 捕获异常保持稳定运行
      } finally {
        // 旧会话的异步截图结束时不能清掉新会话正在进行的背压标记。
        if (this._lifecycleVersion === lifecycleVersion) {
          this._captureInFlight = false
        }
      }
    }, intervalMs)
  }

  private _handleWorkerMessage(msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case 'heartbeat':
        this._lastWorkerHeartbeatAt = Date.now()
        this._context.liveCoach.state.setCaptureState({
          queueDepth: Math.max(0, Math.trunc(msg.queueDepth)),
          workerHeartbeatAt: this._lastWorkerHeartbeatAt
        })
        break
      case 'ready':
        {
          const wasReady = this._workerReady
          this._workerReady = true
          if (!wasReady) {
            this._stopWorkerInitializationTimeout()
            if (this._worker) this._startHeartbeatMonitor(this._worker)
            if (this._isSupervising && this._currentSessionId && this._currentCalibration) {
              this._postWorkerStart(this._currentSessionId, this._currentCalibration)
            }
          }
          const identityReady = Boolean(msg.runtimeVersions['champion-icon-onnx'])
          if (identityReady || !this._identityModelDescriptor) {
            this._identityModelLoading = false
          }
          this._context.liveCoach.setIdentityModelLoaded(
            identityReady,
            this._identityModelDescriptor
          )
          if (
            identityReady &&
            this._context.liveCoach.state.lastError?.stage === 'minimap-identity-model'
          ) {
            this._context.liveCoach.state.setLastError(null)
          }
        }
        break
      case 'status': {
        if ((msg.backend === 'wgc' || msg.backend === 'dda') && msg.fps > 0) {
          this._markNativeCaptureRecovered()
        }
        // Calibration fingerprints use the effective backend. Publish it before selecting a
        // replacement for a moved target so the new calibration is not bound to the old backend.
        this._context.state.setBackend(msg.backend)
        const targetEnvironmentChanged = this._refreshTargetEnvironment()
        {
          const sourceResolution = msg.sourceResolution ?? null
          const sourceResolutionChanged = Boolean(
            sourceResolution &&
            this._lastCaptureResolution &&
            (this._lastCaptureResolution.width !== sourceResolution.width ||
              this._lastCaptureResolution.height !== sourceResolution.height)
          )
          if (targetEnvironmentChanged) {
            // setTargetEnvironment invalidates the old active calibration. Re-select against the
            // new display/DPI/window fingerprint even when the old ROI was manual, then restart the
            // worker so DDA/WGC cannot remain bound to the previous monitor or capture item.
            this._currentCalibration = this._calibrationController.getOrCreateCalibration()
            this._context.state.setRoiHealth('unknown')
            this._context.liveCoach.state.setCaptureState({
              roiState: 'unknown',
              confidence: null
            })
            if (this._currentSessionId) {
              this._postWorkerStart(this._currentSessionId, this._currentCalibration)
            }
          }
          const hasManualCalibration = this._currentCalibration?.source === 'manual'
          if (
            !hasManualCalibration &&
            (targetEnvironmentChanged ||
              sourceResolutionChanged ||
              (this._isSupervising && this._currentCalibration === null)) &&
            !this._recalibrationInFlight
          ) {
            this._recalibrationInFlight = true
            void this._refreshCalibrationFromGameWindow(
              this._lifecycleVersion,
              this._currentSessionId
            ).finally(() => {
              this._recalibrationInFlight = false
            })
          }
          this._lastCaptureResolution = sourceResolution ? { ...sourceResolution } : null
        }
        const calibrationReady = this._isCurrentCalibrationReady()
        const publishedRoiHealth =
          targetEnvironmentChanged ||
          (this._isSupervising && !this._currentCalibration) ||
          (!calibrationReady && msg.roiHealth === 'healthy')
            ? 'unknown'
            : msg.roiHealth
        this._context.state.setFps(msg.fps)
        this._context.state.setRoiHealth(publishedRoiHealth)
        this._context.liveCoach.state.setCaptureState({
          state: 'running',
          backend: msg.backend,
          fps: msg.fps,
          roiState: publishedRoiHealth,
          // Worker resolution is the cropped ROI. Only the separately measured full capture
          // source may populate the public game-resolution field.
          resolution: msg.sourceResolution ? { ...msg.sourceResolution } : null
        })
        this._context.liveCoach.refreshRuntimeCapabilities({
          roiHealth: publishedRoiHealth,
          state: 'running',
          liveDataHealth: this._context.liveCoach.state.liveData.state,
          backend: msg.backend
        })
        if (publishedRoiHealth === 'healthy') {
          this._automaticRecalibrationAttempt = 0
          this._nextAutomaticRecalibrationAt = 0
          if (msg.backend === 'desktopCapturer' && !this._nativeCaptureAttemptActive) {
            // A healthy compatibility stream is preferable to periodically resetting tracking
            // just to probe an optional native acceleration path.
            this._clearNativeCaptureRetry(false)
          }
          const lastError = this._context.liveCoach.state.lastError
          if (
            lastError?.stage === 'minimap-capture' ||
            lastError?.stage === 'minimap-calibration'
          ) {
            this._context.liveCoach.state.setLastError(null)
          }
        } else if (publishedRoiHealth === 'degraded' || publishedRoiHealth === 'occluded') {
          this._setPublicError({
            code: 'roi-occluded',
            stage: 'minimap-calibration',
            recoverable: true,
            details: '小地图区域被遮挡、冻结或标定置信度不足，相关提醒已暂停'
          })
          this._tryAutomaticRecalibration()
        } else if (!calibrationReady && publishedRoiHealth === 'unknown') {
          // A textured but unconfirmed template must not become healthy merely because CCL ran.
          // Keep sampling bounded one-shot previews until a real square boundary is established.
          this._tryAutomaticRecalibration()
        }
        break
      }
      case 'observation-batch':
        // A missing or unconfirmed automatic template cannot publish facts. The worker may see
        // texture in a fallback corner and call it healthy even though no square minimap boundary
        // was established, so apply the same readiness gate used by status publication.
        if (!this._isCurrentCalibrationReady()) {
          this._context.state.setRoiHealth('unknown')
          this._context.liveCoach.state.setCaptureState({
            roiState: 'unknown',
            confidence: null
          })
          this._tryAutomaticRecalibration()
          return
        }
        this._context.state.setFrameAgeMs(msg.batch.frame.ageMs)
        this._context.state.setRoiHealth(msg.batch.health)
        const confirmedEntities = msg.batch.entities.filter(
          (entity) => entity.lifecycle === 'confirmed'
        )
        const confidence = confirmedEntities.length
          ? confirmedEntities.reduce((sum, entity) => sum + entity.confidence, 0) /
            confirmedEntities.length
          : null
        this._context.liveCoach.state.setCaptureState({
          state: 'running',
          frameAgeMs: msg.batch.frame.ageMs,
          roiState: msg.batch.health,
          confidence,
          lastObservationAt: msg.batch.frame.observedAt,
          modelVersions: { ...msg.batch.modelVersions }
        })
        if (this._onObservationBatchCallback) {
          this._onObservationBatchCallback(msg.batch)
        }
        this._observationController.handleObservationBatch(msg.batch)
        break
      case 'metrics':
        // frameAgeMs is owned by the main-process observation freshness gate. The worker metric
        // was measured before IPC transit/inference completed and must not overwrite that value.
        this._context.liveCoach.state.setCaptureState({
          captureLatencyMs: msg.captureLatencyMs,
          inferenceLatencyMs: msg.inferenceLatencyMs,
          dropCount: Math.max(
            this._context.liveCoach.state.capture.dropCount,
            this._dropCountBase + Math.max(0, msg.dropCount)
          )
        })
        break
      case 'error':
        {
          const publicError = createWorkerPublicError(msg)
          this._context.logger.warn(
            `Worker reported ${publicError.code} at ${publicError.stage}; recoverable=${publicError.recoverable}`
          )
          this._setPublicError(publicError)
        }
        if (msg.code === 'LC_ERR_IDENTITY_MODEL_LOAD_FAILED') {
          this._identityModelLoading = false
          this._context.liveCoach.setIdentityModelLoaded(false)
        } else {
          this._context.state.setRoiHealth('degraded')
          this._context.liveCoach.state.setCaptureState({ roiState: 'degraded' })
        }
        if (
          msg.code === 'LC_ERR_NATIVE_CAPTURE_UNAVAILABLE' ||
          msg.code === 'LC_ERR_NATIVE_CAPTURE_FAILED'
        ) {
          this._activateCompatibilityCapture()
        }
        break
    }
  }

  private _startHeartbeatMonitor(child: UtilityProcess): void {
    this._stopHeartbeatMonitor()
    this._lastWorkerHeartbeatAt = Date.now()
    this._context.liveCoach.state.setCaptureState({
      queueDepth: null,
      workerHeartbeatAt: null
    })
    this._heartbeatTimer = setInterval(() => {
      if (this._worker !== child) {
        this._stopHeartbeatMonitor()
        return
      }
      const now = Date.now()
      if (now - this._lastWorkerHeartbeatAt >= 3000) {
        this._context.logger.warn('Minimap worker heartbeat timed out; restarting worker')
        this._stopHeartbeatMonitor()
        child.kill()
        return
      }
      child.postMessage({
        type: 'ping',
        requestId: `heartbeat-${++this._heartbeatSequence}`,
        sentAt: now
      })
    }, 1000)
    this._heartbeatTimer.unref?.()
  }

  private _startWorkerInitializationTimeout(child: UtilityProcess): void {
    this._stopWorkerInitializationTimeout()
    const timer = setTimeout(() => {
      if (this._worker !== child || this._workerInitializationTimer !== timer) return
      this._workerInitializationTimer = null
      this._context.logger.warn('Minimap worker initialization timed out; restarting worker')
      child.kill()
    }, WORKER_INITIALIZATION_TIMEOUT_MS)
    this._workerInitializationTimer = timer
    timer.unref?.()
  }

  private _stopWorkerInitializationTimeout(): void {
    if (!this._workerInitializationTimer) return
    clearTimeout(this._workerInitializationTimer)
    this._workerInitializationTimer = null
  }

  private _stopHeartbeatMonitor(): void {
    if (!this._heartbeatTimer) return
    clearInterval(this._heartbeatTimer)
    this._heartbeatTimer = null
  }

  private _setPublicError(error: Omit<CoachPublicError, 'occurredAt'> | CoachPublicError): void {
    const sanitizedError = createSanitizedPublicError(
      error,
      'occurredAt' in error ? error.occurredAt : undefined
    )
    const current = this._context.liveCoach.state.lastError
    if (
      current?.code === sanitizedError.code &&
      current.stage === sanitizedError.stage &&
      current.recoverable === sanitizedError.recoverable &&
      current.details === sanitizedError.details
    ) {
      return
    }
    this._context.liveCoach.state.setLastError(sanitizedError)
  }

  private _isCurrentCalibrationReady(): boolean {
    return (
      !this._isSupervising ||
      this._currentCalibration?.source === 'manual' ||
      (this._currentCalibration?.confidence ?? 0) >= 0.65
    )
  }

  private _tryAutomaticRecalibration(): void {
    if (
      !this._isSupervising ||
      this._currentCalibration?.source === 'manual' ||
      this._recalibrationInFlight ||
      Date.now() < this._nextAutomaticRecalibrationAt
    ) {
      return
    }

    const delayIndex = Math.min(
      this._automaticRecalibrationAttempt,
      AUTOMATIC_RECALIBRATION_DELAYS_MS.length - 1
    )
    this._automaticRecalibrationAttempt++
    this._nextAutomaticRecalibrationAt = Date.now() + AUTOMATIC_RECALIBRATION_DELAYS_MS[delayIndex]
    this._recalibrationInFlight = true
    void this._refreshCalibrationFromGameWindow(
      this._lifecycleVersion,
      this._currentSessionId
    ).finally(() => {
      this._recalibrationInFlight = false
    })
  }

  private async _refreshCalibrationFromGameWindow(
    lifecycleVersion: number,
    sessionId: string
  ): Promise<void> {
    try {
      const source = await this._findGameCaptureSource(1280, 720)
      if (!this._isCurrentLifecycle(lifecycleVersion, sessionId)) return
      if (!source?.thumbnail || source.thumbnail.isEmpty()) return
      if (
        process.platform === 'win32' &&
        !this._updateTargetWindowFromSource(source) &&
        source.name !== LEAGUE_GAME_WINDOW_TITLE
      ) {
        return
      }
      const size = source.thumbnail.getSize()
      const calibration = this._calibrationController.applyAutomaticDetection(
        source.thumbnail.toBitmap(),
        size.width,
        size.height
      )
      this.applyCalibration(calibration)
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Runtime minimap recalibration failed', error)
      )
    }
  }

  private _isCurrentLifecycle(lifecycleVersion: number, sessionId: string): boolean {
    return (
      this._isSupervising &&
      this._lifecycleVersion === lifecycleVersion &&
      this._currentSessionId === sessionId
    )
  }

  /**
   * 内部回退循环：无真实 Worker 或画面时必须标记为 unknown/degraded，绝不伪造 healthy
   */
  private _startInternalPipeline(
    sessionId: string,
    _roi: { x: number; y: number; width: number; height: number },
    errorCode: 'capture-crash-loop' | 'internal-error' = 'internal-error',
    errorDetails = 'Minimap capture worker is unavailable'
  ): void {
    if (this._simulationTimer) {
      clearInterval(this._simulationTimer)
    }
    if (this._captureTimer) {
      clearInterval(this._captureTimer)
      this._captureTimer = null
    }

    this._context.state.setIsCapturing(false)
    this._context.state.setBackend('unavailable')
    this._context.state.setFps(0)
    this._context.state.setRoiHealth('unknown')
    this._context.liveCoach.setIdentityModelLoaded(false)
    this._context.liveCoach.state.setCaptureState({
      state: errorCode,
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
      dropCount: this._dropCountBase,
      queueDepth: null,
      workerHeartbeatAt: null,
      workerRestartCount: this._workerRestartCount
    })
    this._setPublicError({
      code: errorCode,
      stage: 'minimap-capture',
      recoverable: errorCode !== 'capture-crash-loop',
      details: errorDetails
    })

    let sequence = 0
    this._simulationTimer = setInterval(() => {
      if (!this._isSupervising) return

      sequence++
      const now = Date.now()

      // 无传感器数据时，报告 health: 'unknown'，entities: []
      const batch: MinimapObservationBatch = {
        sessionId,
        patch: this._currentPatch || 'unknown',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: {
          observedAt: now,
          receivedAt: now,
          sequence,
          ageMs: 0
        },
        health: 'unknown',
        entities: [],
        events: []
      }

      this._observationController.handleObservationBatch(batch)
    }, 1000)
  }
}
