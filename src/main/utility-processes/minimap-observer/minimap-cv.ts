import {
  MinimapEntityKind,
  MinimapEntityObservation,
  ObservationLifecycle
} from '../../../shared/types/live-coach'

export interface TrackedEntity {
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

export interface ComponentDetection {
  x: number
  y: number
  team: 'enemy' | 'ally'
  pixelCount: number
}

/**
 * 区域判定辅助函数（召唤师峡谷小地图归一化区域划分）
 * 坐标系约定：(0,0) 为左上角，(1,1) 为右下角，(0,1) 为左下角（蓝方基地），(1,0) 为右上角（红方基地）
 */
export function getMapRegion(x: number, y: number): string {
  // 1. 中路判定：连接左下蓝方基地与右上红方基地，几何主轴方程为 x + y = 1
  if (Math.abs(x + y - 1) < 0.12 && x >= 0.18 && x <= 0.82 && y >= 0.18 && y <= 0.82) {
    return 'mid_lane'
  }

  // 2. 上路判定：沿左边缘与上边缘走向的外侧边路走廊 (x + y < 0.75 且 (x < 0.18 || y < 0.18))
  if ((x < 0.18 || y < 0.18) && x + y < 0.75) {
    return 'top_lane'
  }

  // 3. 下路判定：沿下边缘与右边缘走向的外侧边路走廊 (x + y > 1.25 且 (x > 0.82 || y > 0.82))
  if ((x > 0.82 || y > 0.82) && x + y > 1.25) {
    return 'bot_lane'
  }

  // 4. 河道判定：垂直于中路，连接左上河道/大龙坑与右下河道/小龙坑，几何主轴为 x = y
  if (Math.abs(x - y) < 0.12) {
    return x + y < 1.0 ? 'top_river' : 'bot_river'
  }

  // 5. 上下半区野区判定
  // x + y < 1.0 为上半区野区 (top_jungle)
  // x + y >= 1.0 为下半区野区 (bot_jungle)
  if (x + y < 1.0) {
    return 'top_jungle'
  } else {
    return 'bot_jungle'
  }
}

/**
 * 真实连通域提取与聚类分析 (Connected Component Labeling)
 * 对小地图像素网格执行 8-邻域泛洪连通域提取，计算质心并过滤噪点与背景边框
 */
export function extractConnectedComponents(
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
 * 图像连通域提取与实体追踪状态机
 */
export interface MinimapCvState {
  consecutiveFrozenFrames: number
  lastFrameHash: number
}

export function computeFrameHash(buffer: Uint8Array): number {
  if (!buffer || buffer.byteLength === 0) return 0

  // 使用 DataView 安全读取任意 byteOffset（非四字节对齐如 byteOffset % 4 !== 0 绝不崩溃）
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  const numWords = Math.floor(buffer.byteLength / 4)

  for (let i = 0; i < numWords; i++) {
    const val = view.getUint32(i * 4, true)
    h1 = Math.imul(h1 ^ val, 16777619) | 0
    h2 = Math.imul(h2 ^ ((val >>> 16) | (val << 16)), 0x85ebca6b) | 0
  }

  // 补齐尾部不足 4 字节的零散字节
  for (let i = numWords * 4; i < buffer.byteLength; i++) {
    const b = buffer[i]
    h1 = Math.imul(h1 ^ b, 16777619) | 0
    h2 = Math.imul(h2 ^ b, 0x85ebca6b) | 0
  }

  return (h1 ^ h2) | 0
}

export function processMinimapFrameWithState(
  buffer: Uint8Array,
  width: number,
  height: number,
  observedAt: number,
  pixelFormat: 'bgra' | 'rgba',
  trackedEntities: Map<string, TrackedEntity>,
  getNewEntityId: (team: string) => string,
  cvState?: MinimapCvState
): { health: 'healthy' | 'degraded' | 'unknown'; entities: MinimapEntityObservation[] } {
  // 1. 基础尺寸与有效性校验
  if (!buffer || buffer.length === 0 || width <= 0 || height <= 0) {
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

  // 纯黑、纯白、纯灰遮挡或低方差空白/静止死帧一律判定为 degraded
  if (variance < 2.5 || meanLuma < 3.0 || meanLuma > 252.0) {
    return { health: 'degraded', entities: [] }
  }

  // 2.2 纹理画面静止/冻结死帧检测 (Frame Content Freeze Detection)
  // 即使主进程单调递增 sequence，若物理画面像素连续 15 帧完全不变，说明采集流已挂起或游戏画面卡死
  if (cvState) {
    const currentHash = computeFrameHash(buffer)
    if (currentHash === cvState.lastFrameHash) {
      cvState.consecutiveFrozenFrames++
      if (cvState.consecutiveFrozenFrames >= 15) {
        return { health: 'degraded', entities: [] }
      }
    } else {
      cvState.consecutiveFrozenFrames = 1
      cvState.lastFrameHash = currentHash
    }
  }

  // 3. 运行连通域聚类算法 (CCL)
  const detections = extractConnectedComponents(buffer, width, height, pixelFormat)

  // 4. 实体追踪与生命周期状态机 (Object Tracking)
  const activeIds = new Set<string>()
  const matchedIdsInCurrentFrame = new Set<string>()

  for (const det of detections) {
    let matchedId: string | null = null
    let minDist = 0.08 // 匹配距离阈值

    for (const [id, entity] of trackedEntities.entries()) {
      if (entity.team === det.team && !matchedIdsInCurrentFrame.has(id)) {
        const dist = Math.sqrt((entity.point.x - det.x) ** 2 + (entity.point.y - det.y) ** 2)
        if (dist < minDist) {
          minDist = dist
          matchedId = id
        }
      }
    }

    if (matchedId) {
      matchedIdsInCurrentFrame.add(matchedId)
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
      const newId = getNewEntityId(det.team)
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
      matchedIdsInCurrentFrame.add(newId)
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
