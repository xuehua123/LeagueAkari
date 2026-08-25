import { describe, expect, it } from 'vitest'

import { FactFusionEngine } from './fact-fusion'
import { CoachRuleEngine } from './rule-engine'

describe('CoachRuleEngine & Phase 1 Rules', () => {
  it('correctly triggers enemy grouping only when enemies are spatially clustered', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = Date.now()

    // 1. 三个敌人分散在全图（距离 > 0.18），不应触发聚集
    fusion.updateMinimapBatch({
      sessionId: 'sess_1',
      patch: '14.15.1',
      calibrationVersion: '1.0.0',
      modelVersions: {},
      frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 20 },
      health: 'healthy',
      entities: [
        {
          trackId: 'e1',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.1, y: 0.1 }, // 上路
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        },
        {
          trackId: 'e2',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.5, y: 0.5 }, // 中路
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        },
        {
          trackId: 'e3',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.9, y: 0.9 }, // 下路
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ],
      events: []
    })

    let cues = engine.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true }
    })
    expect(cues.find((c) => c.ruleId === 'rule_minimap_enemy_grouping')).toBeUndefined()

    // 2. 三个敌人在局部聚集（距离 < 0.18），应该触发聚集预警并包含正确的 Evidence ID
    fusion.updateMinimapBatch({
      sessionId: 'sess_1',
      patch: '14.15.1',
      calibrationVersion: '1.0.0',
      modelVersions: {},
      frame: { observedAt: now + 100, receivedAt: now + 100, sequence: 2, ageMs: 20 },
      health: 'healthy',
      entities: [
        {
          trackId: 'e1',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.5, y: 0.5 },
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        },
        {
          trackId: 'e2',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.53, y: 0.52 },
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        },
        {
          trackId: 'e3',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.51, y: 0.49 },
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ],
      events: []
    })

    cues = engine.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true }
    })
    const groupingCue = cues.find((c) => c.ruleId === 'rule_minimap_enemy_grouping')
    expect(groupingCue).toBeDefined()
    expect(groupingCue?.evidenceIds.length).toBe(3)
    for (const eviId of groupingCue!.evidenceIds) {
      expect(fusion.getEvidence(eviId)).toBeDefined()
    }
  })

  it('correctly triggers FogInference when enemy disappears into fog and ItemPurchaseGuidance when gold is sufficient', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = Date.now()

    // 1. 模拟敌方中单在 8 秒前被看见后进入迷雾
    fusion.updateMinimapBatch({
      sessionId: 'sess_2',
      patch: '14.15.1',
      calibrationVersion: '1.0.0',
      modelVersions: {},
      frame: { observedAt: now - 8000, receivedAt: now - 8000, sequence: 1, ageMs: 15 },
      health: 'healthy',
      entities: [
        {
          trackId: 'enemy_mid_zed',
          kind: 'enemy',
          team: 'enemy',
          championId: 238,
          point: { x: 0.5, y: 0.5 },
          regionId: 'mid_lane',
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now - 8000,
          lastObservedAt: now - 8000,
          expiresAt: now - 3000
        }
      ],
      events: []
    })

    // 当前帧该英雄在迷雾中
    fusion.updateMinimapBatch({
      sessionId: 'sess_2',
      patch: '14.15.1',
      calibrationVersion: '1.0.0',
      modelVersions: {},
      frame: { observedAt: now, receivedAt: now, sequence: 2, ageMs: 15 },
      health: 'healthy',
      entities: [],
      events: []
    })

    // 2. 模拟自身金币充足 (1300g)
    fusion.updateLiveGameSnapshot({
      sessionId: 'sess_2',
      patch: '14.15.1',
      gameTimeSeconds: 480,
      clock: { observedAt: now, receivedAt: now, sequence: 2 },
      activePlayer: {
        summonerName: 'TestPlayer',
        riotId: 'Test#CN',
        riotIdGameName: 'Test',
        riotIdTagLine: 'CN',
        championName: 'Ahri',
        level: 7,
        currentGold: 1300,
        team: 'ORDER',
        abilities: {}
      },
      players: [],
      events: [],
      sourceHealth: []
    })

    const cues = engine.evaluate({
      sessionId: 'sess_2',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true }
    })

    const fogCue = cues.find((c) => c.ruleId === 'rule_fog_inference')
    expect(fogCue).toBeDefined()
    expect(fogCue?.observationText).toContain('迷雾推断')

    const itemCue = cues.find((c) => c.ruleId === 'rule_item_purchase_guidance')
    expect(itemCue).toBeDefined()
    expect(itemCue?.observationText).toContain('1300g')
    expect(itemCue?.options.length).toBeGreaterThanOrEqual(1)
  })
})
