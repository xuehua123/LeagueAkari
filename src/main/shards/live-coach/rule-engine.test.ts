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

  it('correctly provides champion-specific item guidance (Smolder vs Garen vs Ahri) and triggers only when affordable', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 1. 测试斯莫德 Smolder（射手，持有多兰之刃，1300 金币） -> 必须推荐暴风之剑/无尽之刃，绝不能误判为 86 / 战士
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_smolder',
        patch: '14.15.1',
        gameTimeSeconds: 480,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'SmolderMain',
          riotId: 'Smolder#CN',
          riotIdGameName: 'Smolder',
          riotIdTagLine: 'CN',
          championName: 'Smolder',
          level: 7,
          currentGold: 1300,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'SmolderMain',
            riotId: 'Smolder#CN',
            riotIdGameName: 'Smolder',
            riotIdTagLine: 'CN',
            championName: 'Smolder',
            championId: 901,
            team: 'ORDER',
            position: 'BOTTOM',
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
                displayName: '多兰之刃',
                itemID: 1055,
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

    const smolderCues = engine.evaluate({
      sessionId: 'sess_smolder',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      currentTime: now
    })

    const smolderItemCue = smolderCues.find((c) => c.ruleId === 'rule_item_purchase_guidance')
    expect(smolderItemCue).toBeDefined()
    expect(smolderItemCue?.observationText).toContain('1300g')
    const primaryOption = smolderItemCue?.options.find((o) => o.role === 'primary')
    expect(primaryOption?.condition).toMatch(/(暴风之剑|无尽之刃|暴击)/)
    expect(primaryOption?.condition).not.toContain('挺进破坏者')

    // 2. 测试金币不足时（例如玩家只有 500g，买不起 1300g 暴风之剑且没有其他可买组件）不应触发购买建议
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_smolder_poor',
        patch: '14.15.1',
        gameTimeSeconds: 500,
        clock: { observedAt: now + 50000, receivedAt: now + 50000, sequence: 2 },
        activePlayer: {
          summonerName: 'SmolderMain',
          riotId: 'Smolder#CN',
          riotIdGameName: 'Smolder',
          riotIdTagLine: 'CN',
          championName: 'Smolder',
          level: 7,
          currentGold: 200, // 只有 200g，买不起任何组件
          team: 'ORDER',
          abilities: {}
        },
        players: [],
        events: [],
        sourceHealth: []
      },
      now + 50000
    )

    const poorCues = engine.evaluate({
      sessionId: 'sess_smolder_poor',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      currentTime: now + 50000
    })
    expect(poorCues.find((c) => c.ruleId === 'rule_item_purchase_guidance')).toBeUndefined()
  })

  it('correctly calculates dynamic arrivalWindow in FogInference, includes fog evidence in Cue and handles reappearance cancellation', () => {
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
    // 验证 Fog Cue 明确包含了 evi_fog_ 证据
    expect(fogCue?.evidenceIds.some((id) => id.includes('evi_fog_'))).toBe(true)

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
    // 验证失效回调中的 ID 能够命中 fogCue.evidenceIds
    const hasOverlap = fogCue?.evidenceIds.some((id) => invalidatedIds.includes(id))
    expect(hasOverlap).toBe(true)
  })

  it('correctly schedules next upcoming objective without alive dragons shadowing Baron at 20:00', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 游戏时间 19:35 (1175s)，首条巨龙在 5:00 已刷新且未被击杀（一直存活）
    // 此时男爵将在 20:00 (1200s) 刷新，距离男爵刷新还有 25 秒
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_baron',
        patch: '14.15.1',
        gameTimeSeconds: 1175,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'Player1',
          riotId: 'P#CN',
          riotIdGameName: 'P',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 13,
          currentGold: 500,
          team: 'ORDER',
          abilities: {}
        },
        players: [],
        events: [],
        sourceHealth: []
      },
      now
    )

    const schedule = fusion.getNextObjectiveSchedule(1175)
    expect(schedule).toBeDefined()
    expect(schedule?.name).toBe('纳什男爵')
    expect(schedule?.nextSpawnGameTime).toBe(1200)

    const cues = engine.evaluate({
      sessionId: 'sess_baron',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      currentTime: now
    })

    const baronCue = cues.find((c) => c.ruleId === 'rule_objective_spawn')
    expect(baronCue).toBeDefined()
    expect(baronCue?.observationText).toContain('纳什男爵 即将在 25 秒内刷新')
  })

  it('ignores invalidated minimap entities without cancelling fog inferences prematurely', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000
    const invalidatedIds: string[] = []
    fusion.onEvidenceInvalidated = (ids) => invalidatedIds.push(...ids)

    // 1. 敌人最初在小地图可见
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_inv',
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 15 },
        health: 'healthy',
        entities: [
          {
            trackId: 'track_enemy_1',
            kind: 'enemy',
            team: 'enemy',
            championId: 238,
            point: { x: 0.5, y: 0.5 },
            regionId: 'mid_lane',
            confidence: 0.9,
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

    // 2. 5 秒后敌人消失在迷雾中，生成 FogInference
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_inv',
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now + 5000, receivedAt: now + 5000, sequence: 2, ageMs: 15 },
        health: 'healthy',
        entities: [],
        events: []
      },
      now + 5000
    )
    expect(fusion.getFogInferences(now + 5000).length).toBe(1)

    // 3. 收到 worker 输出的 invalidated 轨迹帧 -> 绝不能当作重新出现，不应撤销 FogInference！
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_inv',
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now + 6000, receivedAt: now + 6000, sequence: 3, ageMs: 15 },
        health: 'healthy',
        entities: [
          {
            trackId: 'track_enemy_1',
            kind: 'enemy',
            team: 'enemy',
            championId: 238,
            point: { x: 0.5, y: 0.5 },
            regionId: 'mid_lane',
            confidence: 0.2,
            lifecycle: 'invalidated',
            firstObservedAt: now,
            lastObservedAt: now + 6000,
            expiresAt: now + 7000
          }
        ],
        events: []
      },
      now + 6000
    )

    // FogInference 依然有效，未被误杀
    expect(fusion.getFogInferences(now + 6000).length).toBe(1)
  })

  it('suppresses fog inferences for dead enemy champions by matching championId', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 1. 劫在小地图可见，trackId 为 track_enemy_1，championId 为 238
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_dead',
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 15 },
        health: 'healthy',
        entities: [
          {
            trackId: 'track_enemy_1',
            kind: 'enemy',
            team: 'enemy',
            championId: 238,
            point: { x: 0.5, y: 0.5 },
            regionId: 'mid_lane',
            confidence: 0.9,
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

    // 2. 劫阵亡，LiveGameData 汇报 championId 238 处于 isDead: true 状态
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_dead',
        patch: '14.15.1',
        gameTimeSeconds: 500,
        clock: { observedAt: now + 5000, receivedAt: now + 5000, sequence: 2 },
        activePlayer: {
          summonerName: 'SelfPlayer',
          riotId: 'Self#CN',
          riotIdGameName: 'Self',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 6,
          currentGold: 500,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'EnemyZedPlayer',
            riotId: 'Zed#CN',
            riotIdGameName: 'Zed',
            riotIdTagLine: 'CN',
            championName: 'Zed',
            championId: 238,
            team: 'CHAOS',
            position: 'MIDDLE',
            isDead: true,
            respawnTimer: 25,
            items: []
          } as any
        ],
        events: [],
        sourceHealth: []
      },
      now + 5000
    )

    // 3. 运行时检查：死亡的劫绝不产生 FogInference
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_dead',
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now + 5000, receivedAt: now + 5000, sequence: 3, ageMs: 15 },
        health: 'healthy',
        entities: [],
        events: []
      },
      now + 5000
    )

    expect(fusion.getFogInferences(now + 5000).length).toBe(0)
  })

  it('correctly handles red side (CHAOS) player and checks blue side (ORDER) enemy jungler', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 玩家在红方 CHAOS
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_red',
        patch: '14.15.1',
        gameTimeSeconds: 300, // 5 分钟（对线期）
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'RedPlayer',
          riotId: 'Red#CN',
          riotIdGameName: 'Red',
          riotIdTagLine: 'CN',
          championName: 'Darius',
          level: 5,
          currentGold: 400,
          team: 'CHAOS',
          abilities: {}
        },
        players: [
          {
            summonerName: 'RedPlayer',
            riotId: 'Red#CN',
            riotIdGameName: 'Red',
            riotIdTagLine: 'CN',
            championName: 'Darius',
            championId: 122,
            team: 'CHAOS',
            position: 'TOP',
            isDead: false,
            respawnTimer: 0,
            items: []
          } as any,
          {
            summonerName: 'BlueEnemyJungler',
            riotId: 'Lee#CN',
            riotIdGameName: 'Lee',
            riotIdTagLine: 'CN',
            championName: 'LeeSin',
            championId: 64,
            team: 'ORDER', // 敌方打野在 ORDER 蓝方
            position: 'JUNGLE',
            isDead: false,
            respawnTimer: 0,
            items: []
          } as any
        ],
        events: [],
        sourceHealth: []
      },
      now
    )

    // 敌方打野在小地图未出现 -> 触发防抓提醒
    const cues = engine.evaluate({
      sessionId: 'sess_red',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-basic']),
      currentTime: now
    })

    const tacticsCue = cues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')
    expect(tacticsCue).toBeDefined()
    expect(tacticsCue?.observationText).toContain('敌方打野位置在迷雾中未知')

    // 验证 Evidence 中记录了正确的敌方打野与己方阵营
    const evi = fusion.getEvidence(tacticsCue!.evidenceIds[0])
    expect((evi?.payload as any).myTeam).toBe('CHAOS')
    expect((evi?.payload as any).enemyJunglerChampionId).toBe(64)
  })

  it('enforces capability gates: disabled capability skips rule evaluation completely', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 准备数据
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_gate',
        patch: '14.15.1',
        gameTimeSeconds: 300,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'P1',
          riotId: 'P#CN',
          riotIdGameName: 'P',
          riotIdTagLine: 'CN',
          championName: 'Ahri',
          level: 6,
          currentGold: 3200,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'P1',
            riotId: 'P#CN',
            riotIdGameName: 'P',
            riotIdTagLine: 'CN',
            championName: 'Ahri',
            championId: 103,
            team: 'ORDER',
            position: 'MIDDLE',
            isDead: false,
            respawnTimer: 0,
            items: []
          } as any
        ],
        events: [],
        sourceHealth: []
      },
      now
    )

    // 1. 当 enabledCapabilities 中不包含 'coach.guidance.item-purchase' 时，装备规则绝不执行
    const cuesWithoutCap = engine.evaluate({
      sessionId: 'sess_gate',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-basic']),
      currentTime: now
    })
    expect(cuesWithoutCap.find((c) => c.ruleId === 'rule_item_purchase_guidance')).toBeUndefined()

    // 2. 当包含 'coach.guidance.item-purchase' 时，装备规则正常产出
    const cuesWithCap = engine.evaluate({
      sessionId: 'sess_gate',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.guidance.item-purchase']),
      currentTime: now
    })
    expect(cuesWithCap.find((c) => c.ruleId === 'rule_item_purchase_guidance')).toBeDefined()
  })
})
