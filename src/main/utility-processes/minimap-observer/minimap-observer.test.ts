import { describe, expect, it } from 'vitest'

describe('Minimap Observer CV & Tracking Algorithms', () => {
  // 提取自 minimap-observer worker 核心算法的纯函数测试
  function extractConnectedComponents(
    buffer: Uint8Array,
    width: number,
    height: number,
    pixelFormat: 'bgra' | 'rgba'
  ) {
    const isBgra = pixelFormat === 'bgra'
    const binaryGrid = new Int8Array(width * height)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const b = buffer[idx]
        const g = buffer[idx + 1]
        const r = buffer[idx + 2]

        const red = isBgra ? r : b
        const blue = isBgra ? b : r
        const green = g

        if (red > 155 && red > green * 1.4 && red > blue * 1.4) {
          binaryGrid[y * width + x] = 1
        } else if (blue > 155 && blue > red * 1.35 && blue > green * 1.1) {
          binaryGrid[y * width + x] = 2
        }
      }
    }

    const visited = new Uint8Array(width * height)
    const detections: Array<{
      x: number
      y: number
      team: 'enemy' | 'ally'
      pixelCount: number
    }> = []

    const dx = [-1, 0, 1, -1, 1, -1, 0, 1]
    const dy = [-1, -1, -1, 0, 0, 1, 1, 1]

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const startIdx = y * width + x
        const targetType = binaryGrid[startIdx]
        if (targetType === 0 || visited[startIdx]) continue

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

  it('correctly clusters a contiguous block of red pixels into a single CCL detection with centroid', () => {
    const width = 100
    const height = 100
    const buffer = new Uint8Array(width * height * 4)

    // 在 (20, 30) 到 (24, 34) 绘制一个 5x5 的红色图元 (25 像素)
    for (let y = 30; y < 35; y++) {
      for (let x = 20; x < 25; x++) {
        const idx = (y * width + x) * 4
        // BGRA 格式: B=0, G=0, R=255, A=255
        buffer[idx] = 0
        buffer[idx + 1] = 0
        buffer[idx + 2] = 255
        buffer[idx + 3] = 255
      }
    }

    const detections = extractConnectedComponents(buffer, width, height, 'bgra')

    expect(detections.length).toBe(1)
    expect(detections[0].team).toBe('enemy')
    expect(detections[0].pixelCount).toBe(25)
    // 质心为 (22 / 100, 32 / 100) = (0.22, 0.32)
    expect(detections[0].x).toBeCloseTo(0.22, 2)
    expect(detections[0].y).toBeCloseTo(0.32, 2)
  })

  it('distinguishes two adjacent enemy heroes and does not merge them into the same trackId within the same frame', () => {
    const width = 100
    const height = 100
    const buffer = new Uint8Array(width * height * 4)

    // 英雄 1: 位于 (20, 20) 区域
    for (let y = 20; y < 24; y++) {
      for (let x = 20; x < 24; x++) {
        const idx = (y * width + x) * 4
        buffer[idx] = 0
        buffer[idx + 1] = 0
        buffer[idx + 2] = 255
        buffer[idx + 3] = 255
      }
    }

    // 英雄 2: 位于 (35, 20) 区域
    for (let y = 20; y < 24; y++) {
      for (let x = 35; x < 39; x++) {
        const idx = (y * width + x) * 4
        buffer[idx] = 0
        buffer[idx + 1] = 0
        buffer[idx + 2] = 255
        buffer[idx + 3] = 255
      }
    }

    const detections = extractConnectedComponents(buffer, width, height, 'bgra')
    expect(detections.length).toBe(2)

    // 模拟追踪器独占匹配
    const trackedEntities = new Map<string, any>()
    const matchedIdsInCurrentFrame = new Set<string>()
    let entityCounter = 0

    for (const det of detections) {
      let matchedId: string | null = null
      let minDist = 0.08

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
      } else {
        entityCounter++
        const newId = `track_${det.team}_${entityCounter}`
        trackedEntities.set(newId, {
          trackId: newId,
          team: det.team,
          point: { x: det.x, y: det.y }
        })
        matchedIdsInCurrentFrame.add(newId)
      }
    }

    // 两个敌人在同一帧中必须生成 2 个独立的 Track ID，严禁合并
    expect(trackedEntities.size).toBe(2)
    expect(Array.from(trackedEntities.keys())).toEqual(['track_enemy_1', 'track_enemy_2'])
  })
})
