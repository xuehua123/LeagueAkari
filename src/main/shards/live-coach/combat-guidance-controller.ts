import { CoachCue, CoachOption } from '@shared/types/live-coach'

import {
  CURRENT_OFFICIAL_CHAMPION_CATALOG,
  type ChampionArchetypeRole,
  getChampionRole
} from './catalog/current'
import type { CoachRule, RuleEvaluationContext } from './rule-engine'

type AbilityKey = 'Q' | 'W' | 'E' | 'R'

const ROLE_ABILITY_PRIORITY: Record<ChampionArchetypeRole, AbilityKey[]> = {
  fighter: ['Q', 'E', 'W'],
  mage: ['Q', 'E', 'W'],
  marksman: ['Q', 'E', 'W'],
  tank: ['W', 'Q', 'E'],
  assassin: ['Q', 'E', 'W'],
  support: ['E', 'W', 'Q']
}

const POSITION_GUIDANCE: Record<string, { lane: string; positioning: string; combo: string }> = {
  TOP: {
    lane: '补刀后观察下一波兵线位置，换血前确认敌方打野和河道信息',
    positioning: '兵线过河后靠近已有视野的一侧站位，并保留撤退路线',
    combo: '先用短换血确认对手反应，再决定是否延长交战'
  },
  JUNGLE: {
    lane: '清理当前营地前确认下一处资源、可支援边线和敌方可见位置',
    positioning: '进入河道或敌方野区前确认邻近线路是否拥有支援优先权',
    combo: '先保留关键控制或位移，确认队友能够跟进后再延长交战'
  },
  MIDDLE: {
    lane: '优先完成安全补刀，推线后再根据河道与边路信息选择移动',
    positioning: '站在已有视野一侧，并与敌方可能出现的方向保持距离',
    combo: '先命中稳定控制或消耗技能，再连接主要伤害'
  },
  BOTTOM: {
    lane: '保持补刀节奏，并与辅助位置形成可以互相支援的平行站位',
    positioning: '团战中先保持输出距离，不为追击离开队友保护范围',
    combo: '先等待关键控制命中，再持续输出并保留自保技能'
  },
  UTILITY: {
    lane: '根据兵线位置控制草丛与河道信息，并避免让搭档单独承受压力',
    positioning: '站在能够保护核心队友或限制敌方切入的位置',
    combo: '先用控制或保护技能创造窗口，再衔接伤害或追击'
  },
  UNKNOWN: {
    lane: '优先完成安全补刀，并在移动前确认小地图上的可见信息',
    positioning: '靠近队友与已有视野站位，同时保留撤退路线',
    combo: '先确认关键技能命中，再决定是否继续交战'
  }
}

function addGuidanceEvidence(
  context: RuleEvaluationContext,
  now: number,
  kind: string,
  payload: unknown,
  expiresInMs: number
): string {
  const evidenceId = `evi_${kind}_${now}`
  context.fusion.addEvidence({
    id: evidenceId,
    sessionId: context.sessionId,
    temporalScope: 'current',
    source: 'live-client-data',
    kind,
    confidence: 1,
    patch: context.patch,
    clock: { observedAt: now, receivedAt: now, sequence: 1 },
    freshness: { expiresAt: now + expiresInMs, state: 'fresh' },
    payload
  })
  return evidenceId
}

function createGuidanceCue(
  context: RuleEvaluationContext,
  rule: CoachRule,
  now: number,
  params: {
    idPrefix: string
    priority: number
    observationText: string
    impactText: string | null
    spokenText: string
    evidenceIds: string[]
    options: CoachOption[]
    expiresInMs: number
  }
): CoachCue {
  return {
    id: `${params.idPrefix}_${now}`,
    sessionId: context.sessionId,
    ruleId: rule.id,
    ruleVersion: rule.version,
    category: rule.category,
    priority: params.priority,
    observationText: params.observationText,
    impactText: params.impactText,
    options: params.options,
    spokenText: params.spokenText,
    evidenceIds: params.evidenceIds,
    createdAt: now,
    expiresAt: now + params.expiresInMs,
    status: 'pending',
    cancellationReason: null
  }
}

