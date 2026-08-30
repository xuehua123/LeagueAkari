import {
  MainToWorkerMessage,
  MinimapEntityObservation,
  MinimapObservationBatch,
  WorkerToMainMessage,
  mainToWorkerMessageSchema
} from '../../../shared/types/live-coach'
import { loadTrustedNativeRuntime } from '../../native/trusted-native-runtime'
import { ChampionOnnxClassifier } from './champion-onnx-classifier'
import { TrackedEntity, deriveMinimapEvents, processMinimapFrameWithState } from './minimap-cv'
import { ReplayFrameQueue } from './replay-frame-queue'

/**
 * Minimap Observer Utility Process Worker
 * 独立运行在 Electron utilityProcess 进程中，负责小地图画面采样、真实连通域分析 (CCL)、质心提取与实体追踪
 */

let isRunning = false
let currentSessionId = ''
let currentFps = 15
let loopTimer: NodeJS.Timeout | null = null
let sequence = 0

// 实体追踪集合
let trackedEntities = new Map<string, TrackedEntity>()
let entityCounter = 0

function getNewEntityId(team: string): string {
  entityCounter++
  return `track_${team}_${entityCounter}`
}

// 性能与新鲜度测量
let frameCount = 0
let lastFpsCheckTime = Date.now()
let measuredFps = 0

// 原始图像缓冲区与状态
let latestFrameBuffer: Uint8Array | null = null
let latestFrameObservedAt = 0
let latestFrameReceivedTime = 0
let latestFrameSequence = 0
let latestFramePending = false
let lastProcessedSequence = -1
let previousEntitySnapshot: MinimapEntityObservation[] = []
let latestPixelFormat: 'bgra' | 'rgba' = 'bgra'
let frameWidth = 250
let frameHeight = 250
let captureSourceWidth: number | null = null
let captureSourceHeight: number | null = null
let currentPatch = 'unknown'
let activeBackend: 'wgc' | 'dda' | 'desktopCapturer' | 'unavailable' = 'unavailable'
let captureHdr: boolean | null = null
let nativeCaptureSession: { captureFrame(timeoutMs?: number): any; dispose(): void } | null = null
let nativeCaptureRequest: Extract<MainToWorkerMessage, { type: 'start' }> | null = null
let nativeCaptureMode: 'auto' | 'wgc' | 'dda' | null = null
let nativeRuntimeRoot: string | undefined
let championClassifier: ChampionOnnxClassifier | null = null
let detectionTickProcessing = false

function disposeNativeCaptureSession() {
  if (!nativeCaptureSession) return
  try {
    nativeCaptureSession.dispose()
  } catch {
    // ignore native teardown errors during stop/shutdown
  }
  nativeCaptureSession = null
}

function createNativeCaptureSession(
  backend: 'auto' | 'wgc' | 'dda',
  message: Extract<MainToWorkerMessage, { type: 'start' }>
) {
  const normalizedRoi = message.captureConfig.normalizedRoi
  if (!normalizedRoi) {
    throw new Error('Native capture requires a normalized ROI')
  }
  const native = loadTrustedNativeRuntime<typeof import('league-akari-native-win32')>({
    runtimeRoot: nativeRuntimeRoot
  })
  native.capture.load()
  const candidates: Array<'wgc' | 'dda'> = backend === 'auto' ? ['wgc', 'dda'] : [backend]
  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      if (candidate === 'wgc' && !native.capture.isWgcSupported()) continue
      if (candidate === 'dda' && !native.capture.isDdaSupported()) continue
      nativeCaptureSession = new native.capture.CaptureSession({
        backend: candidate,
        targetHwnd: message.targetHwnd,
        targetPid: message.targetPid,
        roi: normalizedRoi
      })
      activeBackend = candidate
      nativeCaptureRequest = message
      nativeCaptureMode = backend
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('No supported native capture backend is available')
}

let cvState = {
  consecutiveFrozenFrames: 0,
  lastFrameHash: 0
}

