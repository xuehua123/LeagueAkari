import { describe, expect, it } from 'vitest'

import {
  TrackedEntity,
  extractConnectedComponents,
  getMapRegion,
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

    // 模拟具有真实地形纹理与方差的峡谷小地图背景
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const val = ((x * 7 + y * 13) % 60) + 30
        buffer[idx] = val
        buffer[idx + 1] = val
        buffer[idx + 2] = val
        buffer[idx + 3] = 255
      }
    }

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

  it('accurately classifies summoner rift geometry: mid lane along x+y=1, river along x=y, top lane and bot lane', () => {
    // 1. 中路主轴 (x + y = 1)
    expect(getMapRegion(0.5, 0.5)).toBe('mid_lane')
    expect(getMapRegion(0.3, 0.7)).toBe('mid_lane')
    expect(getMapRegion(0.7, 0.3)).toBe('mid_lane')

    // 2. 河道主轴 (x = y)
    expect(getMapRegion(0.3, 0.3)).toBe('top_river')
    expect(getMapRegion(0.7, 0.7)).toBe('bot_river')

    // 3. 上路与下路
    expect(getMapRegion(0.1, 0.2)).toBe('top_lane')
    expect(getMapRegion(0.2, 0.1)).toBe('top_lane')
    expect(getMapRegion(0.9, 0.8)).toBe('bot_lane')
    expect(getMapRegion(0.8, 0.9)).toBe('bot_lane')

    // 4. 野区
    expect(getMapRegion(0.2, 0.45)).toBe('top_jungle')
    expect(getMapRegion(0.8, 0.55)).toBe('bot_jungle')
  })

  it('correctly reports degraded health for pure black, pure white, pure grey, or flat blank occlusion frames', () => {
    const width = 100
    const height = 100
    const trackedEntities = new Map<string, TrackedEntity>()
    const getNewEntityId = (team: string) => `track_${team}_1`

    // 1. 纯黑画面 (0, 0, 0)
    const blackBuffer = new Uint8Array(width * height * 4)
    expect(
      processMinimapFrameWithState(
        blackBuffer,
        width,
        height,
        Date.now(),
        'bgra',
        trackedEntities,
        getNewEntityId
      ).health
    ).toBe('degraded')

    // 2. 纯灰遮挡画面 (128, 128, 128)
    const greyBuffer = new Uint8Array(width * height * 4)
    greyBuffer.fill(128)
    expect(
      processMinimapFrameWithState(
        greyBuffer,
        width,
        height,
        Date.now(),
        'bgra',
        trackedEntities,
        getNewEntityId
      ).health
    ).toBe('degraded')

    // 3. 纯白画面 (255, 255, 255)
    const whiteBuffer = new Uint8Array(width * height * 4)
    whiteBuffer.fill(255)
    expect(
      processMinimapFrameWithState(
        whiteBuffer,
        width,
        height,
        Date.now(),
        'bgra',
        trackedEntities,
        getNewEntityId
      ).health
    ).toBe('degraded')
  })

  it('detects frozen texture frames when pixel contents remain identical for 15+ consecutive ticks', () => {
    const width = 100
    const height = 100
    const buffer = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const val = ((x * 7 + y * 13) % 60) + 30
        buffer[idx] = val
        buffer[idx + 1] = val
        buffer[idx + 2] = val
        buffer[idx + 3] = 255
      }
    }

    const trackedEntities = new Map<string, TrackedEntity>()
    const getNewEntityId = (team: string) => `track_${team}_1`
    const cvState = {
      consecutiveFrozenFrames: 0,
      lastFrameHash: 0
    }

    // 前 14 帧为 healthy
    for (let i = 0; i < 14; i++) {
      const res = processMinimapFrameWithState(
        buffer,
        width,
        height,
        Date.now() + i * 66,
        'bgra',
        trackedEntities,
        getNewEntityId,
        cvState
      )
      expect(res.health).toBe('healthy')
    }

    // 第 15 帧完全静止，判定为 degraded
    const frozenRes = processMinimapFrameWithState(
      buffer,
      width,
      height,
      Date.now() + 15 * 66,
      'bgra',
      trackedEntities,
      getNewEntityId,
      cvState
    )
    expect(frozenRes.health).toBe('degraded')
    expect(frozenRes.entities).toEqual([])
  })
})
