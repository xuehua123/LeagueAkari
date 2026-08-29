import { CoachCue, CoachOption, coachCueSchema } from '@shared/types/live-coach'

import { CURRENT_RIOT_ITEM_CATALOG } from './catalog/current'
import { RuleCombatFundamentals, RuleSkillPointGuidance } from './combat-guidance-controller'
import {
  RuleAllyTeamMultipleDeaths,
  RuleEnemyTeamMultipleDeaths,
  RuleObjectiveOccurred,
  RuleSelfDeathAndRespawn
} from './event-guidance-controller'
import { FactFusionEngine } from './fact-fusion'
import { RuleHighPriorityMinimapChange } from './map-change-guidance-controller'
import { toChineseMinimapRegionLabel } from './minimap-region-labels'

export interface RuleEvaluationContext {
  sessionId: string
  patch: string
  queueId?: number | null
  fusion: FactFusionEngine
  enabledCategories: Record<string, boolean>
  enabledCapabilities?: Set<string>
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
    if (ctx.enabledCategories.resource === false) return null
    if (ctx.enabledCapabilities && !ctx.enabledCapabilities.has('coach.track.cooldowns')) {
      return null
    }

    const gameTime = ctx.fusion.getGameTimeSeconds()
    if (gameTime === null) return null

    const schedule = ctx.fusion.getNextObjectiveSchedule(gameTime, ctx.patch, ctx.queueId ?? null)
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
        }
      ]
      if (ctx.enabledCapabilities?.has('coach.communication.chat')) {
        const shouldGroup = schedule.name === '峡谷先锋' || schedule.name === '纳什男爵'
        options.push({
          id: shouldGroup ? 'opt_chat_group' : 'opt_chat_resource',
          label: shouldGroup ? '建议喊话：请集合' : '建议喊话：准备争夺资源',
          condition: shouldGroup
            ? '仅在队伍确实准备接近该资源时确认'
            : '仅在用户明确确认后复制模板，不自动输入或发送',
          evidenceIds: [evidenceId],
          role: 'alternative',
          score: shouldGroup ? 0.64 : 0.68
        })
      } else {
        options.push({
          id: 'opt_obj_lanes',
          label: '留意附近对线人员集结',
          condition: null,
          evidenceIds: [evidenceId],
          role: 'alternative',
          score: 0.7
        })
      }

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
    if (ctx.enabledCapabilities && !ctx.enabledCapabilities.has('coach.track.cooldowns')) {
      return null
    }

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
 * 规则 3：小地图局部敌方多人聚集预警（基于欧氏几何空间距离聚类算法）
 */
export class RuleMinimapEnemyGrouping implements CoachRule {
  id = 'rule_minimap_enemy_grouping'
  version = '1.1.0'
  category = 'warning' as const
  private _lastTriggerTime: number = 0

  reset(): void {
    this._lastTriggerTime = 0
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null
    if (ctx.enabledCapabilities && !ctx.enabledCapabilities.has('coach.analyze.minimap-advanced')) {
      return null
    }

    const now = ctx.currentTime ?? Date.now()
    const entities = ctx.fusion.getMinimapEntities(now)
    const enemyEntities = entities.filter(
      (e) => (e.kind === 'enemy' || e.team === 'enemy') && e.lifecycle !== 'invalidated'
    )

    if (enemyEntities.length < 3) {
      return null
    }

    // 空间聚类：检查是否有 >= 3 名敌人在归一化小地图距离 < 0.18 内
    let targetCluster: typeof enemyEntities = []
    for (let i = 0; i < enemyEntities.length; i++) {
      const cluster = [enemyEntities[i]]
      for (let j = 0; j < enemyEntities.length; j++) {
        if (i === j) continue
        const dx = enemyEntities[i].point.x - enemyEntities[j].point.x
        const dy = enemyEntities[i].point.y - enemyEntities[j].point.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist <= 0.18) {
          cluster.push(enemyEntities[j])
        }
      }
      if (cluster.length >= 3) {
        targetCluster = cluster
        break
      }
    }

    if (targetCluster.length < 3) {
      return null
    }