let workerMessageSinkForTesting: ((message: WorkerToMainMessage) => void) | null = null

export function setWorkerMessageSinkForTesting(
  sink: ((message: WorkerToMainMessage) => void) | null
): void {
  workerMessageSinkForTesting = sink
}

function sendMessage(msg: WorkerToMainMessage) {
  if (workerMessageSinkForTesting) {
    workerMessageSinkForTesting(msg)
    return
  }
  process.parentPort?.postMessage(msg)
}

const MAX_LIVE_FRAME_AGE_MS = 300

export function finalizeLiveObservationFreshness(
  observedAt: number,
  processingStartedAt: number,
  completedAt: number,
  health: MinimapObservationBatch['health'],
  entities: MinimapObservationBatch['entities'],
  events: MinimapObservationBatch['events']
): {
  receivedAt: number
  ageMs: number
  stale: boolean
  health: MinimapObservationBatch['health']
  entities: MinimapObservationBatch['entities']
  events: MinimapObservationBatch['events']
} {
  const sourceAgeMs = observedAt > 0 ? completedAt - observedAt : 0
  const processingAgeMs = completedAt - processingStartedAt
  const ageMs = Math.max(0, sourceAgeMs, processingAgeMs)
  const stale = ageMs > MAX_LIVE_FRAME_AGE_MS

  return {
    receivedAt: completedAt,
    ageMs,
    stale,
    health: stale ? 'unknown' : health,
    entities: stale ? [] : entities,
    events: stale ? [] : events
  }
}

/**
 * 实时画面采样与推断循环
 */
let championCandidates: number[] = []
let allyChampionCandidates: number[] = []
let enemyChampionCandidates: number[] = []
let selfChampionId: number | null = null
let frameDropCount = 0
type ReplayFrameMessage = Extract<MainToWorkerMessage, { type: 'replay-frame' }>
const REPLAY_FRAME_QUEUE_CAPACITY = 3
let replaySessionActive = false
const replayFrameQueue = new ReplayFrameQueue<ReplayFrameMessage>(REPLAY_FRAME_QUEUE_CAPACITY)
let replayFrameProcessing = false
let workerLifecycleVersion = 0

function resetTrackingState(): void {
  trackedEntities = new Map<string, TrackedEntity>()
  entityCounter = 0
  previousEntitySnapshot = []
  lastProcessedSequence = -1
  cvState = { consecutiveFrozenFrames: 0, lastFrameHash: 0 }
}

function rejectReplayFrame(message: ReplayFrameMessage, reason: string): void {
  sendMessage({
    type: 'replay-frame-result',
    requestId: message.requestId,
    sessionId: message.sessionId,
    sequence: message.sequence,
    dropped: true,
    reason
  })
}

