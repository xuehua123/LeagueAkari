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
}

export class RuleObjectiveSpawn implements CoachRule {
  id = 'rule_objective_spawn'
  version = '1.0.0'
  category = 'information' as const
  private _lastTriggeredMinute: number = -1

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const gameTime = ctx.fusion.getGameTimeSeconds()
    if (gameTime === null || gameTime < 240) return null

    // Dragon spawn warning every 5 mins after minute 5
    const minute = Math.floor(gameTime / 60)
    if (minute % 5 === 4 && gameTime % 60 >= 30 && this._lastTriggeredMinute !== minute) {
      this._lastTriggeredMinute = minute
      const now = Date.now()

      const options: CoachOption[] = [
        { id: 'opt_dragon_ward', label: '提前布置河道视野', condition: null, evidenceIds: [] },
        { id: 'opt_dragon_lane', label: '推线争夺中下线权', condition: null, evidenceIds: [] }
      ]

      return {
        id: `cue_obj_${now}`,
        sessionId: ctx.sessionId,
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        priority: 50,
        observationText: '中立资源即将刷新（约 30 秒内）',
        impactText: '龙坑区域可能爆发争夺',
        options,
        spokenText: '巨龙即将刷新，可以提前布置龙坑视野或抢占兵线线权。',
        evidenceIds: [],
        createdAt: now,
        expiresAt: now + 6000,
        status: 'pending',
        cancellationReason: null
      }
    }

    return null
  }
}

export class RuleGoldSpendSuggestion implements CoachRule {
  id = 'rule_gold_spend'
  version = '1.0.0'
  category = 'opportunity' as const
  private _lastTriggeredGold: number = 0

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const snapshot = ctx.fusion.getLiveGameSnapshot()
    const active = snapshot?.activePlayer
    if (!active) return null

    if (active.currentGold >= 1600 && active.currentGold - this._lastTriggeredGold >= 800) {
      this._lastTriggeredGold = active.currentGold
      const now = Date.now()

      const options: CoachOption[] = [
        { id: 'opt_recall_buy', label: '推完兵线后回城更新大件', condition: null, evidenceIds: [] },
        { id: 'opt_stay_tempo', label: '跟随队友抱团推进', condition: null, evidenceIds: [] }
      ]

      return {
        id: `cue_gold_${now}`,
        sessionId: ctx.sessionId,
        ruleId: this.id,
        ruleVersion: this.version,
        category: this.category,
        priority: 45,
        observationText: `持有较多未消费金币（${Math.floor(active.currentGold)} G）`,
        impactText: '装备领先未转化为实际即战力',
        options,
        spokenText: `你当前积累了超过一千五百金币，建议推完线后寻找时机回城更新核心装备。`,
        evidenceIds: [],
        createdAt: now,
        expiresAt: now + 8000,
        status: 'pending',
        cancellationReason: null
      }
    }

    return null
  }
}

export class RuleMinimapEnemyGrouping implements CoachRule {
  id = 'rule_minimap_enemy_grouping'
  version = '1.0.0'
  category = 'warning' as const
  private _lastTriggerTime: number = 0

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null

    const entities = ctx.fusion.getMinimapEntities()
    const enemyEntities = entities.filter((e) => e.team === 'enemy')

    const now = Date.now()
    if (enemyEntities.length >= 3 && now - this._lastTriggerTime >= 20000) {
      this._lastTriggerTime = now
      const eviIds = enemyEntities.map((e) => `evi_minimap_${e.trackId}`)

      const options: CoachOption[] = [
        { id: 'opt_retreat', label: '向安全防御塔方向靠拢', condition: null, evidenceIds: eviIds },
        {
          id: 'opt_counter_push',
          label: '转向另一侧分推交换',
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
        observationText: `小地图局部聚集 ${enemyEntities.length} 名敌方单位`,
        impactText: '局部存在多打少风险',
        options,
        spokenText: `小地图刚刚出现多名敌方单位聚集，注意后撤防守或交换另一侧资源。`,
        evidenceIds: eviIds,
        createdAt: now,
        expiresAt: now + 5000,
        status: 'pending',
        cancellationReason: null
      }
    }

    return null
  }
}

export class CoachRuleEngine {
  private readonly _rules: CoachRule[] = [
    new RuleMinimapEnemyGrouping(),
    new RuleObjectiveSpawn(),
    new RuleGoldSpendSuggestion()
  ]

  public evaluate(context: RuleEvaluationContext): CoachCue[] {
    const cues: CoachCue[] = []
    for (const rule of this._rules) {
      try {
        const cue = rule.evaluate(context)
        if (cue) {
          cues.push(cue)
        }
      } catch {
        // Safe rule isolation
      }
    }
    return cues
  }
}
