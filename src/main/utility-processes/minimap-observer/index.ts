import {
  MainToWorkerMessage,
  MinimapEntityKind,
  MinimapEntityObservation,
  MinimapObservationBatch,
  ObservationLifecycle,
  WorkerToMainMessage
} from '../../../shared/types/live-coach'

/**
 * Minimap Observer Utility Process Worker
 * 独立运行在 Electron utilityProcess 进程中，负责小地图画面采样、真实连通域分析 (CCL)、质心提取与实体追踪
 */

interface TrackedEntity {
  trackId: string
  kind: MinimapEntityKind
  team: 'enemy' | 'ally' | 'neutral' | 'unknown'
  championId: number | null
  point: { x: number; y: number }
  regionId: string | null
  confidence: number
  lifecycle: ObservationLifecycle
  firstObservedAt: number
  lastObservedAt: number
  expiresAt: number
  hitCount: number
}

let isRunning = false
let currentSessionId = ''
let currentFps = 15
let loopTimer: NodeJS.Timeout | null = null
let sequence = 0

// 实体追踪集合
const trackedEntities = new Map<string, TrackedEntity>()
let entityCounter = 0

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
let latestPixelFormat: 'bgra' | 'rgba' = 'bgra'
let frameWidth = 250
let frameHeight = 250

function sendMessage(msg: WorkerToMainMessage) {
  if (process.parentPort) {
    process.parentPort.postMessage(msg)
  }
}

/**
 * 区域判定辅助函数（召唤师峡谷小地图归一化区域划分）
 */
function getMapRegion(x: number, y: number): string {
  if (x < 0.35 && y < 0.35) return 'top_lane'
  if (x > 0.65 && y > 0.65) return 'bot_lane'
  if (Math.abs(x - y) < 0.15 && x >= 0.35 && x <= 0.65) return 'mid_lane'
  if (x > y) return 'bot_jungle_river'
  return 'top_jungle_river'
}

interface ComponentDetection {
  x: number
  y: number
  team: 'enemy' | 'ally'
  pixelCount: number
}

/**
 * 真实连通域提取与聚类分析 (Connected Component Labeling)
 * 对小地图像素网格执行 8-邻域泛洪连通域提取，计算质心并过滤噪点与背景边框
 */
function extractConnectedComponents(
  buffer: Uint8Array,
  width: number,
  height: number,
  pixelFormat: 'bgra' | 'rgba'
): ComponentDetection[] {
  const isBgra = pixelFormat === 'bgra'
  const binaryGrid = new Int8Array(width * height) // 0: none, 1: enemy (red), 2: ally (blue)

  // 1. 色彩空间阈值判定，生成二值分类网格
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const b = buffer[idx]
      const g = buffer[idx + 1]
      const r = buffer[idx + 2]

      const red = isBgra ? r : b
      const blue = isBgra ? b : r
      const green = g

      // 敌方英雄红色图元 (Red > 155, Red比绿蓝高 40% 以上)
      if (red > 155 && red > green * 1.4 && red > blue * 1.4) {
        binaryGrid[y * width + x] = 1
      }
      // 友方英雄蓝色图元 (Blue > 155, Blue比红绿高 30% 以上)
      else if (blue > 155 && blue > red * 1.35 && blue > green * 1.1) {
        binaryGrid[y * width + x] = 2
      }
    }
  }

  // 2. 8-邻域 BFS 连通域标记与质心聚合
  const visited = new Uint8Array(width * height)
  const detections: ComponentDetection[] = []

  const dx = [-1, 0, 1, -1, 1, -1, 0, 1]
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x
      const targetType = binaryGrid[startIdx]
      if (targetType === 0 || visited[startIdx]) {
        continue
      }

      // BFS 搜索连通分量
      const queue = [startIdx]
      visited[startIdx] = 1
      let sumX = 0
      let sumY = 0
      let count = 0

      while (queue.length > 0) {
        const curr = queue.pop()!
        const cy = Math.floor(curr / width)
        const cx = curr % width

        sumX += cx
        sumY += cy
        count++

        for (let i = 0; i < 8; i++) {
          const nx = cx + dx[i]
          const ny = cy + dy[i]
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx
            if (!visited[nIdx] && binaryGrid[nIdx] === targetType) {
              visited[nIdx] = 1
              queue.push(nIdx)
            }
          }
        }
      }

      // 面积过滤：有效英雄图标面积通常在 6 ~ 350 像素之间（过滤单点噪点与巨大 UI 边框）
      if (count >= 6 && count <= 350) {
        const centroidX = sumX / count / width
        const centroidY = sumY / count / height
        detections.push({
          x: centroidX,
          y: centroidY,
          team: targetType === 1 ? 'enemy' : 'ally',
          pixelCount: count
        })
      }
    }
  }

  return detections
}

/**
 * 图像连通域提取与实体追踪
 */