export async function processNextReplayFrame(): Promise<void> {
  if (replayFrameProcessing || !replaySessionActive) return
  const message = replayFrameQueue.shift()
  if (!message) return
  replayFrameProcessing = true
  const lifecycleVersion = workerLifecycleVersion
  const sessionId = currentSessionId
  const sessionTrackedEntities = trackedEntities
  const sessionCvState = cvState

  try {
    const inferenceStartedAt = performance.now()
    const frameBuffer = Buffer.isBuffer(message.buffer)
      ? message.buffer
      : new Uint8Array(message.buffer as any)
    const result = await processMinimapFrameWithState(
      frameBuffer,
      message.width,
      message.height,
      message.observedAt,
      message.pixelFormat,
      sessionTrackedEntities,
      getNewEntityId,
      sessionCvState,
      championCandidates,
      championClassifier,
      {
        ally: allyChampionCandidates,
        enemy: enemyChampionCandidates,
        selfChampionId
      }
    )
    if (
      lifecycleVersion !== workerLifecycleVersion ||
      !replaySessionActive ||
      sessionId !== currentSessionId
    ) {
      return
    }
    const events =
      result.health === 'healthy'
        ? deriveMinimapEvents(previousEntitySnapshot, result.entities, message.observedAt)
        : []
    previousEntitySnapshot =
      result.health === 'healthy'
        ? result.entities.map((entity) => ({ ...entity, point: { ...entity.point } }))
        : []

    sendMessage({
      type: 'replay-frame-result',
      requestId: message.requestId,
      sessionId: message.sessionId,
      sequence: message.sequence,
      dropped: false,
      inferenceLatencyMs: Math.max(0, performance.now() - inferenceStartedAt),
      batch: {
        sessionId: currentSessionId,
        patch: currentPatch,
        calibrationVersion: '1.0.0',
        modelVersions: {
          'ccl-cluster': '1.2.0',
          'spatial-tracker': '1.0.0',
          ...(championClassifier
            ? { 'champion-icon-onnx': championClassifier.getManifest().version }
            : {})
        },
        frame: {
          observedAt: message.observedAt,
          receivedAt: message.observedAt,
          sequence: message.sequence,
          ageMs: 0
        },
        health: result.health,
        entities: result.entities,
        events
      }
    })
  } catch (error: any) {
    rejectReplayFrame(message, 'cv-inference-failed')
    sendMessage({
      type: 'error',
      code: 'LC_ERR_REPLAY_CV_INFERENCE_FAIL',
      stage: 'replay-cv-inference',
      details: error?.message || String(error),
      recoverable: false
    })
  } finally {
    replayFrameProcessing = false
    if (replayFrameQueue.size > 0 && replaySessionActive) {
      setImmediate(() => void processNextReplayFrame())
    }
  }
}

function enqueueReplayFrame(message: ReplayFrameMessage): void {
  if (!replaySessionActive || message.sessionId !== currentSessionId) {
    rejectReplayFrame(message, 'replay-session-not-active')
    return
  }
  const superseded = replayFrameQueue.push(message)
  if (superseded) {
    frameDropCount++
    rejectReplayFrame(superseded, 'superseded-by-newer-frame')
  }
  if (!replayFrameProcessing) setImmediate(() => void processNextReplayFrame())
}

