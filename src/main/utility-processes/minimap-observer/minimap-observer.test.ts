import { describe, expect, it } from 'vitest'

import {
  ChampionIconClassifier,
  TrackedEntity,
  classifyChampionPatch,
  computeFrameHash,
  deriveMinimapEvents,
  extractConnectedComponents,
  getMapRegion,
  processMinimapFrameWithState
} from './minimap-cv'

describe('Minimap Observer CV & Tracking Algorithms (minimap-cv)', () => {
  it('fails closed when frame dimensions do not match the pixel buffer', async () => {
    const trackedEntities = new Map<string, TrackedEntity>()

    expect(
      await processMinimapFrameWithState(
        new Uint8Array(99),
        5,
        5,
        Date.now(),
        'bgra',
        trackedEntities,
        () => 'unused'
      )
    ).toEqual({ health: 'unknown', entities: [] })
    expect(trackedEntities.size).toBe(0)
  })

  it('derives visible-count, region-change, and grouping events from adjacent tracked snapshots', () => {
    const createEnemy = (trackId: string, regionId: string) => ({
      trackId,
      kind: 'enemy' as const,
      team: 'enemy' as const,
      championId: null,
      point: { x: 0.5, y: 0.5 },
      regionId,
      confidence: 0.9,
      lifecycle: 'confirmed' as const,
      firstObservedAt: 1000,
      lastObservedAt: 2000,
      expiresAt: 7000
    })
    const previous = [createEnemy('enemy-1', 'mid_lane')]
    const current = [
      createEnemy('enemy-1', 'bot_river'),
      createEnemy('enemy-2', 'bot_river'),
      createEnemy('enemy-3', 'bot_river')
    ]

    const events = deriveMinimapEvents(previous, current, 2000)

    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        'enemy-visible-count-increased',
        'enemy-region-changed',
        'enemy-grouping-started'
      ])
    )
    expect(events.find((event) => event.kind === 'enemy-grouping-started')?.payload).toEqual({
      regionId: 'bot_river',
      count: 3
    })
  })

  it('derives visible approach and pincer predictions only from consecutive direct observations', () => {
    const entity = (
      trackId: string,
      kind: 'self' | 'enemy',
      x: number,
      y: number,
      regionId: string
    ) => ({
      trackId,
      kind,
      team: kind === 'self' ? ('ally' as const) : ('enemy' as const),
      championId: kind === 'self' ? 103 : null,
      point: { x, y },
      regionId,
      confidence: 0.95,
      lifecycle: 'confirmed' as const,
      firstObservedAt: 1000,
      lastObservedAt: 2000,
      expiresAt: 7000
    })
    const previous = [
      entity('self', 'self', 0.5, 0.5, 'mid_lane'),
      entity('enemy-left', 'enemy', 0.2, 0.5, 'top_jungle'),
      entity('enemy-right', 'enemy', 0.8, 0.5, 'bot_jungle')
    ]
    const current = [
      entity('self', 'self', 0.5, 0.5, 'mid_lane'),
      entity('enemy-left', 'enemy', 0.23, 0.5, 'top_jungle'),
      entity('enemy-right', 'enemy', 0.77, 0.5, 'bot_jungle')
    ]

    const kinds = deriveMinimapEvents(previous, current, 2200).map((event) => event.kind)
    expect(kinds).toContain('enemy-approaching-player-region')
    expect(kinds).toContain('visible-pincer-approach-predicted')

    const noSelfKinds = deriveMinimapEvents(
      previous.filter((item) => item.kind !== 'self'),
      current.filter((item) => item.kind !== 'self'),
      2300
    ).map((event) => event.kind)
    expect(noSelfKinds).not.toContain('enemy-approaching-player-region')
    expect(noSelfKinds).not.toContain('visible-pincer-approach-predicted')
  })

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

  it('distinguishes two adjacent enemy heroes and maintains distinct tracks in production processMinimapFrameWithState', async () => {
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

    const result = await processMinimapFrameWithState(
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

  it('passes icon patches to the configured classifier and confirms identity after three votes', async () => {
    const width = 100
    const height = 100
    const buffer = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const value = ((x * 7 + y * 13) % 60) + 30
        buffer[idx] = value
        buffer[idx + 1] = value
        buffer[idx + 2] = value
        buffer[idx + 3] = 255
      }
    }
    for (let y = 20; y < 25; y++) {
      for (let x = 20; x < 25; x++) {
        const idx = (y * width + x) * 4
        buffer[idx] = 0
        buffer[idx + 1] = 0
        buffer[idx + 2] = 255
        buffer[idx + 3] = 255
      }
    }

    const classifier: ChampionIconClassifier = {
      isReady: () => true,
      getManifest: () => ({
        modelName: 'test-champion-icons',
        version: '1.0.0',
        sha256: 'test',
        inputShape: [1, 4, 16, 16],
        confidenceThreshold: 0.75,
        classes: ['103']
      }),
      classifyIconPatch: (_patch, patchWidth, patchHeight, candidates) => {
        expect(patchWidth).toBe(16)
        expect(patchHeight).toBe(16)
        expect(candidates).toEqual([103])
        return { championId: 103, confidence: 0.92, top2Margin: 0.3 }
      }
    }
    const trackedEntities = new Map<string, TrackedEntity>()
    const getNewEntityId = (team: string) => `track_${team}_1`

    let result = await processMinimapFrameWithState(
      buffer,
      width,
      height,
      1_000,
      'bgra',
      trackedEntities,
      getNewEntityId,
      undefined,
      [103],
      classifier
    )
    result = await processMinimapFrameWithState(
      buffer,
      width,
      height,
      1_100,
      'bgra',
      trackedEntities,
      getNewEntityId,
      undefined,
      [103],
      classifier
    )
    result = await processMinimapFrameWithState(
      buffer,
      width,
      height,
      1_200,
      'bgra',
      trackedEntities,
      getNewEntityId,
      undefined,
      [103],
      classifier
    )
    result = await processMinimapFrameWithState(
      buffer,
      width,
      height,
      1_300,
      'bgra',
      trackedEntities,
      getNewEntityId,
      undefined,
      [103],
      classifier
    )

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0].championId).toBe(103)
  })

  it('rejects classifier answers outside the current match candidate roster', async () => {
    const width = 100
    const height = 100
    const buffer = new Uint8Array(width * height * 4)
    for (let i = 0; i < buffer.length; i += 4) {
      const value = ((i / 4) % 53) + 30
      buffer[i] = value
      buffer[i + 1] = value
      buffer[i + 2] = value
      buffer[i + 3] = 255
    }

    const classifier: ChampionIconClassifier = {
      isReady: () => true,
      getManifest: () => ({
        modelName: 'bad-adapter',
        version: '1.0.0',
        sha256: 'test',
        inputShape: [1, 4, 16, 16],
        confidenceThreshold: 0.75,
        classes: ['103', '238']
      }),
      classifyIconPatch: () => ({ championId: 238, confidence: 0.99, top2Margin: 0.9 })
    }

    expect(
      await classifyChampionPatch(buffer, width, height, 0.5, 0.5, 'bgra', [103], classifier)
    ).toBeNull()
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

  it('correctly reports degraded health for pure black, pure white, pure grey, or flat blank occlusion frames', async () => {
    const width = 100
    const height = 100
    const trackedEntities = new Map<string, TrackedEntity>()
    const getNewEntityId = (team: string) => `track_${team}_1`

    // 1. 纯黑画面 (0, 0, 0)
    const blackBuffer = new Uint8Array(width * height * 4)
    expect(
      (
        await processMinimapFrameWithState(
          blackBuffer,
          width,
          height,
          Date.now(),
          'bgra',
          trackedEntities,
          getNewEntityId
        )
      ).health
    ).toBe('degraded')

    // 2. 纯灰遮挡画面 (128, 128, 128)
    const greyBuffer = new Uint8Array(width * height * 4)
    greyBuffer.fill(128)
    expect(
      (
        await processMinimapFrameWithState(
          greyBuffer,
          width,
          height,
          Date.now(),
          'bgra',
          trackedEntities,
          getNewEntityId
        )
      ).health
    ).toBe('degraded')

    // 3. 纯白画面 (255, 255, 255)
    const whiteBuffer = new Uint8Array(width * height * 4)
    whiteBuffer.fill(255)
    expect(
      (
        await processMinimapFrameWithState(
          whiteBuffer,
          width,
          height,
          Date.now(),
          'bgra',
          trackedEntities,
          getNewEntityId
        )
      ).health
    ).toBe('degraded')
  })

  it('detects frozen texture frames when pixel contents remain identical for 15+ consecutive ticks', async () => {
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
      const res = await processMinimapFrameWithState(
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
    const frozenRes = await processMinimapFrameWithState(
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

  it('differentiates small 5x5 icon movements in a 250x250 frame and resets frozen counter without false degradation', async () => {
    const width = 250
    const height = 250
    const frameA = new Uint8Array(width * height * 4)
    // 填充底图纹理（高方差真实小地图底色）
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const val = ((x * 7 + y * 13) % 180) + 30
        frameA[idx] = val
        frameA[idx + 1] = (val * 2) % 255
        frameA[idx + 2] = (val * 3) % 255
        frameA[idx + 3] = 255
      }
    }

    const frameB = new Uint8Array(frameA)
    // 在 (120, 120) 处绘制一个 5x5 的小英雄图标移动
    for (let y = 120; y < 125; y++) {
      for (let x = 120; x < 125; x++) {
        const idx = (y * width + x) * 4
        frameB[idx] = 255 // 改变像素
        frameB[idx + 1] = 0
        frameB[idx + 2] = 0
        frameB[idx + 3] = 255
      }
    }

    // 验证全量 32-bit 双哈希能够精确捕获 5x5 小图标运动，产生不同哈希值
    const hashA = computeFrameHash(frameA)
    const hashB = computeFrameHash(frameB)
    expect(hashA).not.toBe(hashB)

    const trackedEntities = new Map<string, TrackedEntity>()
    const getNewEntityId = (team: string) => `track_${team}_1`
    const cvState = {
      consecutiveFrozenFrames: 10,
      lastFrameHash: hashA
    }

    // 传入发生运动的 frameB，验证连续冻结帧计数器被成功重置为 1
    const res = await processMinimapFrameWithState(
      frameB,
      width,
      height,
      Date.now(),
      'bgra',
      trackedEntities,
      getNewEntityId,
      cvState
    )
    expect(cvState.consecutiveFrozenFrames).toBe(1)
    expect(cvState.lastFrameHash).toBe(hashB)
    expect(res.health).toBe('healthy')
  })

  it('safely computes frame hash on unaligned Uint8Array slices without RangeError', () => {
    // 构造非 4 字节对齐的 ArrayBuffer 视图 (byteOffset = 1, 2, 3)
    const rawBuffer = new ArrayBuffer(127)
    const u8Offset1 = new Uint8Array(rawBuffer, 1, 120)
    for (let i = 0; i < u8Offset1.length; i++) {
      u8Offset1[i] = (i * 17) % 256
    }

    expect(() => {
      const hash = computeFrameHash(u8Offset1)
      expect(typeof hash).toBe('number')
    }).not.toThrow()

    const u8Offset3 = new Uint8Array(rawBuffer, 3, 115)
    expect(() => {
      const hash = computeFrameHash(u8Offset3)
      expect(typeof hash).toBe('number')
    }).not.toThrow()
  })
})
