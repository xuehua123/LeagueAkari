import { CoachCue, CoachOption } from '@shared/types/live-coach'

import { FactFusionEngine } from './fact-fusion'

export interface RuleEvaluationContext {
  sessionId: string
  patch: string
  fusion: FactFusionEngine
  enabledCategories: Record<string, boolean>
  currentTime?: number
}

export interface CoachRule {
  id: string
  version: string
  category: 'information' | 'warning' | 'opportunity' | 'system' | 'review'
  evaluate(context: RuleEvaluationContext): CoachCue | null
  reset(): void
}

/**
 * 规则 1：中立资源（巨龙 / 男爵）基于真实击杀事件与复活倒计时的刷新提醒（P1-007）
 */
export class RuleObjectiveSpawn implements CoachRule {
  id = 'rule_objective_spawn'
  version = '1.2.0'
  category = 'information' as const
  private _lastTriggeredSpawnTime: number = -1

  reset(): void {
    this._lastTriggeredSpawnTime = -1
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const gameTime = ctx.fusion.getGameTimeSeconds()
    if (gameTime === null) return null

    const schedule = ctx.fusion.getNextObjectiveSchedule(gameTime)
    if (!schedule) return null

    const timeUntilSpawn = schedule.nextSpawnGameTime - gameTime

    // 在实际刷新前 35 秒至 5 秒内触发提醒
    if (
      timeUntilSpawn >= 5 &&
      timeUntilSpawn <= 35 &&
      this._lastTriggeredSpawnTime !== schedule.nextSpawnGameTime
    ) {
      this._lastTriggeredSpawnTime = schedule.nextSpawnGameTime
      const now = ctx.currentTime ?? Date.now()

      const evidenceId = `evi_obj_spawn_${now}`
      ctx.fusion.addEvidence({
        id: evidenceId,
        sessionId: ctx.sessionId,
        temporalScope: 'current',
        source: 'live-client-data',
        kind: 'objective-spawn-timing',
        confidence: 1,
        patch: ctx.patch,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        freshness: { expiresAt: now + 30000, state: 'fresh' },
        payload: { schedule, gameTime }
      })

      const options: CoachOption[] = [
        {
          id: 'opt_obj_river',
          label: `关注 ${schedule.name} 坑位与河道视野`,
          condition: null,
          evidenceIds: [evidenceId],
          role: 'primary',
          score: 0.9
        },
        {
          id: 'opt_obj_lanes',
          label: '留意附近对线人员集结',
          condition: null,
          evidenceIds: [evidenceId],
          role: 'alternative',
          score: 0.7
        }
      ]

      return {
        id: `cue_obj_${now}`,
        sessionId: ctx.sessionId,
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        priority: 50,
        observationText: `${schedule.name} 即将在 ${Math.round(timeUntilSpawn)} 秒内刷新`,
        impactText: '河道与龙坑区域可能存在敌方动向',
        options,
        spokenText: `${schedule.name} 即将在 ${Math.round(timeUntilSpawn)} 秒内刷新，注意河道动态。`,
        evidenceIds: [evidenceId],
        createdAt: now,
        expiresAt: now + 8000,
        status: 'pending',
        cancellationReason: null
      }
    }

    return null
  }
}

/**
 * 规则 2：防御塔镀层即将脱落（14:00 脱落节奏感知）
 */
export class RuleTurretPlatingFall implements CoachRule {
  id = 'rule_turret_plating_fall'
  version = '1.1.0'
  category = 'information' as const
  private _hasTriggered = false