export async function runDetectionTick(): Promise<void> {
  if (!isRunning) return
  if (detectionTickProcessing) {
    return
  }
  detectionTickProcessing = true
  const lifecycleVersion = workerLifecycleVersion
  const sessionId = currentSessionId
  const sessionTrackedEntities = trackedEntities
  const sessionCvState = cvState

  const processingStartedAt = Date.now()
  const inferenceStartedAt = performance.now()
  sequence++

  if (nativeCaptureSession) {
    try {
      const captured = nativeCaptureSession.captureFrame(
        Math.max(20, Math.floor(1000 / currentFps))
      )
      if (captured?.buffer && captured.width > 0 && captured.height > 0) {
        if (latestFramePending) frameDropCount++
        latestFrameBuffer = Buffer.isBuffer(captured.buffer)
          ? captured.buffer
          : new Uint8Array(captured.buffer)
        latestFrameObservedAt = captured.observedAt || processingStartedAt
        latestFrameReceivedTime = Date.now()
        latestFrameSequence++
        latestPixelFormat = 'bgra'
        frameWidth = captured.width
        frameHeight = captured.height
        captureSourceWidth =
          Number.isInteger(captured.sourceWidth) && captured.sourceWidth > 0
            ? captured.sourceWidth
            : null
        captureSourceHeight =
          Number.isInteger(captured.sourceHeight) && captured.sourceHeight > 0
            ? captured.sourceHeight
            : null
        activeBackend = captured.backend
        captureHdr = Boolean(captured.hdr)
        latestFramePending = true
      }
    } catch (error: any) {
      disposeNativeCaptureSession()
      if (nativeCaptureMode === 'auto' && activeBackend === 'wgc' && nativeCaptureRequest) {
        try {
          createNativeCaptureSession('dda', nativeCaptureRequest)
          sendMessage({
            type: 'error',
            code: 'LC_ERR_WGC_CAPTURE_FAILED_DDA_ACTIVE',
            stage: 'capture',
            details: error?.message || String(error),
            recoverable: true
          })
        } catch (fallbackError: any) {
          activeBackend = 'desktopCapturer'
          sendMessage({
            type: 'error',
            code: 'LC_ERR_NATIVE_CAPTURE_FAILED',
            stage: 'capture',
            details: fallbackError?.message || String(fallbackError),
            recoverable: true
          })
        }
      } else {
        activeBackend = 'desktopCapturer'
        sendMessage({
          type: 'error',
          code: 'LC_ERR_NATIVE_CAPTURE_FAILED',
          stage: 'capture',
          details: error?.message || String(error),
          recoverable: true
        })
      }
    }
  }

  // The parent port can deliver another frame while inference awaits. Snapshot every source field
  // before the first await so the old result can never be stamped with the new frame's metadata.
  const sourceFrameBuffer = latestFrameBuffer
  const sourceFrameObservedAt = latestFrameObservedAt
  const sourceFrameReceivedAt = latestFrameReceivedTime
  const sourceFrameSequence = latestFrameSequence
  const sourcePixelFormat = latestPixelFormat
  const sourceFrameWidth = frameWidth
  const sourceFrameHeight = frameHeight
  const sourceCaptureWidth = captureSourceWidth
  const sourceCaptureHeight = captureSourceHeight
  const sourceBackend = activeBackend
  const sourceHdr = captureHdr
  const sourceFramePending = latestFramePending
  if (sourceFramePending) latestFramePending = false

  // 推理前快速拒绝已经超龄的输入；完成时还会再次计算以覆盖采集阻塞与推理耗时。
  const frameReceiveAgeMs =
    sourceFrameReceivedAt > 0 ? processingStartedAt - sourceFrameReceivedAt : 9999
  const isFrameStale = frameReceiveAgeMs > MAX_LIVE_FRAME_AGE_MS
  const isDuplicateOrOutOfOrder =
    lastProcessedSequence !== -1 && sourceFrameSequence <= lastProcessedSequence
  const rejectedBeforeInference =
    Boolean(sourceFrameBuffer) && sourceFramePending && (isFrameStale || isDuplicateOrOutOfOrder)
  if (rejectedBeforeInference) frameDropCount++

  try {
    let health: 'healthy' | 'degraded' | 'unknown' = 'healthy'
    let entities: MinimapEntityObservation[] = []
    let events: MinimapObservationBatch['events'] = []
    let processedNewSourceFrame = false

    if (!sourceFrameBuffer || !sourceFramePending || isFrameStale || isDuplicateOrOutOfOrder) {
      health = 'unknown'
      entities = []
    } else {
      lastProcessedSequence = sourceFrameSequence
      const result = await processMinimapFrameWithState(
        sourceFrameBuffer,
        sourceFrameWidth,
        sourceFrameHeight,
        sourceFrameObservedAt,
        sourcePixelFormat,
        sessionTrackedEntities,
        getNewEntityId,
        sessionCvState,
        championCandidates,
        championClassifier,
        {
          ally: allyChampionCandidates,
          enemy: enemyChampionCandidates,
          selfChampionId
        }
      )
      if (
        lifecycleVersion !== workerLifecycleVersion ||
        !isRunning ||
        sessionId !== currentSessionId
      ) {
        return
      }
      health = result.health
      entities = result.entities
      processedNewSourceFrame = true
      if (health === 'healthy') {
        events = deriveMinimapEvents(
          previousEntitySnapshot,
          entities,
          sourceFrameObservedAt || processingStartedAt
        )
        previousEntitySnapshot = entities.map((entity) => ({
          ...entity,
          point: { ...entity.point }
        }))
      } else {
        previousEntitySnapshot = []
      }
    }

    const observedAt = sourceFrameObservedAt || processingStartedAt
    const completedAt = Date.now()
    const freshness = finalizeLiveObservationFreshness(
      observedAt,
      processingStartedAt,
      completedAt,
      health,
      entities,
      events
    )
    health = freshness.health
    entities = freshness.entities
    events = freshness.events
    if (sourceFramePending && freshness.stale) {
      if (!rejectedBeforeInference) frameDropCount++
      previousEntitySnapshot = []
      sessionTrackedEntities.clear()
      sessionCvState.consecutiveFrozenFrames = 0
      sessionCvState.lastFrameHash = 0
    }
    if (processedNewSourceFrame && !freshness.stale) frameCount++
    const inferenceLatencyMs = Math.max(0, performance.now() - inferenceStartedAt)

    // 构建完整观测批次
    const batch: MinimapObservationBatch = {
      sessionId: currentSessionId,
      patch: currentPatch,
      calibrationVersion: '1.0.0',
      modelVersions: {
        'ccl-cluster': '1.2.0',
        'spatial-tracker': '1.0.0',
        ...(championClassifier
          ? { 'champion-icon-onnx': championClassifier.getManifest().version }
          : {})
      },
      frame: {
        observedAt,
        receivedAt: freshness.receivedAt,
        sequence,
        ageMs: freshness.ageMs
      },
      health,
      entities,
      events
    }

    sendMessage({
      type: 'observation-batch',
      batch
    })

    // 定期计算真实测量 FPS
    if (completedAt - lastFpsCheckTime >= 1000) {
      measuredFps = Math.round((frameCount * 1000) / (completedAt - lastFpsCheckTime))
      frameCount = 0
      lastFpsCheckTime = completedAt

      sendMessage({
        type: 'status',
        backend: sourceBackend,
        resolution: { width: sourceFrameWidth, height: sourceFrameHeight },
        sourceResolution:
          sourceCaptureWidth !== null && sourceCaptureHeight !== null
            ? { width: sourceCaptureWidth, height: sourceCaptureHeight }
            : null,
        hdr: sourceHdr,
        fps: measuredFps,
        roiHealth: health
      })
      sendMessage({
        type: 'metrics',
        captureLatencyMs:
          sourceFrameObservedAt > 0 ? Math.max(0, completedAt - sourceFrameObservedAt) : 0,
        inferenceLatencyMs,
        dropCount: frameDropCount,
        frameAgeMs: freshness.ageMs
      })
    }
  } catch (err: any) {
    sendMessage({
      type: 'error',
      code: 'LC_ERR_CV_INFERENCE_FAIL',
      stage: 'cv-inference',
      details: err?.message || String(err),
      recoverable: true
    })
  } finally {
    detectionTickProcessing = false
  }
}

