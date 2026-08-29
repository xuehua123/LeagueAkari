import { CoachCue, CoachOption } from '@shared/types/live-coach'
import { NormalizedGameEvent } from '@shared/types/live-game-data'

import type { CoachRule, RuleEvaluationContext } from './rule-engine'

function addLiveDataEvidence(
  context: RuleEvaluationContext,
  now: number,
  kind: string,
  payload: unknown,
  suffix: string,
  expiresInMs: number
): string {
  const evidenceId = `evi_${kind}_${suffix}`
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

function createCue(
  context: RuleEvaluationContext,
  params: {
    idPrefix: string
    rule: CoachRule
    now: number
    priority: number
    observationText: string
    impactText: string | null
    spokenText: string
    evidenceIds: string[]
    options?: CoachOption[]
    expiresInMs?: number
  }
): CoachCue {
  return {
    id: `${params.idPrefix}_${params.now}`,
    sessionId: context.sessionId,
    ruleId: params.rule.id,
    ruleVersion: params.rule.version,
    category: params.rule.category,
    priority: params.priority,
    observationText: params.observationText,
    impactText: params.impactText,
    options: params.options ?? [],
    spokenText: params.spokenText,
    evidenceIds: params.evidenceIds,
    createdAt: params.now,
    expiresAt: params.now + (params.expiresInMs ?? 6000),
    status: 'pending',
    cancellationReason: null
  }
}

/**
 * 消费 Live Client Data 中本人的死亡状态与复活倒计时，只在状态边沿产生提示。
 */
export class RuleSelfDeathAndRespawn implements CoachRule {
  public readonly id = 'rule_self_death_and_respawn'
  public readonly version = '1.0.0'
  public readonly category = 'system' as const

  private _previousDead: boolean | null = null
  private _respawnSoonEmitted = false

  public reset(): void {
    this._previousDead = null
    this._respawnSoonEmitted = false
  }

  public evaluate(context: RuleEvaluationContext): CoachCue | null {
    const player = context.fusion.getActivePlayer()
    if (!player) return null

    const now = context.currentTime ?? Date.now()
    const isDead = player.isDead || player.respawnTimer > 0
    const wasDead = this._previousDead
    this._previousDead = isDead

    if (!context.enabledCategories[this.category]) {
      if (!isDead) this._respawnSoonEmitted = false
      return null
    }

    if (isDead && wasDead !== true) {
      this._respawnSoonEmitted = false
      const evidenceId = addLiveDataEvidence(
        context,
        now,
        'self-death-state',
        { championId: player.championId, respawnTimer: player.respawnTimer },
        String(now),
        15000
      )
      const seconds = Math.max(0, Math.ceil(player.respawnTimer))
      return createCue(context, {
        idPrefix: 'cue_self_death',
        rule: this,
        now,
        priority: 55,
        observationText:
          seconds > 0 ? `本人已阵亡，预计 ${seconds} 秒后复活` : '本人当前处于阵亡状态',
        impactText: '阵亡期间降低普通提醒密度，仅保留重要地图与系统信息',
        spokenText: seconds > 0 ? `你已阵亡，预计 ${seconds} 秒后复活。` : '你当前处于阵亡状态。',
        evidenceIds: [evidenceId],
        expiresInMs: 8000
      })
    }

    if (
      isDead &&
      !this._respawnSoonEmitted &&
      player.respawnTimer > 0 &&
      player.respawnTimer <= 5
    ) {
      this._respawnSoonEmitted = true
      const seconds = Math.max(1, Math.ceil(player.respawnTimer))
      const evidenceId = addLiveDataEvidence(
        context,
        now,
        'self-respawn-timing',
        { championId: player.championId, respawnTimer: player.respawnTimer },
        String(now),
        7000
      )
      return createCue(context, {
        idPrefix: 'cue_self_respawn_soon',
        rule: this,
        now,
        priority: 50,
        observationText: `本人将在约 ${seconds} 秒后复活`,
        impactText: '可以提前查看地图和下一步路线',
        spokenText: `还有 ${seconds} 秒复活，可以提前查看地图。`,
        evidenceIds: [evidenceId],
        expiresInMs: 5000
      })
    }

    if (!isDead && wasDead === true) {
      this._respawnSoonEmitted = false
      const evidenceId = addLiveDataEvidence(
        context,
        now,
        'self-respawn-state',
        { championId: player.championId },
        String(now),
        8000
      )
      return createCue(context, {
        idPrefix: 'cue_self_respawned',
        rule: this,
        now,
        priority: 45,
        observationText: '本人已经复活',
        impactText: '重新确认地图信息后再选择路线',
        spokenText: '你已经复活，先确认地图信息再选择路线。',
        evidenceIds: [evidenceId]
      })
    }

    return null
  }
}

abstract class RuleTeamDeathThreshold implements CoachRule {
  public abstract readonly id: string
  public readonly version = '1.0.0'
  public abstract readonly category: 'warning' | 'opportunity'

  private _thresholdActive = false

  protected abstract readonly _target: 'ally' | 'enemy'

  public reset(): void {
    this._thresholdActive = false
  }

  public evaluate(context: RuleEvaluationContext): CoachCue | null {
    const activePlayer = context.fusion.getActivePlayer()
    if (!activePlayer || activePlayer.team === 'UNKNOWN') return null

    const targetTeam =
      this._target === 'ally'
        ? activePlayer.team
        : activePlayer.team === 'ORDER'
          ? 'CHAOS'
          : 'ORDER'
    const deadPlayers = context.fusion
      .getPlayers()
      .filter(
        (player) =>
          player.team === targetTeam && (player.isDead || Math.max(0, player.respawnTimer) > 0)
      )
    const thresholdReached = deadPlayers.length >= 3
    const shouldEmit = thresholdReached && !this._thresholdActive
    this._thresholdActive = thresholdReached

    if (!shouldEmit || !context.enabledCategories[this.category]) return null

    const now = context.currentTime ?? Date.now()
    const evidenceId = addLiveDataEvidence(
      context,
      now,
      `${this._target}-team-multiple-deaths`,
      {
        count: deadPlayers.length,
        championIds: deadPlayers.map((player) => player.championId).filter(Boolean)
      },
      String(now),
      12000
    )

    if (this._target === 'ally') {
      const options: CoachOption[] = [
        {
          id: 'opt_ally_deaths_safe',
          label: '保持安全并等待队友复活',
          condition: '当前可用人数不足',
          evidenceIds: [evidenceId],
          role: 'primary',
          score: 0.9
        }
      ]
      if (context.enabledCapabilities?.has('coach.communication.chat')) {
        options.push({
          id: 'opt_chat_retreat',
          label: '建议喊话：先撤退，等待队友',
          condition: '仅在用户明确确认后复制模板，不自动输入或发送',
          evidenceIds: [evidenceId],
          role: 'alternative',
          score: 0.82
        })
      }
      return createCue(context, {
        idPrefix: 'cue_ally_multiple_deaths',
        rule: this,
        now,
        priority: 72,
        observationText: `己方当前有 ${deadPlayers.length} 人阵亡`,
        impactText: '当前可用人数不足，避免继续扩大损失',
        spokenText: `己方当前有 ${deadPlayers.length} 人阵亡，注意避免少打多。`,
        evidenceIds: [evidenceId],
        options
      })
    }

    const options: CoachOption[] = [
      {
        id: 'opt_enemy_deaths_objective',
        label: '评估附近资源或推进机会',
        condition: '先确认兵线、血量与可见敌人',
        evidenceIds: [evidenceId],
        role: 'primary',
        score: 0.82
      }
    ]
    if (context.enabledCapabilities?.has('coach.communication.chat')) {
      options.push({
        id: 'opt_chat_push',
        label: '建议喊话：可以推进兵线',
        condition: '仅在兵线和可见敌人支持推进时确认',
        evidenceIds: [evidenceId],
        role: 'alternative',
        score: 0.7
      })
    } else {
      options.push({
        id: 'opt_enemy_deaths_reset',
        label: '条件不足时安全回城更新装备',
        condition: '兵线、血量或视野不支持继续推进',
        evidenceIds: [evidenceId],
        role: 'alternative',
        score: 0.68
      })
    }
    return createCue(context, {
      idPrefix: 'cue_enemy_multiple_deaths',
      rule: this,
      now,
      priority: 62,
      observationText: `敌方当前有 ${deadPlayers.length} 人阵亡`,
      impactText: '存在推进、资源或重置节奏的选择窗口',
      spokenText: `敌方当前有 ${deadPlayers.length} 人阵亡，可以评估推进或资源机会。`,
      evidenceIds: [evidenceId],
      options
    })
  }
}

export class RuleAllyTeamMultipleDeaths extends RuleTeamDeathThreshold {
  public readonly id = 'rule_ally_team_multiple_deaths'
  public readonly category = 'warning' as const
  protected readonly _target = 'ally' as const
}

export class RuleEnemyTeamMultipleDeaths extends RuleTeamDeathThreshold {
  public readonly id = 'rule_enemy_team_multiple_deaths'
  public readonly category = 'opportunity' as const
  protected readonly _target = 'enemy' as const
}

function getEventKey(event: NormalizedGameEvent): string {
  return event.eventId > 0
    ? String(event.eventId)
    : `${event.eventName}:${event.eventTime}:${JSON.stringify(event.payload)}`
}

function getObjectiveEventLabel(event: NormalizedGameEvent): string | null {
  switch (event.eventName) {
    case 'DragonKill':
      return typeof event.payload.DragonType === 'string'
        ? `${event.payload.DragonType}巨龙`
        : '巨龙'
    case 'BaronKill':
      return '纳什男爵'
    case 'HeraldKill':
      return '峡谷先锋'
    case 'HordeKill':
      return '虚空巢虫'
    default:
      return null
  }
}

/**
 * 只播报会话开始后新增的已发生中立资源事件；不会在重连时补播整个事件历史。
 */
export class RuleObjectiveOccurred implements CoachRule {
  public readonly id = 'rule_objective_occurred'
  public readonly version = '1.0.0'
  public readonly category = 'information' as const

  private _initialized = false
  private readonly _seenEventKeys = new Set<string>()

  public reset(): void {
    this._initialized = false
    this._seenEventKeys.clear()
  }

  public evaluate(context: RuleEvaluationContext): CoachCue | null {
    const objectiveEvents = context.fusion
      .getGameEvents()
      .filter((event) => getObjectiveEventLabel(event) !== null)
      .sort((left, right) => left.eventTime - right.eventTime)

    if (!this._initialized) {
      for (const event of objectiveEvents) this._seenEventKeys.add(getEventKey(event))
      this._initialized = true
      return null
    }

    const newEvents = objectiveEvents.filter(
      (event) => !this._seenEventKeys.has(getEventKey(event))
    )
    for (const event of newEvents) this._seenEventKeys.add(getEventKey(event))

    const event = newEvents.at(-1)
    if (
      !event ||
      !context.enabledCategories[this.category] ||
      context.enabledCategories.resource === false
    ) {
      return null
    }

    const label = getObjectiveEventLabel(event)
    if (!label) return null
    const now = context.currentTime ?? Date.now()
    const eventKey = getEventKey(event)
    const evidenceId = addLiveDataEvidence(
      context,
      now,
      'objective-event-occurred',
      event,
      eventKey.replaceAll(/[^a-zA-Z0-9_-]/g, '_'),
      12000
    )

    return createCue(context, {
      idPrefix: 'cue_objective_occurred',
      rule: this,
      now,
      priority: 58,
      observationText: `${label}已被击杀`,
      impactText: '这是已经发生的对局事件，不代表下一步行动必须固定',
      spokenText: `${label}已经被击杀。`,
      evidenceIds: [evidenceId],
      expiresInMs: 8000
    })
  }
}