function getAbilityLevels(
  abilities: Record<string, { abilityLevel: number; displayName?: string }>
): Map<AbilityKey, { level: number; displayName: string | null }> {
  const levels = new Map<AbilityKey, { level: number; displayName: string | null }>()
  for (const [rawKey, ability] of Object.entries(abilities)) {
    const key = rawKey.toUpperCase()
    if (key !== 'Q' && key !== 'W' && key !== 'E' && key !== 'R') continue
    levels.set(key, {
      level: Math.max(0, Math.floor(ability.abilityLevel)),
      displayName: ability.displayName?.trim() || null
    })
  }
  return levels
}

function getRecommendedAbility(
  championLevel: number,
  role: ChampionArchetypeRole,
  abilities: Map<AbilityKey, { level: number; displayName: string | null }>
): AbilityKey | null {
  const expectedUltimateRank =
    championLevel >= 16 ? 3 : championLevel >= 11 ? 2 : championLevel >= 6 ? 1 : 0
  if ((abilities.get('R')?.level ?? 0) < expectedUltimateRank) return 'R'

  const maximumBasicRank = Math.min(5, Math.ceil(championLevel / 2))
  const priority = [...ROLE_ABILITY_PRIORITY[role]].sort((left, right) => {
    const levelDelta = (abilities.get(right)?.level ?? 0) - (abilities.get(left)?.level ?? 0)
    return levelDelta
  })
  return priority.find((key) => (abilities.get(key)?.level ?? 0) < maximumBasicRank) ?? null
}

/**
 * 根据当前英雄、等级和已经形成的加点轨迹提示未分配技能点。
 * 它不宣称替代版本攻略；具体英雄数据不足时明确使用“当前加点轨迹”措辞。
 */
export class RuleSkillPointGuidance implements CoachRule {
  public readonly id = 'rule_skill_point_guidance'
  public readonly version = '1.0.0'
  public readonly category = 'information' as const

  private _lastSuggestionKey: string | null = null

  public reset(): void {
    this._lastSuggestionKey = null
  }

  public evaluate(context: RuleEvaluationContext): CoachCue | null {
    if (!context.enabledCategories[this.category]) return null
    if (context.enabledCapabilities && !context.enabledCapabilities.has('coach.guidance.micro')) {
      return null
    }

    const activeState = context.fusion.getActivePlayerState()
    const player = context.fusion.getActivePlayer()
    if (!activeState || !player || activeState.level <= 0) return null

    const abilities = getAbilityLevels(activeState.abilities)
    if (abilities.size < 4) return null
    const spentPoints = [...abilities.values()].reduce((sum, ability) => sum + ability.level, 0)
    const unspentPoints = Math.max(0, activeState.level - spentPoints)
    if (unspentPoints === 0) return null

    const role = getChampionRole(player.championId, player.championName)
    if (!role) return null
    const abilityKey = getRecommendedAbility(activeState.level, role, abilities)
    if (!abilityKey) return null

    const suggestionKey = `${activeState.level}:${unspentPoints}:${abilityKey}`
    if (suggestionKey === this._lastSuggestionKey) return null
    this._lastSuggestionKey = suggestionKey

    const now = context.currentTime ?? Date.now()
    const abilityName = abilities.get(abilityKey)?.displayName
    const abilityLabel = abilityName ? `${abilityKey}（${abilityName}）` : abilityKey
    const champion = CURRENT_OFFICIAL_CHAMPION_CATALOG[player.championId ?? -1]
    const championLabel = champion?.title || champion?.name || player.championName
    const evidenceId = addGuidanceEvidence(
      context,
      now,
      'skill-point-guidance',
      {
        championId: player.championId,
        championLevel: activeState.level,
        abilityLevels: Object.fromEntries(
          [...abilities.entries()].map(([key, value]) => [key, value.level])
        ),
        recommendedAbility: abilityKey,
        basis: 'current-leveling-trajectory'
      },
      20000
    )

    return createGuidanceCue(context, this, now, {
      idPrefix: 'cue_skill_point',
      priority: 42,
      observationText: `${championLabel}当前有 ${unspentPoints} 个未分配技能点`,
      impactText: `根据当前等级与加点轨迹，可优先升级 ${abilityLabel}`,
      spokenText: `你有未分配技能点，可以优先升级 ${abilityLabel}。`,
      evidenceIds: [evidenceId],
      options: [
        {
          id: `opt_skill_${abilityKey.toLowerCase()}`,
          label: `升级 ${abilityLabel}`,
          condition: '基于当前等级、已分配点数和现有加点轨迹',
          evidenceIds: [evidenceId],
          role: 'primary',
          score: 0.78
        }
      ],
      expiresInMs: 12000
    })
  }
}