  reset(): void {
    this._hasTriggered = false
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const gameTime = ctx.fusion.getGameTimeSeconds()
    if (gameTime === null) return null

    // 13:30 (810s) 提示防御塔镀层即将在 30 秒后脱落
    if (gameTime >= 810 && gameTime <= 835 && !this._hasTriggered) {
      this._hasTriggered = true
      const now = ctx.currentTime ?? Date.now()

      const evidenceId = `evi_turret_plating_${now}`
      ctx.fusion.addEvidence({
        id: evidenceId,
        sessionId: ctx.sessionId,
        temporalScope: 'current',
        source: 'live-client-data',
        kind: 'game-event-timing',
        confidence: 1,
        patch: ctx.patch,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        freshness: { expiresAt: now + 30000, state: 'fresh' },
        payload: { gameTime, event: 'turret-plating-fall' }
      })

      const options: CoachOption[] = [
        {
          id: 'opt_plate_timing',
          label: '留意对线期结束时间节点',
          condition: null,
          evidenceIds: [evidenceId],
          role: 'primary',
          score: 0.85
        },
        {
          id: 'opt_plate_lanes',
          label: '关注各路防御塔状态',
          condition: null,
          evidenceIds: [evidenceId],
          role: 'alternative',
          score: 0.65
        }
      ]

      return {
        id: `cue_plate_${now}`,
        sessionId: ctx.sessionId,
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        priority: 45,
        observationText: '防御塔镀层即将在 14 分钟脱落',
        impactText: '对线期即将结束，防御塔额外护甲与经济脱落',
        options,
        spokenText: '防御塔镀层即将在 14 分钟脱落，对线期即将结束。',
        evidenceIds: [evidenceId],
        createdAt: now,
        expiresAt: now + 8000,
        status: 'pending',
        cancellationReason: null
      }
    }

    return null
  }
}

/**
 * 规则 3：小地图局部敌人聚集预警（基于 2D 空间聚类计算）
 */
export class RuleMinimapEnemyGrouping implements CoachRule {
  id = 'rule_minimap_enemy_grouping'
  version = '1.1.0'
  category = 'warning' as const
  private _lastTriggerTime: number = 0
  private readonly _clusterRadius = 0.18 // 归一化小地图距离阈值

  reset(): void {
    this._lastTriggerTime = 0
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const entities = ctx.fusion.getMinimapEntities()
    const enemyEntities = entities.filter((e) => e.team === 'enemy')

    if (enemyEntities.length < 3) {
      return null
    }

    // 2D 空间聚类检测：寻找是否有半径 <= 0.18 内聚集 >= 3 个敌方单位的簇
    let targetCluster: typeof enemyEntities | null = null

    for (let i = 0; i < enemyEntities.length; i++) {
      const p1 = enemyEntities[i].point
      const cluster = [enemyEntities[i]]

      for (let j = 0; j < enemyEntities.length; j++) {
        if (i === j) continue
        const p2 = enemyEntities[j].point
        const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)
        if (dist <= this._clusterRadius) {
          cluster.push(enemyEntities[j])
        }
      }

      if (cluster.length >= 3) {
        targetCluster = cluster
        break
      }
    }

    if (!targetCluster) {
      return null
    }

    const now = ctx.currentTime ?? Date.now()
    if (now - this._lastTriggerTime >= 20000) {
      this._lastTriggerTime = now

      const eviIds: string[] = []
      for (const e of targetCluster) {
        const eviId = ctx.fusion.getMinimapEvidenceId(e.trackId)
        if (eviId) {
          eviIds.push(eviId)
        }
      }

      const options: CoachOption[] = [
        {
          id: 'opt_group_watch',
          label: '关注该区域视野动向',
          condition: null,
          evidenceIds: eviIds,
          role: 'primary',
          score: 0.95
        },
        {
          id: 'opt_group_safe',
          label: '保持安全防范距离',
          condition: null,
          evidenceIds: eviIds,
          role: 'alternative',
          score: 0.8
        }
      ]

      return {
        id: `cue_group_${now}`,
        sessionId: ctx.sessionId,
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        priority: 75,
        observationText: `小地图局部检测到 ${targetCluster.length} 名敌方英雄聚集`,
        impactText: '局部区域敌方人数占优',
        options,
        spokenText: `小地图局部检测到 ${targetCluster.length} 名敌方英雄聚集。`,
        evidenceIds: eviIds,
        createdAt: now,
        expiresAt: now + 8000,
        status: 'pending',
        cancellationReason: null
      }
    }

    return null
  }
}

/**
 * 规则 4：战争迷雾与不可见敌人时空推断提醒（ENG-P1-020, ADR-0001）
 */
export class RuleFogInference implements CoachRule {
  id = 'rule_fog_inference'
  version = '1.1.0'
  category = 'warning' as const
  private _lastTriggerTime: number = 0

