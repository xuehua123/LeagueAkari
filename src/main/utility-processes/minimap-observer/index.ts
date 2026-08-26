import {
  MainToWorkerMessage,
  MinimapEntityObservation,
  MinimapObservationBatch,
  WorkerToMainMessage
} from '../../../shared/types/live-coach'
import { TrackedEntity, processMinimapFrameWithState } from './minimap-cv'

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
const trackedEntities = new Map<string, TrackedEntity>()
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
let lastProcessedSequence = -1
let lastProcessedHealth: 'healthy' | 'degraded' | 'unknown' = 'unknown'
let latestPixelFormat: 'bgra' | 'rgba' = 'bgra'
let frameWidth = 250
let frameHeight = 250
let currentPatch = '16.16.1'

const cvState = {
  consecutiveFrozenFrames: 0,
  lastFrameHash: 0
}

function sendMessage(msg: WorkerToMainMessage) {
  if (process.parentPort) {
    process.parentPort.postMessage(msg)
  }
}

/**
 * 实时画面采样与推断循环
 */
function runDetectionTick() {
  if (!isRunning) return

  const now = Date.now()
  sequence++
  frameCount++

  // 检查画面新鲜度：如果超过 600ms 没有新画面帧注入，说明采集已卡死或停止
  const frameAgeMs = latestFrameReceivedTime > 0 ? now - latestFrameReceivedTime : 9999
  const isFrameStale = frameAgeMs > 600

  // 检查是否为重复帧
  const isDuplicateFrame =
    latestFrameSequence === lastProcessedSequence && lastProcessedSequence !== -1

  try {
    let health: 'healthy' | 'degraded' | 'unknown' = 'healthy'
    let entities: MinimapEntityObservation[] = []

    if (!latestFrameBuffer || isFrameStale) {
      health = 'unknown'
      lastProcessedHealth = 'unknown'
      entities = []
    } else if (isDuplicateFrame) {
      // 重复帧继承上一帧的真实健康状态（而非硬编码 healthy），不重复自增 hitCount，返回现有实体快照
      health = lastProcessedHealth
      entities = Array.from(trackedEntities.values()).map((e) => ({
        trackId: e.trackId,
        kind: e.kind,
        team: e.team,
        championId: e.championId,
        point: { x: e.point.x, y: e.point.y },
        regionId: e.regionId,
        confidence: e.confidence,
        lifecycle: e.lifecycle,
        firstObservedAt: e.firstObservedAt,
        lastObservedAt: e.lastObservedAt,
        expiresAt: e.expiresAt
      }))
    } else {
      lastProcessedSequence = latestFrameSequence
      const result = processMinimapFrameWithState(
        latestFrameBuffer,
        frameWidth,
        frameHeight,
        latestFrameObservedAt,
        latestPixelFormat,
        trackedEntities,
        getNewEntityId,
        cvState
      )
      health = result.health
      lastProcessedHealth = result.health
      entities = result.entities
    }

    const ageMs = latestFrameObservedAt > 0 ? Math.max(1, now - latestFrameObservedAt) : 0

    // 构建完整观测批次
    const batch: MinimapObservationBatch = {
      sessionId: currentSessionId,
      patch: currentPatch,
      calibrationVersion: '1.0.0',
      modelVersions: {
        'ccl-cluster': '1.2.0',
        'spatial-tracker': '1.0.0'
      },
      frame: {
        observedAt: latestFrameObservedAt || now,
        receivedAt: now,
        sequence,
        ageMs
      },
      health,
      entities,
      events: []
    }

    sendMessage({
      type: 'observation-batch',
      batch
    })

    // 定期计算真实测量 FPS
    if (now - lastFpsCheckTime >= 1000) {
      measuredFps = Math.round((frameCount * 1000) / (now - lastFpsCheckTime))
      frameCount = 0
      lastFpsCheckTime = now

      sendMessage({
        type: 'status',
        backend: process.platform === 'win32' ? 'desktopCapturer' : 'mock',
        resolution: { width: frameWidth, height: frameHeight },
        hdr: false,
        fps: measuredFps || currentFps,
        roiHealth: health
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
  }
}

function handleMainMessage(rawMsg: unknown) {
  const msg = rawMsg as MainToWorkerMessage
  if (!msg || typeof msg !== 'object' || !('type' in msg)) {
    return
  }

  switch (msg.type) {
    case 'initialize': {
      trackedEntities.clear()
      sendMessage({
        type: 'ready',
        protocolVersion: '1.0.0',
        runtimeVersions: {
          onnx: '1.18.0',
          ccl: '1.2.0'
        },
        supportedBackends: ['desktopCapturer', 'wgc', 'dda']
      })
      break
    }

    case 'start': {
      currentSessionId = msg.sessionId
      currentFps = msg.captureConfig?.fps || 15
      frameWidth = msg.captureConfig?.roi?.width || 250
      frameHeight = msg.captureConfig?.roi?.height || 250
      if (msg.patch) {
        currentPatch = msg.patch
      }
      isRunning = true
      sequence = 0
      frameCount = 0
      lastFpsCheckTime = Date.now()
      lastProcessedSequence = -1
      lastProcessedHealth = 'unknown'

      if (loopTimer) {
        clearInterval(loopTimer)
      }
      const intervalMs = Math.max(20, Math.floor(1000 / currentFps))
      loopTimer = setInterval(runDetectionTick, intervalMs)
      break
    }

    case 'stop': {
      isRunning = false
      if (loopTimer) {
        clearInterval(loopTimer)
        loopTimer = null
      }
      latestFrameBuffer = null
      latestFrameObservedAt = 0
      latestFrameReceivedTime = 0
      lastProcessedSequence = -1
      trackedEntities.clear()
      break
    }

    case 'update-config': {
      if (msg.fps && msg.fps !== currentFps) {
        currentFps = msg.fps
        if (isRunning && loopTimer) {
          clearInterval(loopTimer)
          loopTimer = setInterval(runDetectionTick, Math.floor(1000 / currentFps))
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
        captureState: isRunning ? 'running' : 'idle',
        queueDepth: 0,
        memoryBytes: process.memoryUsage().heapUsed
      })
      break
    }

    case 'frame-buffer': {
      latestFrameBuffer = Buffer.isBuffer(msg.buffer)
        ? msg.buffer
        : new Uint8Array(msg.buffer as any)
      latestFrameObservedAt = msg.observedAt
      latestFrameReceivedTime = Date.now()
      latestFrameSequence = msg.sequence
      latestPixelFormat = msg.pixelFormat || 'bgra'
      if (msg.width) frameWidth = msg.width
      if (msg.height) frameHeight = msg.height
      break
    }

    case 'shutdown': {
      isRunning = false
      if (loopTimer) {
        clearInterval(loopTimer)
        loopTimer = null
      }
      process.exit(0)
      break
    }
  }
}

if (process.parentPort) {
  process.parentPort.on('message', (event) => {
    handleMainMessage(event.data)
  })
}
