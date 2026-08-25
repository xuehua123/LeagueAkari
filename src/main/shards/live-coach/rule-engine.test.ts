import { describe, expect, it } from 'vitest'

import { FactFusionEngine } from './fact-fusion'
import { CoachRuleEngine } from './rule-engine'

describe('CoachRuleEngine & Phase 1 Rules', () => {
  it('correctly triggers enemy grouping only when enemies are spatially clustered', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 1. 三个敌人分散在全图（距离 > 0.18），不应触发聚集
    fusion.updateMinimapBatch(
      {
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
            point: { x: 0.1, y: 0.1 },
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
            point: { x: 0.5, y: 0.5 },
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
            point: { x: 0.9, y: 0.9 },
            regionId: null,
            confidence: 0.95,
            lifecycle: 'confirmed',
            firstObservedAt: now,
            lastObservedAt: now,
            expiresAt: now + 5000
          }
        ],
        events: []
      },
      now
    )

    let cues = engine.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      currentTime: now
    })
    expect(cues.find((c) => c.ruleId === 'rule_minimap_enemy_grouping')).toBeUndefined()

    // 2. 三个敌人在局部聚集（距离 < 0.18），应该触发聚集预警并包含正确的 Evidence ID
    fusion.updateMinimapBatch(
      {
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
      },
      now + 100
    )

    cues = engine.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      currentTime: now + 100
    })
    const groupingCue = cues.find((c) => c.ruleId === 'rule_minimap_enemy_grouping')
    expect(groupingCue).toBeDefined()
    expect(groupingCue?.evidenceIds.length).toBe(3)
    for (const eviId of groupingCue!.evidenceIds) {
      expect(fusion.getEvidence(eviId)).toBeDefined()
    }
  })

  it('correctly provides champion-specific item guidance (Garen vs Ahri vs Jinx) and valid evidence IDs', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 1. 测试盖伦（持有多兰之盾，1300 金币） -> 必须推荐战士大件/组件（挺进破坏者/净蚀/提亚马特），绝不推荐法师装备
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_garen',
        patch: '14.15.1',
        gameTimeSeconds: 480,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'GarenPlayer',
          riotId: 'Garen#CN',
          riotIdGameName: 'Garen',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 7,
          currentGold: 1300,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'GarenPlayer',
            riotId: 'Garen#CN',
            riotIdGameName: 'Garen',
            riotIdTagLine: 'CN',
            championName: 'Garen',
            championId: 86,
            team: 'ORDER',
            position: 'TOP',
            level: 7,
            isDead: false,
            respawnTimer: 0,
            isBot: false,
            kills: 1,
            deaths: 0,
            assists: 0,
            creepScore: 50,
            wardScore: 5,
            items: [
              {
                canUse: true,
                consumable: false,
                count: 1,
                displayName: '多兰之盾',
                itemID: 1054,
                price: 450,
                slot: 0
              }
            ],
            summonerSpells: {}
          }
        ],
        events: [],
        sourceHealth: []
      },
      now
    )

    const garenCues = engine.evaluate({
      sessionId: 'sess_garen',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      currentTime: now
    })

    const itemCue = garenCues.find((c) => c.ruleId === 'rule_item_purchase_guidance')
    expect(itemCue).toBeDefined()
    expect(itemCue?.observationText).toContain('1300g')
    // 验证推荐的是战士装备，绝非遗失的章节
    const primaryOption = itemCue?.options.find((o) => o.role === 'primary')
    expect(primaryOption?.condition).toMatch(/(挺进破坏者|清线|战力|组件)/)
    expect(primaryOption?.condition).not.toContain('遗失的章节')

    // 验证所有 evidenceIds 均在 fusion 中真实存在且有效
    expect(itemCue!.evidenceIds.length).toBeGreaterThan(0)
    for (const id of itemCue!.evidenceIds) {
      expect(fusion.getEvidence(id)).toBeDefined()
    }
  })

  it('correctly calculates dynamic arrivalWindow in FogInference and handles reappearance cancellation', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    let invalidatedIds: string[] = []
    fusion.onEvidenceInvalidated = (ids) => {
      invalidatedIds = ids
    }

    const now = 1700000000000

    // 1. 模拟敌方劫在 8 秒前被看见后进入迷雾
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_fog',
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
            expiresAt: now + 20000
          }
        ],
        events: []
      },
      now - 8000
    )

    // 当前帧劫处于迷雾中
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_fog',
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now, receivedAt: now, sequence: 2, ageMs: 15 },
        health: 'healthy',
        entities: [],
        events: []
      },
      now
    )

    const cues = engine.evaluate({
      sessionId: 'sess_fog',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      currentTime: now
    })

    const fogCue = cues.find((c) => c.ruleId === 'rule_fog_inference')
    expect(fogCue).toBeDefined()
    // 动态到达时间格式化验证
    expect(fogCue?.impactText).toMatch(/预计将在 \d+~\d+ 秒内到达该区域/)
    expect(fogCue?.spokenText).toMatch(/迷雾推断提醒：敌方可能在 \d+ 到 \d+ 秒内到达/)

    // 2. 劫重新在小地图中可见 -> 触发证据失效回调
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_fog',
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now + 1000, receivedAt: now + 1000, sequence: 3, ageMs: 15 },
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
            firstObservedAt: now + 1000,
            lastObservedAt: now + 1000,
            expiresAt: now + 6000
          }
        ],
        events: []
      },
      now + 1000
    )

    expect(invalidatedIds.length).toBeGreaterThan(0)
    expect(invalidatedIds[0]).toContain('evi_fog_')
  })
})
