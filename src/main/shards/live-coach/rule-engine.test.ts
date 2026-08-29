import { coachCueSchema } from '@shared/types/live-coach'
import { describe, expect, it } from 'vitest'

import { FactFusionEngine } from './fact-fusion'
import {
  CoachRuleEngine,
  RuleCommunicationPing,
  RuleItemPurchaseGuidance,
  RuleObjectiveSpawn,
  RuleTurretPlatingFall
} from './rule-engine'

describe('CoachRuleEngine & Phase 1 Rules', () => {
  it('offers both ping and confirmed chat choices for a grounded missing-enemy cue', () => {
    const rule = new RuleCommunicationPing()
    const cue = rule.evaluate({
      sessionId: 'communication-session',
      patch: '16.17.1',
      currentTime: 100_000,
      enabledCategories: { information: true },
      enabledCapabilities: new Set([
        'coach.analyze.fog-inference',
        'coach.communication.ping',
        'coach.communication.chat'
      ]),
      fusion: {
        getFogInferences: () => [
          {
            basisEvidenceIds: ['evi-last-seen'],
            intents: [{ kind: 'roam', probability: 0.8 }]
          }
        ]
      }
    } as any)

    expect(cue?.options.map((option) => option.id)).toEqual(['opt_ping_danger', 'opt_chat_missing'])
    expect(coachCueSchema.safeParse(cue).success).toBe(true)
  })

  it('offers danger and missing choices when only ping communication is available', () => {
    const rule = new RuleCommunicationPing()
    const cue = rule.evaluate({
      sessionId: 'ping-only-session',
      patch: '16.17.1',
      currentTime: 100_000,
      enabledCategories: { information: true },
      enabledCapabilities: new Set(['coach.analyze.fog-inference', 'coach.communication.ping']),
      fusion: {
        getFogInferences: () => [
          {
            basisEvidenceIds: ['evi-last-seen'],
            intents: [{ kind: 'roam', probability: 0.8 }]
          }
        ]
      }
    } as any)

    expect(cue?.options.map((option) => option.id)).toEqual(['opt_ping_danger', 'opt_ping_missing'])
    expect(coachCueSchema.safeParse(cue).success).toBe(true)
  })

  it('keeps confirmed chat guidance available when ping capability is unavailable', () => {
    const rule = new RuleCommunicationPing()
    const cue = rule.evaluate({
      sessionId: 'chat-only-session',
      patch: '16.17.1',
      currentTime: 100_000,
      enabledCategories: { information: true },
      enabledCapabilities: new Set(['coach.analyze.fog-inference', 'coach.communication.chat']),
      fusion: {
        getFogInferences: () => [
          {
            basisEvidenceIds: ['evi-last-seen'],
            intents: [{ kind: 'roam', probability: 0.8 }]
          }
        ]
      }
    } as any)

    expect(cue?.options).toEqual([
      expect.objectContaining({ id: 'opt_chat_missing', role: 'primary' })
    ])
  })

  it('correctly triggers enemy grouping only when enemies are spatially clustered', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 1. 三个敌人分散在全图（距离 > 0.18），不应触发聚集
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_1',
        patch: '16.17.1',
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
      patch: '16.17.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      currentTime: now
    })
    expect(cues.find((c) => c.ruleId === 'rule_minimap_enemy_grouping')).toBeUndefined()

    // 2. 三个敌人在局部聚集（距离 < 0.18），应该触发聚集预警并包含正确的 Evidence ID
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_1',
        patch: '16.17.1',
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
      patch: '16.17.1',
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
        patch: '16.17.1',
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
      patch: '16.17.1',
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
        patch: '16.17.1',
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
      patch: '16.17.1',
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
        patch: '16.17.1',
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
        patch: '16.17.1',
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
      patch: '16.17.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      currentTime: now
    })

    const fogCue = cues.find((c) => c.ruleId === 'rule_fog_inference')
    expect(fogCue).toBeDefined()
    // 动态到达时间格式化验证
    expect(fogCue?.impactText).toMatch(/预计将在 \d+~\d+ 秒内到达该区域/)
    expect(fogCue?.spokenText).toMatch(/迷雾推断提醒：敌方可能在 \d+ 到 \d+ 秒内到达/)
    expect(fogCue?.spokenText).toContain('下半河道')
    expect(fogCue?.spokenText).not.toContain('bot_river')
    // 验证 Fog Cue 明确包含了 evi_fog_ 证据
    expect(fogCue?.evidenceIds.some((id) => id.includes('evi_fog_'))).toBe(true)

    // 2. 劫重新在小地图中可见 -> 触发证据失效回调
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_fog',
        patch: '16.17.1',
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
        patch: '16.17.1',
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

    const schedule = fusion.getNextObjectiveSchedule(1175, '16.17.1', 420)
    expect(schedule).toBeDefined()
    expect(schedule?.name).toBe('纳什男爵')
    expect(schedule?.nextSpawnGameTime).toBe(1200)

    const cues = engine.evaluate({
      sessionId: 'sess_baron',
      patch: '16.17.1',
      queueId: 420,
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.track.cooldowns', 'coach.communication.chat']),
      currentTime: now
    })

    const baronCue = cues.find((c) => c.ruleId === 'rule_objective_spawn')
    expect(baronCue).toBeDefined()
    expect(baronCue?.observationText).toContain('纳什男爵 即将在 25 秒内刷新')
    expect(baronCue?.options.map((option) => option.id)).toEqual([
      'opt_obj_river',
      'opt_chat_group'
    ])
    expect(coachCueSchema.safeParse(baronCue).success).toBe(true)
  })

  it('keeps the dragon resource-chat entry point within the two-option cue contract', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1_700_000_000_000
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_dragon_chat',
        patch: '16.17.1',
        gameTimeSeconds: 275,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'Player1',
          riotId: 'P#CN',
          riotIdGameName: 'P',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 5,
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

    const dragonCue = engine
      .evaluate({
        sessionId: 'sess_dragon_chat',
        patch: '16.17.1',
        queueId: 420,
        fusion,
        enabledCategories: { information: true, resource: true },
        enabledCapabilities: new Set(['coach.track.cooldowns', 'coach.communication.chat']),
        currentTime: now
      })
      .find((cue) => cue.ruleId === 'rule_objective_spawn')

    expect(dragonCue?.options.map((option) => option.id)).toEqual([
      'opt_obj_river',
      'opt_chat_resource'
    ])
    expect(coachCueSchema.safeParse(dragonCue).success).toBe(true)
  })

  it('uses patch-locked 16.17 objective times and stays silent for unsupported patches and queues', () => {
    const fusion = new FactFusionEngine()

    expect(fusion.getNextObjectiveSchedule(455, '16.17.1', 420)).toMatchObject({
      name: '虚空巢虫',
      nextSpawnGameTime: 480
    })
    expect(fusion.getNextObjectiveSchedule(875, '16.17.1', 420)).toMatchObject({
      name: '峡谷先锋',
      nextSpawnGameTime: 900
    })
    expect(fusion.getNextObjectiveSchedule(875, '16.16.1', 420)).toBeNull()
    expect(fusion.getNextObjectiveSchedule(875, '16.17.1', 490)).toBeNull()
  })

  it('fails closed for timer-driven cues when cooldown tracking is disabled', () => {
    const objectiveRule = new RuleObjectiveSpawn()
    const platingRule = new RuleTurretPlatingFall()
    const fusion = {
      getGameTimeSeconds: () => 820,
      getNextObjectiveSchedule: () => ({
        id: 'dragon',
        name: '巨龙',
        nextSpawnGameTime: 840
      })
    } as unknown as FactFusionEngine
    const context = {
      sessionId: 'timer-gated-session',
      patch: '16.17.1',
      queueId: 420,
      fusion,
      enabledCategories: { information: true, resource: true },
      enabledCapabilities: new Set<string>(),
      currentTime: 1_700_000_000_000
    }

    expect(objectiveRule.evaluate(context)).toBeNull()
    expect(platingRule.evaluate(context)).toBeNull()
  })

  it('fails closed for communication suggestions when fog inference is disabled', () => {
    const rule = new RuleCommunicationPing()
    const cue = rule.evaluate({
      sessionId: 'fog-gated-communication-session',
      patch: '16.17.1',
      currentTime: 100_000,
      enabledCategories: { information: true },
      enabledCapabilities: new Set(['coach.communication.ping']),
      fusion: {
        getFogInferences: () => [
          {
            basisEvidenceIds: ['fog-evidence'],
            intents: [{ kind: 'roam', probability: 0.9 }]
          }
        ]
      } as any
    })

    expect(cue).toBeNull()
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
        patch: '16.17.1',
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
        patch: '16.17.1',
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
        patch: '16.17.1',
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
        patch: '16.17.1',
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
        patch: '16.17.1',
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
        patch: '16.17.1',
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

  it('suppresses fog inferences for anonymous visual enemy tracks when enemy death occurs in phase 1', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 1. 匿名敌人轨迹在小地图可见（championId 为 null）
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_anon',
        patch: '16.17.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 15 },
        health: 'healthy',
        entities: [
          {
            trackId: 'track_enemy_99',
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
          }
        ],
        events: []
      },
      now
    )

    // 2. 敌方玩家阵亡，LiveGameData 汇报一名敌方英雄死亡
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_anon',
        patch: '16.17.1',
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
            summonerName: 'EnemyMid',
            riotId: 'Enemy#CN',
            riotIdGameName: 'Enemy',
            riotIdTagLine: 'CN',
            championName: 'Ahri',
            championId: 103,
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

    // 3. 验证：匿名轨迹的迷雾推断已被即时撤销
    expect(fusion.getFogInferences(now + 5000).length).toBe(0)
  })

  it('RuleItemPurchaseAdvice formats spoken text and options with exact Chinese item names and alternative plans', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 盖伦 (86) 战士流派，当前持有 1200 金币，满足提亚马特 (3077, 1200g)
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_item_names',
        patch: '16.17.1',
        gameTimeSeconds: 420,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'GarenPlayer',
          riotId: 'Garen#CN',
          riotIdGameName: 'Garen',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 6,
          currentGold: 1200,
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
            isDead: false,
            items: []
          } as any
        ],
        events: [],
        sourceHealth: []
      },
      now
    )

    const cues = engine.evaluate({
      sessionId: 'sess_item_names',
      patch: '16.17.1',
      fusion,
      enabledCategories: { suggestion: true, warning: true, opportunity: true, information: true },
      enabledCapabilities: new Set(['coach.guidance.item-purchase']),
      currentTime: now
    })

    const itemCue = cues.find((c) => c.ruleId === 'rule_item_purchase_guidance')
    expect(itemCue).toBeDefined()
    expect(itemCue?.spokenText).toContain('短剑')
    expect(itemCue?.spokenText).toContain('250 金币')
    expect(itemCue?.spokenText).toContain('剩余 950 金币')
    expect(itemCue?.options[0]?.label).toContain('首选方案：购买 短剑')
  })

  it('correctly handles red side (CHAOS) player and checks blue side (ORDER) enemy jungler', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    // 玩家在红方 CHAOS
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_red',
        patch: '16.17.1',
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
      patch: '16.17.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set([
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-identity',
        'coach.analyze.fog-inference',
        'coach.guidance.micro'
      ]),
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
        patch: '16.17.1',
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
      patch: '16.17.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-basic']),
      currentTime: now
    })
    expect(cuesWithoutCap.find((c) => c.ruleId === 'rule_item_purchase_guidance')).toBeUndefined()

    // 2. 当包含 'coach.guidance.item-purchase' 时，装备规则正常产出
    const cuesWithCap = engine.evaluate({
      sessionId: 'sess_gate',
      patch: '16.17.1',
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
          patch: '16.17.1',
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
        patch: '16.17.1',
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
      patch: '16.17.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set([
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-identity',
        'coach.analyze.fog-inference',
        'coach.guidance.micro'
      ]),
      currentTime: now
    })
    expect(fogCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')).toBeDefined()

    // 2. 当小地图同时观测到 2 个敌人（覆盖全部 2 名存活敌人）时，所有敌方均在视野中，抑制防抓提醒
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_jg_real',
        patch: '16.17.1',
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
      patch: '16.17.1',
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
      patch: '16.17.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-basic']),
      currentTime: now + 200
    })
    expect(
      deadJunglerCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')
    ).toBeUndefined()
  })

  it('validates canonical Data Dragon 16.17.1 item catalog and multiset duplicate component deduction (Warmogs)', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 坦克奥恩（已完成第一件日炎圣盾 3068，且拥有 1 个巨人腰带 1011，持有 1000g）
    // 目标第二大件为狂徒铠甲 3083 (3100g)，配方包含 [3801 晶体护臂 800g, 1011 巨人腰带 900g, 1011 巨人腰带 900g]
    // 扣除 1 个 1011 后，剩余未拥有组件为 [3801 晶体护臂 800g, 1011 巨人腰带 900g]，剩余合成花费为 3100 - 900 = 2200g
    // 玩家持有 1000g，买得起第 1 个未拥有组件 3801 晶体护臂 (800g)
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_dd_tank',
        patch: '16.17.1',
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
    // 验证推荐买得起的未拥有组件（治疗宝珠 1006），花费 300g
    expect(guidance?.primaryPlan.itemIds).toEqual([1006])
    expect(guidance?.primaryPlan.totalCost).toBe(300)
    expect(guidance?.primaryPlan.missingGold).toBe(0)
  })

  it('handles unique confirmed tracks deduplication for jungler fog alarm', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1700000000000

    const setupLiveMatch = (enemyEntities: any[]) => {
      fusion.updateLiveGameSnapshot(
        {
          sessionId: 'sess_jg_dedup',
          patch: '16.17.1',
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

      fusion.updateMinimapBatch(
        {
          sessionId: 'sess_jg_dedup',
          patch: '16.17.1',
          calibrationVersion: '1.0.0',
          modelVersions: {},
          frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 15 },
          health: 'healthy',
          entities: enemyEntities,
          events: []
        },
        now
      )
    }

    // 场景 1：3 名敌方存活，但小地图仅有 2 个不同轨迹（即便实体散落在不同区域），打野依然未知 $\to$ 触发警报
    setupLiveMatch([
      {
        trackId: 'track_enemy_1',
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
      },
      {
        trackId: 'track_enemy_2',
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
      }
    ])
    const missingJunglerCues = engine.evaluate({
      sessionId: 'sess_jg_dedup',
      patch: '16.17.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set([
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-identity',
        'coach.analyze.fog-inference',
        'coach.guidance.micro'
      ]),
      currentTime: now
    })
    expect(
      missingJunglerCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')
    ).toBeDefined()
    // 场景 2：3 名敌方存活，小地图即使有 3 条匿名 confirmed 轨迹，因为无 championId 无法证明打野身份 $\to$ 依然必须报警！
    setupLiveMatch([
      {
        trackId: 'track_enemy_1',
        kind: 'enemy',
        team: 'enemy',
        championId: null,
        point: { x: 0.1, y: 0.2 },
        regionId: 'top_lane',
        confidence: 0.9,
        lifecycle: 'confirmed',
        firstObservedAt: now + 100000,
        lastObservedAt: now + 100000,
        expiresAt: now + 105000
      },
      {
        trackId: 'track_enemy_2',
        kind: 'enemy',
        team: 'enemy',
        championId: null,
        point: { x: 0.5, y: 0.5 },
        regionId: 'mid_lane',
        confidence: 0.9,
        lifecycle: 'confirmed',
        firstObservedAt: now + 100000,
        lastObservedAt: now + 100000,
        expiresAt: now + 105000
      },
      {
        trackId: 'track_enemy_3',
        kind: 'enemy',
        team: 'enemy',
        championId: null,
        point: { x: 0.3, y: 0.3 },
        regionId: 'top_river',
        confidence: 0.9,
        lifecycle: 'confirmed',
        firstObservedAt: now + 100000,
        lastObservedAt: now + 100000,
        expiresAt: now + 105000
      }
    ])
    const anonymousCues = engine.evaluate({
      sessionId: 'sess_jg_dedup',
      patch: '16.17.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set([
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-identity',
        'coach.analyze.fog-inference',
        'coach.guidance.micro'
      ]),
      currentTime: now + 100000
    })
    expect(anonymousCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')).toBeDefined()

    // 场景 3：小地图检测到 confirmed 且 explicit championId === 64 (Lee Sin) 的实体 $\to$ 准确抑制打野未知警报
    setupLiveMatch([
      {
        trackId: 'track_enemy_lee',
        kind: 'enemy',
        team: 'enemy',
        championId: 64, // 显式匹配打野英雄 ID
        point: { x: 0.3, y: 0.3 },
        regionId: 'top_river',
        confidence: 0.9,
        lifecycle: 'confirmed',
        firstObservedAt: now + 200000,
        lastObservedAt: now + 200000,
        expiresAt: now + 205000
      }
    ])
    const explicitSeenCues = engine.evaluate({
      sessionId: 'sess_jg_dedup',
      patch: '16.17.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true },
      enabledCapabilities: new Set([
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-identity',
        'coach.analyze.fog-inference',
        'coach.guidance.micro'
      ]),
      currentTime: now + 200000
    })
    expect(
      explicitSeenCues.find((c) => c.ruleId === 'rule_basic_skills_and_tactics')
    ).toBeUndefined()
  })

  it('handles AP counter adaptive item data (Maw 3156, Banshees 3102, Kaenic 2504) according to Riot 16.17.1', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 战士面对敌方 2 名 AP 爆发英雄 (Ahri, Syndra)，自适应推荐 3156 玛莫提乌斯之噬 (3100g)
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_adaptive_ap',
        patch: '16.17.1',
        gameTimeSeconds: 500,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'GarenPlayer',
          riotId: 'Garen#CN',
          riotIdGameName: 'Garen',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 7,
          currentGold: 1500,
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
            isDead: false,
            respawnTimer: 0,
            items: []
          } as any,
          {
            summonerName: 'EnemyMid',
            riotId: 'Ahri#CN',
            riotIdGameName: 'Ahri',
            riotIdTagLine: 'CN',
            championName: 'Ahri',
            championId: 103,
            team: 'CHAOS',
            position: 'MIDDLE',
            isDead: false,
            respawnTimer: 0,
            items: []
          } as any,
          {
            summonerName: 'EnemySup',
            riotId: 'Lux#CN',
            riotIdGameName: 'Lux',
            riotIdTagLine: 'CN',
            championName: 'Lux',
            championId: 99,
            team: 'CHAOS',
            position: 'UTILITY',
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

    const apGuidance = fusion.getItemPurchaseGuidance(now)
    expect(apGuidance).toBeDefined()
    // 验证优先推荐最基础可买起的散件（发光微粒 2022，250g）
    expect(apGuidance?.primaryPlan.itemIds).toEqual([2022])
    expect(apGuidance?.primaryPlan.totalCost).toBe(250)
    expect(apGuidance?.primaryPlan.conditions[0]).toContain('玛莫提乌斯之噬')
  })

  it('strictly disables item guidance when patch is not 16.17.1 or unknown', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_old_patch',
        patch: '15.1.1', // 非 16.17.1 补丁
        gameTimeSeconds: 500,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'AhriPlayer',
          riotId: 'Ahri#CN',
          riotIdGameName: 'Ahri',
          riotIdTagLine: 'CN',
          championName: 'Ahri',
          level: 6,
          currentGold: 1000,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'AhriPlayer',
            riotId: 'Ahri#CN',
            riotIdGameName: 'Ahri',
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

    // 非 16.17.1 补丁必须严格返回 null，杜绝错误指导
    expect(fusion.getItemPurchaseGuidance(now)).toBeNull()
  })

  it('handles two Long Swords with 500g to complete Tiamat without false Long Sword recommendations', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 盖伦持有两把长剑 1036 (350g x 2)，合成挺进破坏者第 1 件大件提亚马特 3077 (1200g, 500g 合成费)
    // 当前持有 600g (>= 500g)
    // 验证：
    // 1. 提亚马特 purchaseCost 精确为 500g，而不是 1200g；
    // 2. 推荐购买提亚马特进阶装备（升级费用 500g），绝不重复推荐已被消费的两把长剑！
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_tiamat_upgrade',
        patch: '16.17.1',
        gameTimeSeconds: 400,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'GarenPlayer',
          riotId: 'Garen#CN',
          riotIdGameName: 'Garen',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 6,
          currentGold: 600,
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
            isDead: false,
            respawnTimer: 0,
            items: [
              { itemID: 1036, count: 1 }, // 长剑 1
              { itemID: 1036, count: 1 } // 长剑 2
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
    expect(guidance?.primaryPlan.itemIds).toEqual([3077])
    expect(guidance?.primaryPlan.totalCost).toBe(500)
    expect(guidance?.primaryPlan.remainingGold).toBe(100) // 600 - 500 = 100
    expect(guidance?.primaryPlan.conditions[0]).toContain('500g')
  })

  it('correctly maps Teemo TOP and Rumble TOP to AP Mage build and returns null for unconfigured champions', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 1. Teemo TOP 必须推荐 AP 法系核心（卢登/影焰/法穿鞋），严禁误归为战士 (Stridebreaker/BC)
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_teemo_top',
        patch: '16.17.1',
        gameTimeSeconds: 300,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'TeemoPlayer',
          riotId: 'Teemo#CN',
          riotIdGameName: 'Teemo',
          riotIdTagLine: 'CN',
          championName: 'Teemo',
          level: 5,
          currentGold: 1300,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'TeemoPlayer',
            riotId: 'Teemo#CN',
            riotIdGameName: 'Teemo',
            riotIdTagLine: 'CN',
            championName: 'Teemo',
            championId: 17,
            team: 'ORDER',
            position: 'TOP', // 虽然走 TOP，但绝不能推战士装
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

    const teemoGuidance = fusion.getItemPurchaseGuidance(now)
    expect(teemoGuidance).toBeDefined()
    expect(teemoGuidance?.primaryPlan.conditions[0]).toContain('卢登的回声') // 官方 16.17.1 中文名称 6655 卢登的回声

    // 2. 未在配置表中的未知英雄直接返回 null，杜绝凭 position 强行推导
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_unconfigured_champ',
        patch: '16.17.1',
        gameTimeSeconds: 300,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'HeroPlayer',
          riotId: 'Hero#CN',
          riotIdGameName: 'Hero',
          riotIdTagLine: 'CN',
          championName: 'CustomUnlistedChampionXYZ',
          level: 5,
          currentGold: 1300,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'HeroPlayer',
            riotId: 'Hero#CN',
            riotIdGameName: 'Hero',
            riotIdTagLine: 'CN',
            championName: 'CustomUnlistedChampionXYZ',
            championId: 99999,
            team: 'ORDER',
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

    expect(fusion.getItemPurchaseGuidance(now)).toBeNull()
  })

  it('handles recursive multiset sub-component deduction and unknown champion safety', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 1. 盖伦持有长剑 1036 (350g)，合成挺进破坏者 6631 (3300g)，验证递归抵扣 350g，netCost = 2950g
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_sub_comp',
        patch: '16.17.1',
        gameTimeSeconds: 400,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'GarenPlayer',
          riotId: 'Garen#CN',
          riotIdGameName: 'Garen',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 6,
          currentGold: 3000,
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
            isDead: false,
            respawnTimer: 0,
            items: [
              { itemID: 1036, count: 1 } // 持有一把长剑 (350g)
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
    expect(guidance?.primaryPlan.itemIds).toEqual([6631])
    // 3300g - 350g = 2950g
    expect(guidance?.primaryPlan.totalCost).toBe(2950)
    expect(guidance?.primaryPlan.remainingGold).toBe(50) // 3000 - 2950 = 50

    // 2. 未分类英雄且无 position 时返回 null，杜绝错误假设为 fighter
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_unknown_champ',
        patch: '16.17.1',
        gameTimeSeconds: 400,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'CustomHeroPlayer',
          riotId: 'Hero#CN',
          riotIdGameName: 'Hero',
          riotIdTagLine: 'CN',
          championName: 'UnknownNewChampion2026',
          level: 6,
          currentGold: 3000,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'CustomHeroPlayer',
            riotId: 'Hero#CN',
            riotIdGameName: 'Hero',
            riotIdTagLine: 'CN',
            championName: 'UnknownNewChampion2026',
            championId: 99999,
            team: 'ORDER',
            position: '',
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

    expect(fusion.getItemPurchaseGuidance(now)).toBeNull()
  })

  it('handles full inventory with stacked potions and in-place boots upgrade', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    // 玩家持有 2 瓶堆叠药水（仅占 1 格）、草鞋 1001（1 格）和其他 4 件装备，总共填满 6 格
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_boots_upgrade',
        patch: '16.17.1',
        gameTimeSeconds: 600,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        activePlayer: {
          summonerName: 'FighterPlayer',
          riotId: 'Fighter#CN',
          riotIdGameName: 'Fighter',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 7,
          currentGold: 1000,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'FighterPlayer',
            riotId: 'Fighter#CN',
            riotIdGameName: 'Fighter',
            riotIdTagLine: 'CN',
            championName: 'Garen',
            championId: 86,
            team: 'ORDER',
            position: 'TOP',
            isDead: false,
            respawnTimer: 0,
            items: [
              { itemID: 1001, count: 1 }, // 速度之靴 (草鞋)
              { itemID: 2003, count: 2 }, // 生命药水 2 瓶 (堆叠在 1 格内)
              { itemID: 1054, count: 1 }, // 多兰盾
              { itemID: 1082, count: 1 }, // 黑暗封印
              { itemID: 1055, count: 1 }, // 多兰之刃
              { itemID: 1056, count: 1 } // 多兰之戒 (总共占用 6 格)
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
    // 验证备选方案中包含原位升级鞋子（3047 铁板靴，原价 1200g - 300g = 900g）
    const bootsPlan = guidance?.alternativePlans.find((p) =>
      p.reasonCodes.includes('BOOTS_MOBILITY')
    )
    expect(bootsPlan).toBeDefined()
    expect(bootsPlan?.itemIds).toEqual([3047])
    expect(bootsPlan?.totalCost).toBe(900)
    expect(bootsPlan?.conditions[0]).toContain('原位升级')
  })

  it('does not clear anonymous enemy fog inference when an ally dies', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000

    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_ally_death',
        patch: '16.17.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 0 },
        health: 'healthy',
        entities: [
          {
            trackId: 'track_enemy_anonymous',
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
          }
        ],
        events: []
      },
      now
    )
    fusion.updateMinimapBatch(
      {
        sessionId: 'sess_ally_death',
        patch: '16.17.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now + 5000, receivedAt: now + 5000, sequence: 2, ageMs: 0 },
        health: 'healthy',
        entities: [],
        events: []
      },
      now + 5000
    )
    expect(fusion.getFogInferences(now + 5000)).toHaveLength(1)

    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'sess_ally_death',
        patch: '16.17.1',
        gameTimeSeconds: 300,
        clock: { observedAt: now + 6000, receivedAt: now + 6000, sequence: 1 },
        activePlayer: {
          summonerName: 'Self',
          riotId: 'Self#CN',
          riotIdGameName: 'Self',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 6,
          currentGold: 0,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'Ally',
            championName: 'Lux',
            championId: 99,
            team: 'ORDER',
            isDead: true,
            respawnTimer: 10,
            items: []
          },
          {
            summonerName: 'Enemy',
            championName: 'Zed',
            championId: 238,
            team: 'CHAOS',
            isDead: false,
            respawnTimer: 0,
            items: []
          }
        ],
        events: [],
        sourceHealth: []
      } as any,
      now + 6000
    )

    expect(fusion.getFogInferences(now + 6000)).toHaveLength(1)
  })

  it('invalidates anonymous fog once for an enemy death without deleting later reacquired tracks', () => {
    const fusion = new FactFusionEngine()
    const now = 1700000000000
    const makeBatch = (trackId: string | null, observedAt: number, sequence: number) => ({
      sessionId: 'sess_enemy_death',
      patch: '16.17.1',
      calibrationVersion: '1.0.0',
      modelVersions: {},
      frame: { observedAt, receivedAt: observedAt, sequence, ageMs: 0 },
      health: 'healthy' as const,
      entities: trackId
        ? [
            {
              trackId,
              kind: 'enemy' as const,
              team: 'enemy' as const,
              championId: null,
              point: { x: 0.5, y: 0.5 },
              regionId: 'mid_lane',
              confidence: 0.9,
              lifecycle: 'confirmed' as const,
              firstObservedAt: observedAt,
              lastObservedAt: observedAt,
              expiresAt: observedAt + 5000
            }
          ]
        : [],
      events: []
    })
    const makeDeadEnemySnapshot = (observedAt: number) =>
      ({
        sessionId: 'sess_enemy_death',
        patch: '16.17.1',
        gameTimeSeconds: 300,
        clock: { observedAt, receivedAt: observedAt, sequence: 1 },
        activePlayer: {
          summonerName: 'Self',
          riotId: 'Self#CN',
          riotIdGameName: 'Self',
          riotIdTagLine: 'CN',
          championName: 'Garen',
          level: 6,
          currentGold: 0,
          team: 'ORDER',
          abilities: {}
        },
        players: [
          {
            summonerName: 'Enemy',
            championName: 'Zed',
            championId: 238,
            team: 'CHAOS',
            isDead: true,
            respawnTimer: 10,
            items: []
          }
        ],
        events: [],
        sourceHealth: []
      }) as any

    fusion.updateMinimapBatch(makeBatch('track_enemy_before_death', now, 1), now)
    fusion.updateMinimapBatch(makeBatch(null, now + 5000, 2), now + 5000)
    expect(fusion.getFogInferences(now + 5000)).toHaveLength(1)

    fusion.updateLiveGameSnapshot(makeDeadEnemySnapshot(now + 6000), now + 6000)
    expect(fusion.getFogInferences(now + 6000)).toHaveLength(0)

    fusion.updateMinimapBatch(makeBatch('track_enemy_reacquired', now + 7000, 3), now + 7000)
    fusion.updateLiveGameSnapshot(makeDeadEnemySnapshot(now + 8000), now + 8000)
    fusion.updateMinimapBatch(makeBatch(null, now + 12000, 4), now + 12000)

    expect(fusion.getFogInferences(now + 12000)).toHaveLength(1)
  })

  it('labels an unaffordable alternative as a savings target instead of a purchase', () => {
    const rule = new RuleItemPurchaseGuidance()
    const now = 1700000000000
    const cue = rule.evaluate({
      sessionId: 'sess_item_alt',
      patch: '16.17.1',
      fusion: {
        getItemPurchaseGuidance: () => ({
          id: 'guidance_1',
          sessionId: 'sess_item_alt',
          patch: '16.17.1',
          championId: 86,
          currentGold: 400,
          inventoryItemIds: [],
          primaryPlan: {
            itemIds: [1028],
            totalCost: 400,
            remainingGold: 0,
            missingGold: 0,
            reasonCodes: ['CORE_COMPONENT_AFFORDABLE'],
            conditions: ['核心组件']
          },
          alternativePlans: [
            {
              itemIds: [3047],
              totalCost: 1200,
              remainingGold: 0,
              missingGold: 800,
              reasonCodes: ['BOOTS_MOBILITY'],
              conditions: ['备选鞋子']
            },
            {
              itemIds: [2055],
              totalCost: 75,
              remainingGold: 325,
              missingGold: 0,
              reasonCodes: ['VISION_CONTROL'],
              conditions: ['备选控制守卫']
            }
          ],
          evidenceIds: ['evi_gold'],
          createdAt: now,
          expiresAt: now + 10000,
          ruleVersion: '1.0.0'
        })
      } as any,
      currentTime: now,
      enabledCategories: { opportunity: true },
      enabledCapabilities: new Set(['coach.guidance.item-purchase'])
    })

    const alternative = cue?.options.find((option) => option.role === 'alternative')
    expect(cue?.options).toHaveLength(2)
    expect(alternative?.label).toContain('还差 800g')
    expect(alternative?.label).not.toContain('购买 铁板靴')
  })

  it('announces the same continuously affordable item plan only once', () => {
    const rule = new RuleItemPurchaseGuidance()
    const now = 1_700_000_000_000
    const guidance = {
      id: 'guidance-repeat',
      sessionId: 'sess-item-repeat',
      patch: '16.17.1',
      championId: 86,
      mode: 'adaptive' as const,
      currentGold: 500,
      inventoryItemIds: [],
      primaryPlan: {
        itemIds: [1028],
        totalCost: 400,
        remainingGold: 100,
        missingGold: 0,
        reasonCodes: ['CORE_COMPONENT_AFFORDABLE'],
        conditions: ['核心组件']
      },
      alternativePlans: [],
      evidenceIds: ['evi-gold', 'evi-guidance'],
      createdAt: now,
      expiresAt: now + 120_000,
      ruleVersion: '1.3.0'
    }
    const context = (currentTime: number) => ({
      sessionId: guidance.sessionId,
      patch: '16.17.1',
      fusion: { getItemPurchaseGuidance: () => guidance } as any,
      currentTime,
      enabledCategories: { opportunity: true },
      enabledCapabilities: new Set(['coach.guidance.item-purchase'])
    })

    expect(rule.evaluate(context(now))).not.toBeNull()
    expect(rule.evaluate(context(now + 40_001))).toBeNull()

    guidance.primaryPlan = {
      ...guidance.primaryPlan,
      itemIds: [1001],
      totalCost: 300
    }
    expect(rule.evaluate(context(now + 40_002))).not.toBeNull()
  })
})
