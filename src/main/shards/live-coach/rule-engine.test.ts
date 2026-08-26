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
      patch: '16.16.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.guidance.item-purchase']),
      currentTime: now
    })
    expect(cuesWithCap.find((c) => c.ruleId === 'rule_item_purchase_guidance')).toBeDefined()
  })

  it('correctly handles jungler visibility without artificial championId: suppresses when all living enemies are visible or jungler is dead, and triggers when jungler is in fog', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 2 名敌方存活英雄：LeeSin (Jungle) 和 Zed (Mid)
    const setupGame = (isJunglerDead = false) => {
      fusion.updateLiveGameSnapshot(
        {
          sessionId: 'sess_jg_real',
          patch: '16.16.1',
          gameTimeSeconds: 300,
          clock: { observedAt: now, receivedAt: now, sequence: 1 },
          activePlayer: {
            summonerName: 'MidPlayer',
            riotId: 'Mid#CN',
            riotIdGameName: 'Mid',
            riotIdTagLine: 'CN',
            championName: 'Ahri',
            level: 6,
            currentGold: 1000,
            team: 'ORDER',
            abilities: {}
          },
          players: [
            {
              summonerName: 'MidPlayer',
              riotId: 'Mid#CN',
              riotIdGameName: 'Mid',
              riotIdTagLine: 'CN',
              championName: 'Ahri',
              championId: 103,
              team: 'ORDER',
              position: 'MIDDLE',
              isDead: false,
              respawnTimer: 0,
              items: []
            } as any,
            {
              summonerName: 'EnemyMid',
              riotId: 'Zed#CN',
              riotIdGameName: 'Zed',
              riotIdTagLine: 'CN',
              championName: 'Zed',
              championId: 238,
              team: 'CHAOS',
              position: 'MIDDLE',
              isDead: false,
              respawnTimer: 0,
              items: []
            } as any,
            {
              summonerName: 'EnemyJungler',
              riotId: 'Lee#CN',
              riotIdGameName: 'Lee',
              riotIdTagLine: 'CN',
              championName: 'LeeSin',
              championId: 64,
              team: 'CHAOS',
              position: 'JUNGLE',
              isDead: isJunglerDead,
              respawnTimer: isJunglerDead ? 20 : 0,
              items: []
            } as any
          ],
          events: [],
          sourceHealth: []
        },
        now
      )
    }

    // 1. 当打野存活且小地图只看到 1 个敌人（另 1 个处于迷雾中）且 championId: null 时，必须准确触发防抓提醒
    setupGame(false)
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_jg_real',
        patch: '16.16.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 15 },
        health: 'healthy',
        entities: [
          {
            trackId: 'track_enemy_1',
            kind: 'enemy',
            team: 'enemy',
            championId: null, // 真实生产 CV 输出无 championId
            point: { x: 0.5, y: 0.5 },
            regionId: 'mid_lane',
            confidence: 0.92,
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

    const fogCues = engine.evaluate({
      sessionId: 'sess_jg_real',
      patch: '16.16.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-basic']),
      currentTime: now
    })
    expect(fogCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')).toBeDefined()

    // 2. 当小地图同时观测到 2 个敌人（覆盖全部 2 名存活敌人）时，所有敌方均在视野中，抑制防抓提醒
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_jg_real',
        patch: '16.16.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now + 100, receivedAt: now + 100, sequence: 2, ageMs: 15 },
        health: 'healthy',
        entities: [
          {
            trackId: 'track_enemy_1',
            kind: 'enemy',
            team: 'enemy',
            championId: null,
            point: { x: 0.5, y: 0.5 },
            regionId: 'mid_lane',
            confidence: 0.92,
            lifecycle: 'confirmed',
            firstObservedAt: now,
            lastObservedAt: now + 100,
            expiresAt: now + 5000
          },
          {
            trackId: 'track_enemy_2',
            kind: 'enemy',
            team: 'enemy',
            championId: null,
            point: { x: 0.2, y: 0.2 },
            regionId: 'top_lane',
            confidence: 0.9,
            lifecycle: 'confirmed',
            firstObservedAt: now,
            lastObservedAt: now + 100,
            expiresAt: now + 5000
          }
        ],
        events: []
      },
      now + 100
    )

    const allSeenCues = engine.evaluate({
      sessionId: 'sess_jg_real',
      patch: '16.16.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-basic']),
      currentTime: now + 100
    })
    expect(allSeenCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')).toBeUndefined()

    // 3. 当敌方打野阵亡时，同样自然抑制防抓提醒
    setupGame(true)
    const deadJunglerCues = engine.evaluate({
      sessionId: 'sess_jg_real',
      patch: '16.16.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-basic']),
      currentTime: now + 200
    })
    expect(
      deadJunglerCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')
    ).toBeUndefined()
  })

  it('validates canonical Data Dragon 16.16.1 item catalog and multiset duplicate component deduction (Warmogs)', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 坦克奥恩（已完成第一件日炎圣盾 3068，且拥有 1 个巨人腰带 1011，持有 1000g）
    // 目标第二大件为狂徒铠甲 3083 (3100g)，配方包含 [3801 晶体护臂 800g, 1011 巨人腰带 900g, 1011 巨人腰带 900g]
    // 扣除 1 个 1011 后，剩余未拥有组件为 [3801 晶体护臂 800g, 1011 巨人腰带 900g]，剩余合成花费为 3100 - 900 = 2200g
    // 玩家持有 1000g，买得起第 1 个未拥有组件 3801 晶体护臂 (800g)
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_dd_tank',
        patch: '16.16.1',
        gameTimeSeconds: 500,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'TankPlayer',
          riotId: 'Tank#CN',
          riotIdGameName: 'Tank',
          riotIdTagLine: 'CN',
          championName: 'Ornn',
          level: 7,
          currentGold: 1000,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'TankPlayer',
            riotId: 'Tank#CN',
            riotIdGameName: 'Tank',
            riotIdTagLine: 'CN',
            championName: 'Ornn',
            championId: 516,
            team: 'ORDER',
            position: 'TOP',
            isDead: false,
            respawnTimer: 0,
            items: [
              { itemID: 3068, count: 1 }, // 已完成第 1 核心大件日炎圣盾
              { itemID: 1011, count: 1 } // 持有狂徒铠甲的第 1 个巨人腰带
            ]
          } as any
        ],
        events: [],
        sourceHealth: []
      },
      now
    )

    const guidance = fusion.getItemPurchaseGuidance(now)
    expect(guidance).toBeDefined()
    expect(guidance?.championId).toBe(516)
    // 验证推荐买得起的未拥有组件（3801 晶体护腕），花费 800g
    expect(guidance?.primaryPlan.itemIds).toEqual([3801])
    expect(guidance?.primaryPlan.totalCost).toBe(800)
    expect(guidance?.primaryPlan.missingGold).toBe(0)
  })

  it('correctly applies laner conservation to verify jungler presence in jungle/river', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    const setupLiveMatch = (enemyTopInLane: boolean, enemyMidInLane: boolean) => {
      fusion.updateLiveGameSnapshot(
        {
          sessionId: 'sess_jg_laner_conservation',
          patch: '16.16.1',
          gameTimeSeconds: 300,
          clock: { observedAt: now, receivedAt: now, sequence: 1 },
          activePlayer: {
            summonerName: 'MidPlayer',
            riotId: 'Mid#CN',
            riotIdGameName: 'Mid',
            riotIdTagLine: 'CN',
            championName: 'Ahri',
            level: 6,
            currentGold: 1000,
            team: 'ORDER',
            abilities: {}
          },
          players: [
            {
              summonerName: 'MidPlayer',
              riotId: 'Mid#CN',
              riotIdGameName: 'Mid',
              riotIdTagLine: 'CN',
              championName: 'Ahri',
              championId: 103,
              team: 'ORDER',
              position: 'MIDDLE',
              isDead: false,
              respawnTimer: 0,
              items: []
            } as any,
            {
              summonerName: 'EnemyTop',
              riotId: 'Darius#CN',
              riotIdGameName: 'Darius',
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
              summonerName: 'EnemyMid',
              riotId: 'Zed#CN',
              riotIdGameName: 'Zed',
              riotIdTagLine: 'CN',
              championName: 'Zed',
              championId: 238,
              team: 'CHAOS',
              position: 'MIDDLE',
              isDead: false,
              respawnTimer: 0,
              items: []
            } as any,
            {
              summonerName: 'EnemyJungler',
              riotId: 'Lee#CN',
              riotIdGameName: 'Lee',
              riotIdTagLine: 'CN',
              championName: 'LeeSin',
              championId: 64,
              team: 'CHAOS',
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

      const minimapEntities: any[] = []
      if (enemyTopInLane) {
        minimapEntities.push({
          trackId: 'track_enemy_top',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.1, y: 0.2 },
          regionId: 'top_lane',
          confidence: 0.9,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        })
      }
      if (enemyMidInLane) {
        minimapEntities.push({
          trackId: 'track_enemy_mid',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.5, y: 0.5 },
          regionId: 'mid_lane',
          confidence: 0.9,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        })
      }
      // 河道出现的无名敌方实体
      minimapEntities.push({
        trackId: 'track_enemy_river',
        kind: 'enemy',
        team: 'enemy',
        championId: null,
        point: { x: 0.3, y: 0.3 },
        regionId: 'top_river',
        confidence: 0.9,
        lifecycle: 'confirmed',
        firstObservedAt: now,
        lastObservedAt: now,
        expiresAt: now + 5000
      })

      fusion.updateMinimapBatch(
        {
          sessionId: 'sess_jg_laner_conservation',
          patch: '16.16.1',
          calibrationVersion: '1.0.0',
          modelVersions: {},
          frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 15 },
          health: 'healthy',
          entities: minimapEntities,
          events: []
        },
        now
      )
    }

    // 场景 1：敌方中单脱离中路线位，河道出现无名敌人可能是中单游走而非打野 $\to$ 守线守恒不满足，打野仍然未知，必须报警！
    setupLiveMatch(true, false)
    const roamingCues = engine.evaluate({
      sessionId: 'sess_jg_laner_conservation',
      patch: '16.16.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-basic']),
      currentTime: now
    })
    expect(roamingCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')).toBeDefined()

    // 场景 2：敌方上单在上路、中单在中路，所有存活线上英雄均已在各自线位守线，此时河道额外多出的敌方必然为打野 $\to$ 准确抑制打野未知报警！
    setupLiveMatch(true, true)
    const allLanersPresentCues = engine.evaluate({
      sessionId: 'sess_jg_laner_conservation',
      patch: '16.16.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-basic']),
      currentTime: now
    })
    expect(
      allLanersPresentCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')
    ).toBeUndefined()
  })

  it('handles full inventory (6 slots), control ward occupancy, and adaptive item recommendations', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 场景 1：敌方存在高回复吸血英雄 (Aatrox)，战士亚索自适应推荐重伤装 3123 处刑人的重击 (800g)
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_adaptive_healing',
        patch: '16.16.1',
        gameTimeSeconds: 400,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'YasuoPlayer',
          riotId: 'Yasuo#CN',
          riotIdGameName: 'Yasuo',
          riotIdTagLine: 'CN',
          championName: 'Yasuo',
          level: 6,
          currentGold: 900,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'YasuoPlayer',
            riotId: 'Yasuo#CN',
            riotIdGameName: 'Yasuo',
            riotIdTagLine: 'CN',
            championName: 'Yasuo',
            championId: 157,
            team: 'ORDER',
            position: 'MIDDLE',
            isDead: false,
            respawnTimer: 0,
            items: [
              { itemID: 3031, count: 1 }, // 已完成无尽之刃
              { itemID: 6672, count: 1 } // 已完成海妖杀手
            ]
          } as any,
          {
            summonerName: 'EnemyTop',
            riotId: 'Aatrox#CN',
            riotIdGameName: 'Aatrox',
            riotIdTagLine: 'CN',
            championName: 'Aatrox',
            championId: 266,
            team: 'CHAOS',
            position: 'TOP',
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

    const healGuidance = fusion.getItemPurchaseGuidance(now)
    expect(healGuidance).toBeDefined()
    expect(healGuidance?.primaryPlan.itemIds).toEqual([3123])
    expect(healGuidance?.primaryPlan.conditions[0]).toContain('处刑人的重击')

    // 场景 2：背包满 6 格（包含 1 颗控制守卫 2055），因为 2055 可堆叠至 2，备选方案允许购买控制守卫
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_ward_stack',
        patch: '16.16.1',
        gameTimeSeconds: 700,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'YasuoPlayer',
          riotId: 'Yasuo#CN',
          riotIdGameName: 'Yasuo',
          riotIdTagLine: 'CN',
          championName: 'Yasuo',
          level: 8,
          currentGold: 500,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'YasuoPlayer',
            riotId: 'Yasuo#CN',
            riotIdGameName: 'Yasuo',
            riotIdTagLine: 'CN',
            championName: 'Yasuo',
            championId: 157,
            team: 'ORDER',
            position: 'MIDDLE',
            isDead: false,
            respawnTimer: 0,
            items: [
              { itemID: 3047, count: 1 }, // 铁板靴
              { itemID: 1054, count: 1 }, // 多兰盾
              { itemID: 2003, count: 1 }, // 生命药水
              { itemID: 1082, count: 1 }, // 黑暗封印
              { itemID: 1055, count: 1 }, // 多兰之刃
              { itemID: 2055, count: 1 } // 控制守卫 1 颗 (满 6 格，但 2055 可叠至 2)
            ]
          } as any
        ],
        events: [],
        sourceHealth: []
      },
      now
    )

    const wardGuidance = fusion.getItemPurchaseGuidance(now)
    expect(wardGuidance).toBeDefined()
    expect(wardGuidance?.alternativePlans.some((p) => p.itemIds.includes(2055))).toBe(true)

    // 场景 3：背包满 6 格且无控制守卫，无空位无法购买新控制守卫，备选方案过滤 2055
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_ward_no_slot',
        patch: '16.16.1',
        gameTimeSeconds: 800,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'YasuoPlayer',
          riotId: 'Yasuo#CN',
          riotIdGameName: 'Yasuo',
          riotIdTagLine: 'CN',
          championName: 'Yasuo',
          level: 9,
          currentGold: 500,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'YasuoPlayer',
            riotId: 'Yasuo#CN',
            riotIdGameName: 'Yasuo',
            riotIdTagLine: 'CN',
            championName: 'Yasuo',
            championId: 157,
            team: 'ORDER',
            position: 'MIDDLE',
            isDead: false,
            respawnTimer: 0,
            items: [
              { itemID: 3047, count: 1 },
              { itemID: 1054, count: 1 },
              { itemID: 2003, count: 1 },
              { itemID: 1082, count: 1 },
              { itemID: 1055, count: 1 },
              { itemID: 1056, count: 1 } // 无 2055 且满 6 格
            ]
          } as any
        ],
        events: [],
        sourceHealth: []
      },
      now
    )

    const noWardGuidance = fusion.getItemPurchaseGuidance(now)
    expect(noWardGuidance?.alternativePlans.some((p) => p.itemIds.includes(2055))).toBe(false)
  })
})