function getThreatGuidance(context: RuleEvaluationContext): string {
  const activePlayer = context.fusion.getActivePlayer()
  if (!activePlayer || activePlayer.team === 'UNKNOWN') return '交战前确认敌方五人位置与关键技能'
  const enemyTeam = activePlayer.team === 'ORDER' ? 'CHAOS' : 'ORDER'
  const enemyRoles = context.fusion
    .getPlayers()
    .filter((player) => player.team === enemyTeam)
    .map((player) => getChampionRole(player.championId, player.championName))

  const assassins = enemyRoles.filter((role) => role === 'assassin').length
  const tanks = enemyRoles.filter((role) => role === 'tank').length
  const rangedDamage = enemyRoles.filter((role) => role === 'mage' || role === 'marksman').length
  if (assassins >= 2) return '敌方切入威胁较多，团战优先保留自保与保护技能'
  if (tanks >= 2) return '敌方前排较多，避免把全部关键技能交给同一个前排目标'
  if (rangedDamage >= 3) return '敌方远程伤害较多，利用视野盲区和侧向角度缩短暴露时间'
  return '交战前确认敌方五人位置，并保留应对关键控制的空间'
}

/**
 * 一期基础补刀、控线、走位、连招与五人阵容应对提示。只在阶段切换时输出一次。
 */
export class RuleCombatFundamentals implements CoachRule {
  public readonly id = 'rule_combat_fundamentals'
  public readonly version = '1.0.0'
  public readonly category = 'information' as const

  private readonly _emittedPhases = new Set<string>()

  public reset(): void {
    this._emittedPhases.clear()
  }

  public evaluate(context: RuleEvaluationContext): CoachCue | null {
    if (!context.enabledCategories[this.category]) return null
    if (context.enabledCapabilities && !context.enabledCapabilities.has('coach.guidance.micro')) {
      return null
    }

    const player = context.fusion.getActivePlayer()
    const gameTime = context.fusion.getGameTimeSeconds()
    if (!player || gameTime === null || gameTime < 90) return null

    const phase = gameTime < 600 ? 'lane' : gameTime < 1200 ? 'mid' : 'late'
    if (this._emittedPhases.has(phase)) return null
    this._emittedPhases.add(phase)

    const now = context.currentTime ?? Date.now()
    const guidance = POSITION_GUIDANCE[player.position.toUpperCase()] ?? POSITION_GUIDANCE.UNKNOWN
    const threat = getThreatGuidance(context)
    const evidenceId = addGuidanceEvidence(
      context,
      now,
      'combat-fundamentals',
      {
        gameTime,
        phase,
        position: player.position,
        championId: player.championId,
        enemyChampionIds: context.fusion
          .getPlayers()
          .filter((candidate) => candidate.team !== player.team)
          .map((candidate) => candidate.championId)
      },
      30000
    )

    return createGuidanceCue(context, this, now, {
      idPrefix: 'cue_combat_fundamentals',
      // Balanced mode accepts priority >= 40. Phase-one fundamentals are a
      // required standard-mode feature, so they must not be consumed by the
      // rule's once-per-phase latch and then silently filtered by the scheduler.
      priority: 45,
      observationText: phase === 'lane' ? '当前处于基础对线阶段' : '当前对局阶段已经变化',
      impactText: threat,
      spokenText: phase === 'lane' ? guidance.lane : threat,
      evidenceIds: [evidenceId],
      options: [
        {
          id: `opt_fundamentals_position_${phase}`,
          label: phase === 'lane' ? guidance.lane : guidance.positioning,
          condition: '结合当前地图直接观测再执行',
          evidenceIds: [evidenceId],
          role: 'primary',
          score: 0.75
        },
        {
          id: `opt_fundamentals_combo_${phase}`,
          label: guidance.combo,
          condition: '只作为基础连招原则，不代替实时技能命中判断',
          evidenceIds: [evidenceId],
          role: 'alternative',
          score: 0.62
        }
      ],
      expiresInMs: 15000
    })
  }
}