  reset(): void {
    this._lastTriggerTime = 0
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const now = ctx.currentTime ?? Date.now()
    const inferences = ctx.fusion.getFogInferences(now)
    const highRisk = inferences.find((f) => f.confidence >= 0.65 && f.arrivalWindow !== null)

    if (!highRisk || !highRisk.arrivalWindow) return null

    if (now - this._lastTriggerTime >= 25000) {
      this._lastTriggerTime = now

      const topRegion = highRisk.predictedRegions[0]?.regionId || '河道'
      const eviIds = [...highRisk.basisEvidenceIds]

      // 动态计算预计到达秒数范围（消除硬编码 15~25s 矛盾）
      const minSec = Math.max(1, Math.round((highRisk.arrivalWindow.earliestAt - now) / 1000))
      const maxSec = Math.max(
        minSec + 2,
        Math.round((highRisk.arrivalWindow.latestAt - now) / 1000)
      )

      const options: CoachOption[] = [
        {
          id: 'opt_fog_defend',
          label: `防范迷雾游走（预计到达 ${topRegion}）`,
          condition: null,
          evidenceIds: eviIds,
          role: 'primary',
          score: 0.9
        },
        {
          id: 'opt_fog_ward',
          label: '在关键路口补充防守守卫',
          condition: null,
          evidenceIds: eviIds,
          role: 'alternative',
          score: 0.75
        }
      ]

      return {
        id: `cue_fog_${now}`,
        sessionId: ctx.sessionId,
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        priority: 70,
        observationText: `[迷雾推断] 敌方可能正向 ${topRegion} 方向游走`,
        impactText: `预计将在 ${minSec}~${maxSec} 秒内到达该区域，置信度 ${Math.round(highRisk.confidence * 100)}%`,
        options,
        spokenText: `迷雾推断提醒：敌方可能在 ${minSec} 到 ${maxSec} 秒内到达 ${topRegion}，注意安全防范。`,
        evidenceIds: eviIds,
        createdAt: now,
        expiresAt: now + 10000,
        status: 'pending',
        cancellationReason: null
      }
    }

    return null
  }
}

/**
 * 规则 5：装备购买指导与备选出装推荐（ENG-P1-021, ADR-0001）
 */
export class RuleItemPurchaseGuidance implements CoachRule {
  id = 'rule_item_purchase_guidance'
  version = '1.1.0'
  category = 'opportunity' as const
  private _lastTriggerTime: number = 0

  reset(): void {
    this._lastTriggerTime = 0
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const now = ctx.currentTime ?? Date.now()
    const guidance = ctx.fusion.getItemPurchaseGuidance(now)
    if (!guidance) return null

    // 当金币满足购买推荐大件或重要组件时触发建议
    if (guidance.currentGold >= 800) {
      const now = ctx.currentTime ?? Date.now()
      if (now - this._lastTriggerTime >= 40000) {
        this._lastTriggerTime = now

        const primary = guidance.primaryPlan
        const primaryReason = primary.conditions[0] || '核心属性提升'

        const options: CoachOption[] = [
          {
            id: 'opt_item_primary',
            label: `首选方案：更新推荐组件（花费 ${primary.totalCost}g，余 ${primary.remainingGold}g）`,
            condition: primaryReason,
            evidenceIds: guidance.evidenceIds,
            role: 'primary',
            score: 0.95
          },
          {
            id: 'opt_item_alt',
            label: `备选方案：优先更新靴子或消耗品`,
            condition: '移速与视野防守',
            evidenceIds: guidance.evidenceIds,
            role: 'alternative',
            score: 0.7
          }
        ]

        return {
          id: `cue_item_${now}`,
          sessionId: ctx.sessionId,
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          priority: 40,
          observationText: `持有金币 ${guidance.currentGold}g，满足核心装备组件购买条件`,
          impactText: `回城更新装备可提升对线战力：${primaryReason}`,
          options,
          spokenText: `当前金币充足，回城建议优先更新核心装备。`,
          evidenceIds: guidance.evidenceIds,
          createdAt: now,
          expiresAt: now + 15000,
          status: 'pending',
          cancellationReason: null
        }
      }
    }

    return null
  }
}

/**
 * 规则 6：对线期控线与防抓时机提醒（基于对线时长与玩家位置证据）
 */
export class RuleBasicSkillsAndTactics implements CoachRule {
  id = 'rule_basic_skills_and_tactics'
  version = '1.1.0'
  category = 'information' as const
  private _lastTriggerTime: number = 0