    if (now - this._lastTriggerTime >= 30000) {
      this._lastTriggerTime = now

      const eviIds = targetCluster
        .map((e) => ctx.fusion.getMinimapEvidenceId(e.trackId, now))
        .filter((id): id is string => Boolean(id))

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
    if (ctx.enabledCapabilities && !ctx.enabledCapabilities.has('coach.analyze.fog-inference')) {
      return null
    }

    const now = ctx.currentTime ?? Date.now()
    const inferences = ctx.fusion.getFogInferences(now)
    const highRisk = inferences.find((f) => f.confidence >= 0.65 && f.arrivalWindow !== null)

    if (!highRisk || !highRisk.arrivalWindow) return null

    if (now - this._lastTriggerTime >= 25000) {
      this._lastTriggerTime = now

      const topRegion = toChineseMinimapRegionLabel(highRisk.predictedRegions[0]?.regionId)
      const fogEvidenceId = `evi_fog_${highRisk.id}`
      const eviIds = [...highRisk.basisEvidenceIds, fogEvidenceId]

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
  private _announcedPlanKey: string | null = null

  reset(): void {
    this._lastTriggerTime = 0
    this._announcedPlanKey = null
  }

  evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null
    if (ctx.enabledCapabilities && !ctx.enabledCapabilities.has('coach.guidance.item-purchase')) {
      return null
    }

    const now = ctx.currentTime ?? Date.now()
    const guidance = ctx.fusion.getItemPurchaseGuidance(now)
    if (!guidance) {
      this._announcedPlanKey = null
      return null
    }

    // 关键修复：仅当玩家金币真正满足核心装备或组件的购买总额 (missingGold === 0) 时才触发建议！
    const primary = guidance.primaryPlan
    if (!primary || primary.missingGold !== 0 || primary.totalCost <= 0) {
      this._announcedPlanKey = null
      return null
    }

    const planKey = [
      guidance.sessionId,
      guidance.championId,
      guidance.mode,
      primary.itemIds.join(','),
      primary.totalCost,
      primary.reasonCodes.join(',')
    ].join('|')
    if (this._announcedPlanKey === planKey) return null

    if (primary && primary.missingGold === 0 && primary.totalCost > 0) {
      if (now - this._lastTriggerTime >= 40000) {
        this._lastTriggerTime = now
        this._announcedPlanKey = planKey

        const primaryReason = primary.conditions[0] || '核心属性提升'

        // 解析首选装备中文名称
        const primaryItemNames = primary.itemIds
          .map((id) => CURRENT_RIOT_ITEM_CATALOG.items[id]?.name || `装备 ${id}`)
          .join('、')

        // 构造备选方案选项列表
        const altOptions: CoachOption[] = (guidance.alternativePlans || [])
          .slice(0, 1)
          .map((alt, idx) => {
            const altNames = alt.itemIds
              .map((id) => CURRENT_RIOT_ITEM_CATALOG.items[id]?.name || `装备 ${id}`)
              .join('、')
            return {
              id: `opt_item_alt_${idx + 1}`,
              label:
                alt.missingGold === 0
                  ? `备选方案 ${idx + 1}：购买 ${altNames}（花费 ${alt.totalCost}g，余 ${alt.remainingGold}g）`
                  : `备选目标 ${idx + 1}：${altNames}（还差 ${alt.missingGold}g）`,
              condition: alt.conditions[0] || '战术替代出装',
              evidenceIds: guidance.evidenceIds,
              role: 'alternative' as const,
              score: Math.max(0.6, 0.85 - idx * 0.1)
            }
          })

        if (altOptions.length === 0) {
          altOptions.push({
            id: 'opt_item_alt_default',
            label: '备选方案：优先升级靴子或补充控制守卫',
            condition: '移速与视野防守',
            evidenceIds: guidance.evidenceIds,
            role: 'alternative',
            score: 0.7
          })
        }

        const options: CoachOption[] = [
          {
            id: 'opt_item_primary',
            label: `首选方案：购买 ${primaryItemNames}（花费 ${primary.totalCost}g，余 ${primary.remainingGold}g）`,
            condition: primaryReason,
            evidenceIds: guidance.evidenceIds,
            role: 'primary',
            score: 0.95
          },
          ...altOptions
        ]

        return {
          id: `cue_item_${now}`,
          sessionId: ctx.sessionId,
          ruleId: this.id,
          ruleVersion: this.version,
          category: this.category,
          priority: 40,
          observationText: `持有金币 ${guidance.currentGold}g，满足 ${primaryItemNames} 购买条件`,
          impactText: `回城更新装备可提升对线战力：${primaryReason}`,
          options,
          spokenText: `建议购买 ${primaryItemNames}，花费 ${primary.totalCost} 金币，剩余 ${primary.remainingGold} 金币。`,
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
 * 规则 6：对线期控线与防抓时机提醒（基于红蓝方阵营、敌方打野在迷雾中未出现的事实依据）
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
    // 该规则同时属于迷雾推断和基础指导。任一独立能力关闭时都必须
    // fail-closed，不能借由旧规则绕过用户开关或远程 capability。
    if (
      ctx.enabledCapabilities &&
      (!ctx.enabledCapabilities.has('coach.analyze.minimap-basic') ||
        !ctx.enabledCapabilities.has('coach.analyze.minimap-identity') ||
        !ctx.enabledCapabilities.has('coach.analyze.fog-inference') ||
        !ctx.enabledCapabilities.has('coach.guidance.micro'))
    ) {
      return null
    }

    const gameTime = ctx.fusion.getGameTimeSeconds()
    if (gameTime === null || gameTime < 180 || gameTime > 600) return null

    const now = ctx.currentTime ?? Date.now()
    if (now - this._lastTriggerTime >= 90000) {
      const activePlayer = ctx.fusion.getActivePlayer()
      const myTeam = activePlayer?.team
      if (!myTeam) return null

      const enemyTeam = myTeam === 'ORDER' ? 'CHAOS' : 'ORDER'
      const players = ctx.fusion.getPlayers()
      const minimapEntities = ctx.fusion.getMinimapEntities(ctx.currentTime ?? Date.now())

      // 准确查找敌方阵营的打野英雄
      const enemyJungler = players.find((p) => p.team === enemyTeam && p.position === 'JUNGLE')
      if (!enemyJungler) return null

      // 敌方打野阵亡时无需发出迷雾防抓提醒
      if (enemyJungler.isDead || (enemyJungler.respawnTimer && enemyJungler.respawnTimer > 0)) {
        return null
      }

      // 获取当前小地图所有可见的活跃敌方实体
      const visibleEnemyEntities = minimapEntities.filter(
        (e) => (e.team === 'enemy' || e.kind === 'enemy') && e.lifecycle !== 'invalidated'
      )

      // 检查敌方打野是否确认在小地图上可见：
      // 严格判定准则：
      // 1. 实体必须具有显式 championId 且与 enemyJungler.championId 精确匹配，且轨迹状态为 confirmed
      // 2. 绝对删除 areAllLivingEnemiesVisible 与匿名轨迹数量推断，杜绝误检与匿名图元抑制打野防抓提醒
      const isExplicitlySeen = visibleEnemyEntities.some(
        (e) =>
          enemyJungler.championId &&
          e.championId === enemyJungler.championId &&
          e.lifecycle === 'confirmed'
      )

      const isEnemyJunglerSeen = isExplicitlySeen

      // 当敌方打野处于迷雾中时，触发控线与防抓提醒
      if (!isEnemyJunglerSeen) {
        this._lastTriggerTime = now

        const evidenceId = `evi_tactics_${now}`
        ctx.fusion.addEvidence({
          id: evidenceId,
          sessionId: ctx.sessionId,
          temporalScope: 'current',
          source: 'live-client-data',
          kind: 'lane-phase-tactics',
          confidence: 0.75,
          patch: ctx.patch,
          clock: { observedAt: now, receivedAt: now, sequence: 1 },
          freshness: { expiresAt: now + 20000, state: 'fresh' },
          payload: {
            gameTime,
            myTeam,
            enemyJunglerChampionId: enemyJungler.championId ?? null,
            reason: 'enemy-jungler-in-fog'
          }
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
          priority: 45,
          observationText: '敌方打野位置在迷雾中未知',
          impactText: '注意对线期防抓与兵线安全位置',
          options,
          spokenText: '敌方打野位置未知，对线期注意保持兵线安全位置，留意侧翼视野。',
          evidenceIds: [evidenceId],
          createdAt: now,
          expiresAt: now + 6000,
          status: 'pending',
          cancellationReason: null
        }
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
    if (ctx.enabledCapabilities && !ctx.enabledCapabilities.has('coach.analyze.fog-inference')) {
      return null
    }
    const pingEnabled =
      !ctx.enabledCapabilities || ctx.enabledCapabilities.has('coach.communication.ping')
    const chatEnabled =
      !ctx.enabledCapabilities || ctx.enabledCapabilities.has('coach.communication.chat')
    if (!pingEnabled && !chatEnabled) {
      return null
    }

    const now = ctx.currentTime ?? Date.now()
    const inferences = ctx.fusion.getFogInferences(now)
    const roamingEnemy = inferences.find((f) =>
      f.intents.some((i) => i.kind === 'roam' && i.probability > 0.5)
    )

    if (!roamingEnemy) return null

    if (now - this._lastTriggerTime >= 30000) {
      this._lastTriggerTime = now

      const eviIds = [...roamingEnemy.basisEvidenceIds]
      const options: CoachOption[] = []
      if (pingEnabled) {
        options.push({
          id: 'opt_ping_danger',
          label: '建议发送：给队友发送危险 (Danger) 警示信号',
          condition: null,
          evidenceIds: eviIds,
          role: 'primary',
          score: 0.95
        })
        if (!chatEnabled) {
          options.push({
            id: 'opt_ping_missing',
            label: '建议发送：发送对线敌人失踪 (Missing) 信号',
            condition: null,
            evidenceIds: eviIds,
            role: 'alternative',
            score: 0.85
          })
        }
      }
      if (chatEnabled) {
        options.push({
          id: 'opt_chat_missing',
          label: '建议喊话：敌方失踪，请注意',
          condition: '仅在用户明确确认后复制模板，不自动输入或发送',
          evidenceIds: eviIds,
          role: pingEnabled ? 'alternative' : 'primary',
          score: 0.78
        })
      }

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
    this._rules.push(new RuleSelfDeathAndRespawn())
    this._rules.push(new RuleAllyTeamMultipleDeaths())
    this._rules.push(new RuleEnemyTeamMultipleDeaths())
    this._rules.push(new RuleObjectiveOccurred())
    this._rules.push(new RuleSkillPointGuidance())
    this._rules.push(new RuleCombatFundamentals())
    this._rules.push(new RuleObjectiveSpawn())
    this._rules.push(new RuleTurretPlatingFall())
    this._rules.push(new RuleMinimapEnemyGrouping())
    this._rules.push(new RuleFogInference())
    this._rules.push(new RuleItemPurchaseGuidance())
    this._rules.push(new RuleBasicSkillsAndTactics())
    this._rules.push(new RuleCommunicationPing())
    this._rules.push(new RuleHighPriorityMinimapChange())
  }

  public reset(): void {
    for (const rule of this._rules) {
      rule.reset()
    }
  }

  public evaluate(context: RuleEvaluationContext): CoachCue[] {
    const cues: CoachCue[] = []
    const now = context.currentTime ?? Date.now()

    for (const rule of this._rules) {
      const cue = rule.evaluate(context)
      if (!cue || !coachCueSchema.safeParse(cue).success) continue
      if (cue.sessionId !== context.sessionId || cue.evidenceIds.length === 0) continue
      if (cue.evidenceIds.some((evidenceId) => !context.fusion.getEvidence(evidenceId, now))) {
        continue
      }
      const cueEvidenceIds = new Set(cue.evidenceIds)
      if (
        cue.options.some(
          (option) =>
            option.evidenceIds.length === 0 ||
            option.evidenceIds.some((evidenceId) => !cueEvidenceIds.has(evidenceId))
        )
      ) {
        continue
      }
      cues.push(cue)
    }

    return cues
  }
}
