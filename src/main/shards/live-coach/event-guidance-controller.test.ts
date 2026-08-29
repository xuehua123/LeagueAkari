import { coachCueSchema } from '@shared/types/live-coach'
import { LiveGameSnapshot, NormalizedPlayer } from '@shared/types/live-game-data'
import { describe, expect, it } from 'vitest'

import { FactFusionEngine } from './fact-fusion'
import { CoachRuleEngine } from './rule-engine'

function createPlayer(
  championName: string,
  team: 'ORDER' | 'CHAOS',
  patch: Partial<NormalizedPlayer> = {}
): NormalizedPlayer {
  return {
    summonerName: championName,
    riotId: `${championName}#TEST`,
    riotIdGameName: championName,
    riotIdTagLine: 'TEST',
    championName,
    championId: championName === 'Player' ? 1 : null,
    team,
    position: 'MIDDLE',
    level: 8,
    isDead: false,
    respawnTimer: 0,
    isBot: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 70,
    wardScore: 5,
    items: [],
    summonerSpells: {},
    ...patch
  }
}

function createSnapshot(
  now: number,
  players: NormalizedPlayer[],
  events: LiveGameSnapshot['events'] = []
): LiveGameSnapshot {
  return {
    sessionId: 'session-events',
    patch: '16.16.1',
    gameTimeSeconds: 480,
    activePlayer: {
      summonerName: 'Player',
      riotId: 'Player#TEST',
      riotIdGameName: 'Player',
      riotIdTagLine: 'TEST',
      championName: 'Player',
      level: 8,
      currentGold: 0,
      team: 'ORDER',
      abilities: {}
    },
    players,
    events,
    sourceHealth: [],
    clock: { observedAt: now, receivedAt: now, sequence: 1 }
  }
}

function evaluate(
  engine: CoachRuleEngine,
  fusion: FactFusionEngine,
  now: number,
  enabledCapabilities = new Set<string>()
) {
  return engine.evaluate({
    sessionId: 'session-events',
    patch: '16.16.1',
    fusion,
    enabledCategories: {
      information: true,
      warning: true,
      opportunity: true,
      system: true,
      review: true
    },
    enabledCapabilities,
    currentTime: now
  })
}