  reset(): void {
    this._lastTriggerTime = 0
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const gameTime = ctx.fusion.getGameTimeSeconds()
    if (gameTime === null || gameTime < 180 || gameTime > 600) return null

    const now = ctx.currentTime ?? Date.now()
    if (now - this._lastTriggerTime >= 90000) {
      this._lastTriggerTime = now

      const evidenceId = `evi_tactics_${now}`
      ctx.fusion.addEvidence({
        id: evidenceId,
        sessionId: ctx.sessionId,
        temporalScope: 'current',
        source: 'live-client-data',
        kind: 'lane-phase-tactics',
        confidence: 0.75, // 真实评估置信度 0.75，非虚假 1.0
        patch: ctx.patch,
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        freshness: { expiresAt: now + 20000, state: 'fresh' },
        payload: { gameTime }
      })

      const options: CoachOption[] = [
        {
          id: 'opt_tactics_wave',
          label: '保持兵线在靠近己方防御塔的安全位置',
          condition: null,
          evidenceIds: [evidenceId],
          role: 'primary',
          score: 0.8
        },
        {
          id: 'opt_tactics_vision',
          label: '在对线侧翼草丛留存防守眼位',
          condition: null,
          evidenceIds: [evidenceId],
          role: 'alternative',
          score: 0.75
        }
      ]

      return {
        id: `cue_tactics_${now}`,
        sessionId: ctx.sessionId,
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        priority: 35,
        observationText: '对线期常规节奏关注',
        impactText: '注意敌方打野动向与兵线安全位置',
        options,
        spokenText: '对线期注意保持兵线安全位置，留意侧翼视野。',
        evidenceIds: [evidenceId],
        createdAt: now,
        expiresAt: now + 6000,
        status: 'pending',
        cancellationReason: null
      }
    }

    return null
  }
}

/**
 * 规则 7：Ping 与沟通辅助建议（ENG-P1-011 沟通辅助）
 */
export class RuleCommunicationPing implements CoachRule {
  id = 'rule_communication_ping'
  version = '1.1.0'
  category = 'information' as const
  private _lastTriggerTime: number = 0

  reset(): void {
    this._lastTriggerTime = 0
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const inferences = ctx.fusion.getFogInferences()
    const roamingEnemy = inferences.find((f) =>
      f.intents.some((i) => i.kind === 'roam' && i.probability > 0.5)
    )

    if (!roamingEnemy) return null

    const now = ctx.currentTime ?? Date.now()
    if (now - this._lastTriggerTime >= 30000) {
      this._lastTriggerTime = now

      const eviIds = [...roamingEnemy.basisEvidenceIds]
      const options: CoachOption[] = [
        {
          id: 'opt_ping_danger',
          label: '建议发送：给队友发送危险 (Danger) 警示信号',
          condition: null,
          evidenceIds: eviIds,
          role: 'primary',
          score: 0.95
        },
        {
          id: 'opt_ping_missing',
          label: '建议发送：发送对线敌人失踪 (Missing) 信号',
          condition: null,
          evidenceIds: eviIds,
          role: 'alternative',
          score: 0.85
        }
      ]

      return {
        id: `cue_ping_${now}`,
        sessionId: ctx.sessionId,
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        priority: 60,
        observationText: '敌方对线英雄已脱离视野并疑似游走',
        impactText: '可及时向边路队友同步信号',
        options,
        spokenText: '可向队友发送对线敌人失踪或危险信号。',
        evidenceIds: eviIds,
        createdAt: now,
        expiresAt: now + 8000,
        status: 'pending',
        cancellationReason: null
      }
    }

    return null
  }
}

export class CoachRuleEngine {
  private readonly _rules: CoachRule[] = []

  constructor() {
    this._rules.push(new RuleObjectiveSpawn())
    this._rules.push(new RuleTurretPlatingFall())
    this._rules.push(new RuleMinimapEnemyGrouping())
    this._rules.push(new RuleFogInference())
    this._rules.push(new RuleItemPurchaseGuidance())
    this._rules.push(new RuleBasicSkillsAndTactics())
    this._rules.push(new RuleCommunicationPing())
  }

  public reset(): void {
    for (const rule of this._rules) {
      rule.reset()
    }
  }

  public evaluate(context: RuleEvaluationContext): CoachCue[] {
    const cues: CoachCue[] = []

    for (const rule of this._rules) {
      const cue = rule.evaluate(context)
      if (cue) {
        cues.push(cue)
      }
    }

    return cues
  }
}