export async function handleMainMessage(rawMsg: unknown): Promise<void> {
  const parsed = mainToWorkerMessageSchema.safeParse(rawMsg)
  if (!parsed.success) {
    sendMessage({
      type: 'error',
      code: 'LC_ERR_PROTOCOL_INVALID',
      stage: 'message-validation',
      details: parsed.error.issues
        .map((issue) => issue.message)
        .join('; ')
        .slice(0, 500),
      recoverable: true
    })
    return
  }
  const msg = parsed.data as MainToWorkerMessage

  switch (msg.type) {
    case 'initialize': {
      workerLifecycleVersion++
      // UtilityProcess does not preserve Electron's development `process.defaultApp` marker.
      // Resolve the trusted root in main and pass it here instead of guessing dev/packaged mode.
      nativeRuntimeRoot = msg.runtimePaths.nativeRuntimeRoot
      replaySessionActive = false
      replayFrameQueue.clear()
      resetTrackingState()
      const supportedBackends = ['desktopCapturer']
      if (process.platform === 'win32') {
        try {
          const native = loadTrustedNativeRuntime<typeof import('league-akari-native-win32')>({
            runtimeRoot: nativeRuntimeRoot
          })
          native.capture.load()
          if (native.capture.isWgcSupported()) supportedBackends.unshift('wgc')
          if (native.capture.isDdaSupported())
            supportedBackends.splice(supportedBackends.includes('wgc') ? 1 : 0, 0, 'dda')
        } catch {
          // desktopCapturer remains the only reported backend when the native addon cannot load.
        }
      }
      const runtimeVersions: Record<string, string> = { ccl: '1.2.0' }
      if (championClassifier) {
        await championClassifier.dispose().catch(() => undefined)
      }
      championClassifier = null
      const descriptor = msg.modelManifest['champion-icon-onnx']
      if (descriptor) {
        try {
          championClassifier = await ChampionOnnxClassifier.load(descriptor)
          const manifest = championClassifier.getManifest()
          runtimeVersions['champion-icon-onnx'] = manifest.version
          runtimeVersions.onnxruntime = `${manifest.runtimeVersion}/${manifest.executionProvider}`
        } catch (error: any) {
          sendMessage({
            type: 'error',
            code: 'LC_ERR_IDENTITY_MODEL_LOAD_FAILED',
            stage: 'model-load',
            details: error?.message || String(error),
            recoverable: true
          })
        }
      }
      sendMessage({
        type: 'ready',
        protocolVersion: '1.0.0',
        runtimeVersions,
        supportedBackends
      })
      break
    }

    case 'start': {
      workerLifecycleVersion++
      disposeNativeCaptureSession()
      replaySessionActive = false
      replayFrameQueue.clear()
      currentSessionId = msg.sessionId
      currentFps = msg.captureConfig?.fps || 15
      frameWidth = msg.captureConfig?.roi?.width || 250
      frameHeight = msg.captureConfig?.roi?.height || 250
      captureSourceWidth = null
      captureSourceHeight = null
      captureHdr = null
      latestFrameBuffer = null
      latestFrameObservedAt = 0
      latestFrameReceivedTime = 0
      latestFrameSequence = 0
      latestFramePending = false
      championCandidates = msg.championCandidates || []
      allyChampionCandidates = msg.allyChampionCandidates || []
      enemyChampionCandidates = msg.enemyChampionCandidates || []
      selfChampionId = msg.selfChampionId ?? null
      frameDropCount = 0
      if (msg.patch) {
        currentPatch = msg.patch
      }
      if (msg.backend === 'wgc' || msg.backend === 'dda' || msg.backend === 'auto') {
        try {
          createNativeCaptureSession(msg.backend, msg)
        } catch (error: any) {
          activeBackend = 'desktopCapturer'
          nativeCaptureRequest = null
          nativeCaptureMode = null
          sendMessage({
            type: 'error',
            code: 'LC_ERR_NATIVE_CAPTURE_UNAVAILABLE',
            stage: 'capture-init',
            details: error?.message || String(error),
            recoverable: true
          })
        }
      } else {
        activeBackend = 'desktopCapturer'
        nativeCaptureRequest = null
        nativeCaptureMode = null
      }
      isRunning = true
      sequence = 0
      frameCount = 0
      lastFpsCheckTime = Date.now()
      resetTrackingState()

      if (loopTimer) {
        clearInterval(loopTimer)
      }
      const intervalMs = Math.max(20, Math.floor(1000 / currentFps))
      loopTimer = setInterval(() => void runDetectionTick(), intervalMs)
      break
    }

    case 'stop': {
      if (msg.sessionId !== currentSessionId) break
      workerLifecycleVersion++
      disposeNativeCaptureSession()
      isRunning = false
      replaySessionActive = false
      replayFrameQueue.clear()
      if (loopTimer) {
        clearInterval(loopTimer)
        loopTimer = null
      }
      latestFrameBuffer = null
      latestFrameObservedAt = 0
      latestFrameReceivedTime = 0
      latestFramePending = false
      resetTrackingState()
      championCandidates = []
      nativeCaptureRequest = null
      nativeCaptureMode = null
      activeBackend = 'unavailable'
      break
    }

    case 'update-config': {
      if (msg.fps && msg.fps !== currentFps) {
        currentFps = msg.fps
        if (isRunning && loopTimer) {
          clearInterval(loopTimer)
          loopTimer = setInterval(() => void runDetectionTick(), Math.floor(1000 / currentFps))
        }
      }
      break
    }

    case 'request-preview': {
      sendMessage({
        type: 'preview-result',
        requestId: msg.requestId,
        roi: { x: 0.8, y: 0.8, width: 0.2, height: 0.2 },
        expiresAt: Date.now() + 5000
      })
      break
    }

    case 'ping': {
      sendMessage({
        type: 'heartbeat',
        sequence,
        captureState: replaySessionActive ? 'replay' : isRunning ? 'running' : 'idle',
        queueDepth: replayFrameQueue.size + (replayFrameProcessing ? 1 : 0),
        memoryBytes: process.memoryUsage().heapUsed
      })
      break
    }

    case 'frame-buffer': {
      // 背压单槽保护：若前一帧尚未被消费，记录丢帧
      if (latestFramePending) frameDropCount++
      latestFrameBuffer = Buffer.isBuffer(msg.buffer)
        ? msg.buffer
        : new Uint8Array(msg.buffer as any)
      latestFrameObservedAt = msg.observedAt
      latestFrameReceivedTime = Date.now()
      latestFrameSequence = msg.sequence
      latestPixelFormat = msg.pixelFormat || 'bgra'
      if (msg.width) frameWidth = msg.width
      if (msg.height) frameHeight = msg.height
      captureSourceWidth = msg.sourceWidth ?? null
      captureSourceHeight = msg.sourceHeight ?? null
      captureHdr = null
      latestFramePending = true
      break
    }

    case 'replay-start': {
      workerLifecycleVersion++
      disposeNativeCaptureSession()
      isRunning = false
      if (loopTimer) {
        clearInterval(loopTimer)
        loopTimer = null
      }
      currentSessionId = msg.sessionId
      currentPatch = msg.patch
      championCandidates = [...msg.championCandidates]
      allyChampionCandidates = [...msg.allyChampionCandidates]
      enemyChampionCandidates = [...msg.enemyChampionCandidates]
      selfChampionId = msg.selfChampionId
      frameDropCount = 0
      latestFramePending = false
      replayFrameQueue.clear()
      replaySessionActive = true
      resetTrackingState()
      break
    }

    case 'replay-frame': {
      enqueueReplayFrame(msg)
      break
    }

    case 'replay-stop': {
      if (msg.sessionId !== currentSessionId) break
      workerLifecycleVersion++
      replaySessionActive = false
      for (const pending of replayFrameQueue.drain()) {
        rejectReplayFrame(pending, 'replay-session-stopped')
      }
      resetTrackingState()
      championCandidates = []
      allyChampionCandidates = []
      enemyChampionCandidates = []
      selfChampionId = null
      sendMessage({
        type: 'stopped',
        sessionId: msg.sessionId,
        reason: msg.reason
      })
      break
    }

    case 'shutdown': {
      workerLifecycleVersion++
      disposeNativeCaptureSession()
      nativeCaptureRequest = null
      nativeCaptureMode = null
      isRunning = false
      replaySessionActive = false
      replayFrameQueue.clear()
      if (loopTimer) {
        clearInterval(loopTimer)
        loopTimer = null
      }
      if (championClassifier) {
        await championClassifier.dispose().catch(() => undefined)
        championClassifier = null
      }
      process.exit(0)
      break
    }
  }
}

if (process.versions.electron && process.type === 'utility' && process.parentPort) {
  let messageChain = Promise.resolve()
  process.parentPort.on('message', (event) => {
    messageChain = messageChain
      .then(() => handleMainMessage(event.data))
      .catch((error) => {
        sendMessage({
          type: 'error',
          code: 'LC_ERR_WORKER_MESSAGE_HANDLER_FAILED',
          stage: 'message-handler',
          details: error instanceof Error ? error.message : String(error),
          recoverable: true
        })
      })
  })
}
