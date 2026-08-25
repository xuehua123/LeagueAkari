import { describe, expect, it } from 'vitest'

import {
  TrackedEntity,
  extractConnectedComponents,
  processMinimapFrameWithState
} from './minimap-cv'

describe('Minimap Observer CV & Tracking Algorithms (minimap-cv)', () => {
  it('correctly clusters a contiguous block of red pixels into a single CCL detection with accurate centroid', () => {
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

  it('distinguishes two adjacent enemy heroes and maintains distinct tracks in production processMinimapFrameWithState', () => {
    const width = 100
    const height = 100
    const buffer = new Uint8Array(width * height * 4)
    buffer.fill(40) // 模拟峡谷地形底色

    // 英雄 1: 位于 (20, 20) 区域 (5x5 红色块)
    for (let y = 20; y < 25; y++) {
      for (let x = 20; x < 25; x++) {
        const idx = (y * width + x) * 4
        buffer[idx] = 0
        buffer[idx + 1] = 0
        buffer[idx + 2] = 255
        buffer[idx + 3] = 255
      }
    }

    // 英雄 2: 位于 (28, 20) 区域 (5x5 红色块，邻近英雄)
    for (let y = 20; y < 25; y++) {
      for (let x = 28; x < 33; x++) {
        const idx = (y * width + x) * 4
        buffer[idx] = 0
        buffer[idx + 1] = 0
        buffer[idx + 2] = 255
        buffer[idx + 3] = 255
      }
    }

    const trackedEntities = new Map<string, TrackedEntity>()
    let entityCounter = 0
    const getNewEntityId = (team: string) => {
      entityCounter++
      return `track_${team}_${entityCounter}`
    }

    const result = processMinimapFrameWithState(
      buffer,
      width,
      height,
      Date.now(),
      'bgra',
      trackedEntities,
      getNewEntityId
    )

    expect(result.health).toBe('healthy')
    expect(result.entities.length).toBe(2)
    expect(result.entities.map((e) => e.trackId)).toEqual(['track_enemy_1', 'track_enemy_2'])
  })
})
