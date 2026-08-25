import { CoachCue, CoachOption } from '@shared/types/live-coach'

import { FactFusionEngine } from './fact-fusion'

export interface RuleEvaluationContext {
  sessionId: string
  patch: string
  fusion: FactFusionEngine
  enabledCategories: Record<string, boolean>
}

export interface CoachRule {
  id: string
  version: string
  category: 'information' | 'warning' | 'opportunity' | 'system' | 'review'
  evaluate(context: RuleEvaluationContext): CoachCue | null
  reset(): void
}

/**
 * 规则 1：中立资源（巨龙 / 峡谷先锋 / 男爵）即将刷新提醒（第一期合规：纯客观事实与关注提示）
 */
export class RuleObjectiveSpawn implements CoachRule {
  id = 'rule_objective_spawn'
  version = '1.1.0'
  category = 'information' as const
  private _lastTriggeredMinute: number = -1

  reset(): void {
    this._lastTriggeredMinute = -1
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const gameTime = ctx.fusion.getGameTimeSeconds()
    if (gameTime === null || gameTime < 240) return null

    const minute = Math.floor(gameTime / 60)
    if (minute % 5 === 4 && gameTime % 60 >= 30 && this._lastTriggeredMinute !== minute) {
      this._lastTriggeredMinute = minute
      const now = Date.now()

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
        payload: { minute, gameTime }
      })

      const options: CoachOption[] = [
        {
          id: 'opt_obj_river',
          label: '关注河道与龙坑动向',
          condition: null,
          evidenceIds: [evidenceId]
        },
        {
          id: 'opt_obj_lanes',
          label: '留意中下路对线状态',
          condition: null,
          evidenceIds: [evidenceId]
        }
      ]

      return {
        id: `cue_obj_${now}`,
        sessionId: ctx.sessionId,
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        priority: 50,
        observationText: '中立资源即将刷新（约 30 秒内）',
        impactText: '河道与龙坑区域可能存在敌方动向',
        options,
        spokenText: '巨龙即将在 30 秒内刷新，注意河道动态。',
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
      const now = Date.now()

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
          evidenceIds: [evidenceId]
        },
        {
          id: 'opt_plate_lanes',
          label: '关注各路防御塔状态',
          condition: null,
          evidenceIds: [evidenceId]
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
 * 规则 3：小地图局部敌人聚集预警（基于 2D 空间聚类计算，第一期合规纯事实播报）
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

    const now = Date.now()
    if (now - this._lastTriggerTime >= 20000) {
      this._lastTriggerTime = now

      // 提取该聚类中所有敌方实体的真实证据 ID
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
          evidenceIds: eviIds
        },
        {
          id: 'opt_group_safe',
          label: '保持安全防范距离',
          condition: null,
          evidenceIds: eviIds
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

export class CoachRuleEngine {
  private readonly _rules: CoachRule[] = []

  constructor() {
    this._rules.push(new RuleObjectiveSpawn())
    this._rules.push(new RuleTurretPlatingFall())
    this._rules.push(new RuleMinimapEnemyGrouping())
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