function processMinimapFrame(
  buffer: Uint8Array | null,
  width: number,
  height: number,
  observedAt: number,
  pixelFormat: 'bgra' | 'rgba'
): {
  health: 'healthy' | 'degraded' | 'unknown'
  entities: MinimapEntityObservation[]
} {
  // 1. 无真实画面缓冲时，返回 unknown 状态，绝不伪造虚假数据
  if (!buffer || buffer.length === 0) {
    return { health: 'unknown', entities: [] }
  }

  // 2. 真实网格像素方差与亮度检测（黑帧/遮挡/静止画面判定）
  let sumLuma = 0
  const pixelCount = width * height
  const isBgra = pixelFormat === 'bgra'

  for (let i = 0; i < buffer.length; i += 4) {
    const b = buffer[i]
    const g = buffer[i + 1]
    const r = buffer[i + 2]
    const red = isBgra ? r : b
    const blue = isBgra ? b : r
    sumLuma += 0.299 * red + 0.587 * g + 0.114 * blue
  }
  const meanLuma = sumLuma / pixelCount

  let sumVariance = 0
  for (let i = 0; i < buffer.length; i += 4) {
    const b = buffer[i]
    const g = buffer[i + 1]
    const r = buffer[i + 2]
    const red = isBgra ? r : b
    const blue = isBgra ? b : r
    const luma = 0.299 * red + 0.587 * g + 0.114 * blue
    sumVariance += (luma - meanLuma) ** 2
  }
  const variance = Math.sqrt(sumVariance / pixelCount)

  if (variance < 6.0) {
    return { health: 'degraded', entities: [] }
  }

  // 3. 运行连通域聚类算法 (CCL)
  const detections = extractConnectedComponents(buffer, width, height, pixelFormat)

  // 4. 实体追踪与生命周期状态机 (Object Tracking)
  const activeIds = new Set<string>()

  for (const det of detections) {
    let matchedId: string | null = null
    let minDist = 0.08 // 匹配距离阈值

    for (const [id, entity] of trackedEntities.entries()) {
      if (entity.team === det.team) {
        const dist = Math.sqrt((entity.point.x - det.x) ** 2 + (entity.point.y - det.y) ** 2)
        if (dist < minDist) {
          minDist = dist
          matchedId = id
        }
      }
    }

    if (matchedId) {
      const entity = trackedEntities.get(matchedId)!
      entity.point = { x: det.x, y: det.y }
      entity.regionId = getMapRegion(det.x, det.y)
      entity.lastObservedAt = observedAt
      entity.expiresAt = observedAt + 5000
      entity.hitCount++
      if (entity.hitCount >= 2) {
        entity.lifecycle = 'confirmed'
        entity.confidence = Math.min(0.98, 0.85 + entity.hitCount * 0.03)
      }
      activeIds.add(matchedId)
    } else {
      entityCounter++
      const newId = `track_${det.team}_${entityCounter}`
      const newEntity: TrackedEntity = {
        trackId: newId,
        kind: det.team === 'enemy' ? 'enemy' : 'ally',
        team: det.team,
        championId: null,
        point: { x: det.x, y: det.y },
        regionId: getMapRegion(det.x, det.y),
        confidence: 0.85,
        lifecycle: 'candidate',
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        expiresAt: observedAt + 5000,
        hitCount: 1
      }
      trackedEntities.set(newId, newEntity)
      activeIds.add(newId)
    }
  }

  // 5. 实体生命周期转换与失效衰减
  for (const [id, entity] of trackedEntities.entries()) {
    if (!activeIds.has(id)) {
      if (observedAt > entity.expiresAt) {
        trackedEntities.delete(id)
      } else if (observedAt - entity.lastObservedAt > 1500) {
        entity.lifecycle = 'invalidated'
      }
    }
  }

  const resultEntities: MinimapEntityObservation[] = Array.from(trackedEntities.values()).map(
    (e) => ({
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
    })
  )

  return {
    health: 'healthy',
    entities: resultEntities
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
      entities = []
    } else if (isDuplicateFrame) {
      // 重复帧不重新运行 CCL，也不重新自增 hitCount，返回现有实体快照
      health = 'healthy'
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
      const result = processMinimapFrame(
        latestFrameBuffer,
        frameWidth,
        frameHeight,
        latestFrameObservedAt,
        latestPixelFormat
      )
      health = result.health
      entities = result.entities
    }

    const ageMs = latestFrameObservedAt > 0 ? Math.max(1, now - latestFrameObservedAt) : 0

    // 构建完整观测批次
    const batch: MinimapObservationBatch = {
      sessionId: currentSessionId,
      patch: '16.16.1',
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
      isRunning = true
      sequence = 0
      frameCount = 0
      lastFpsCheckTime = Date.now()
      lastProcessedSequence = -1

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