describe('Phase 1 live event guidance', () => {
  it('emits self death, imminent respawn and completed respawn only on state edges', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const base = 1_700_000_000_000

    fusion.updateLiveGameSnapshot(createSnapshot(base, [createPlayer('Player', 'ORDER')]), base)
    expect(evaluate(engine, fusion, base).some((cue) => cue.ruleId.includes('self_death'))).toBe(
      false
    )

    fusion.updateLiveGameSnapshot(
      createSnapshot(base + 1000, [
        createPlayer('Player', 'ORDER', { isDead: true, respawnTimer: 18 })
      ]),
      base + 1000
    )
    expect(
      evaluate(engine, fusion, base + 1000).find(
        (cue) => cue.ruleId === 'rule_self_death_and_respawn'
      )?.observationText
    ).toContain('已阵亡')

    fusion.updateLiveGameSnapshot(
      createSnapshot(base + 2000, [
        createPlayer('Player', 'ORDER', { isDead: true, respawnTimer: 4 })
      ]),
      base + 2000
    )
    expect(
      evaluate(engine, fusion, base + 2000).find(
        (cue) => cue.ruleId === 'rule_self_death_and_respawn'
      )?.observationText
    ).toContain('4 秒后复活')

    expect(
      evaluate(engine, fusion, base + 2500).filter(
        (cue) => cue.ruleId === 'rule_self_death_and_respawn'
      )
    ).toHaveLength(0)

    fusion.updateLiveGameSnapshot(
      createSnapshot(base + 5000, [createPlayer('Player', 'ORDER')]),
      base + 5000
    )
    expect(
      evaluate(engine, fusion, base + 5000).find(
        (cue) => cue.ruleId === 'rule_self_death_and_respawn'
      )?.observationText
    ).toBe('本人已经复活')
  })

  it('emits ally and enemy multiple-death cues only when crossing the threshold', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const base = 1_700_000_100_000
    const alivePlayers = [
      createPlayer('Player', 'ORDER'),
      createPlayer('Ally2', 'ORDER'),
      createPlayer('Ally3', 'ORDER'),
      createPlayer('Enemy1', 'CHAOS'),
      createPlayer('Enemy2', 'CHAOS'),
      createPlayer('Enemy3', 'CHAOS')
    ]

    fusion.updateLiveGameSnapshot(createSnapshot(base, alivePlayers), base)
    const communicationCapabilities = new Set(['coach.communication.chat'])
    evaluate(engine, fusion, base, communicationCapabilities)

    const deadPlayers = alivePlayers.map((player) =>
      ['Player', 'Ally2', 'Ally3', 'Enemy1', 'Enemy2', 'Enemy3'].includes(player.championName)
        ? { ...player, isDead: true, respawnTimer: 20 }
        : player
    )
    fusion.updateLiveGameSnapshot(createSnapshot(base + 1000, deadPlayers), base + 1000)
    const firstCues = evaluate(engine, fusion, base + 1000, communicationCapabilities)
    const allyDeathsCue = firstCues.find((cue) => cue.ruleId === 'rule_ally_team_multiple_deaths')
    const enemyDeathsCue = firstCues.find((cue) => cue.ruleId === 'rule_enemy_team_multiple_deaths')
    expect(allyDeathsCue?.options.map((option) => option.id)).toEqual([
      'opt_ally_deaths_safe',
      'opt_chat_retreat'
    ])
    expect(enemyDeathsCue?.options.map((option) => option.id)).toEqual([
      'opt_enemy_deaths_objective',
      'opt_chat_push'
    ])
    expect(coachCueSchema.safeParse(allyDeathsCue).success).toBe(true)
    expect(coachCueSchema.safeParse(enemyDeathsCue).success).toBe(true)

    const repeatedCues = evaluate(engine, fusion, base + 2000, communicationCapabilities)
    expect(repeatedCues.some((cue) => cue.ruleId.includes('team_multiple_deaths'))).toBe(false)

    fusion.updateLiveGameSnapshot(createSnapshot(base + 3000, alivePlayers), base + 3000)
    evaluate(engine, fusion, base + 3000, communicationCapabilities)
    fusion.updateLiveGameSnapshot(createSnapshot(base + 4000, deadPlayers), base + 4000)
    const secondCrossing = evaluate(engine, fusion, base + 4000, communicationCapabilities)
    expect(secondCrossing.some((cue) => cue.ruleId === 'rule_ally_team_multiple_deaths')).toBe(true)
    expect(secondCrossing.some((cue) => cue.ruleId === 'rule_enemy_team_multiple_deaths')).toBe(
      true
    )
  })

  it('reports only new objective events and never replays the event history on initialization', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const base = 1_700_000_200_000
    const players = [createPlayer('Player', 'ORDER')]
    const dragon = {
      eventId: 11,
      eventTime: 605,
      eventName: 'DragonKill',
      payload: { DragonType: 'Infernal' }
    }

    fusion.updateLiveGameSnapshot(createSnapshot(base, players, [dragon]), base)
    expect(
      evaluate(engine, fusion, base).some((cue) => cue.ruleId === 'rule_objective_occurred')
    ).toBe(false)

    const baron = {
      eventId: 12,
      eventTime: 1205,
      eventName: 'BaronKill',
      payload: {}
    }
    fusion.updateLiveGameSnapshot(
      createSnapshot(base + 1000, players, [dragon, baron]),
      base + 1000
    )
    const cues = evaluate(engine, fusion, base + 1000)
    expect(cues.find((cue) => cue.ruleId === 'rule_objective_occurred')?.observationText).toBe(
      '纳什男爵已被击杀'
    )

    expect(
      evaluate(engine, fusion, base + 2000).filter(
        (cue) => cue.ruleId === 'rule_objective_occurred'
      )
    ).toHaveLength(0)
  })
})
