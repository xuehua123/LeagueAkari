import { LiveGameSnapshot, NormalizedPlayer } from '@shared/types/live-game-data'
import { describe, expect, it } from 'vitest'

import { FactFusionEngine } from './fact-fusion'
import { CoachRuleEngine } from './rule-engine'

function player(
  championName: string,
  championId: number,
  team: 'ORDER' | 'CHAOS',
  position: string
): NormalizedPlayer {
  return {
    summonerName: championName,
    riotId: `${championName}#TEST`,
    riotIdGameName: championName,
    riotIdTagLine: 'TEST',
    championName,
    championId,
    team,
    position,
    level: 6,
    isDead: false,
    respawnTimer: 0,
    isBot: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 42,
    wardScore: 3,
    items: [],
    summonerSpells: {}
  }
}

function snapshot(now: number, gameTimeSeconds: number): LiveGameSnapshot {
  const players = [
    player('Ahri', 103, 'ORDER', 'MIDDLE'),
    player('Zed', 238, 'CHAOS', 'MIDDLE'),
    player('Katarina', 55, 'CHAOS', 'TOP'),
    player('Ashe', 22, 'CHAOS', 'BOTTOM'),
    player('Leona', 89, 'CHAOS', 'UTILITY'),
    player('LeeSin', 64, 'CHAOS', 'JUNGLE')
  ]
  return {
    sessionId: 'session-combat',
    patch: '16.16.1',
    gameTimeSeconds,
    activePlayer: {
      summonerName: 'Ahri',
      riotId: 'Ahri#TEST',
      riotIdGameName: 'Ahri',
      riotIdTagLine: 'TEST',
      championName: 'Ahri',
      level: 6,
      currentGold: 0,
      team: 'ORDER',
      abilities: {
        Q: { abilityLevel: 3, displayName: '欺诈宝珠' },
        W: { abilityLevel: 1, displayName: '妖异狐火' },
        E: { abilityLevel: 1, displayName: '魅惑妖术' },
        R: { abilityLevel: 0, displayName: '灵魄突袭' }
      }
    },
    players,
    events: [],
    sourceHealth: [],
    clock: { observedAt: now, receivedAt: now, sequence: 1 }
  }
}

function evaluate(
  engine: CoachRuleEngine,
  fusion: FactFusionEngine,
  now: number,
  capabilities: string[] = ['coach.guidance.micro']
) {
  return engine.evaluate({
    sessionId: 'session-combat',
    patch: '16.16.1',
    fusion,
    enabledCategories: {
      information: true,
      warning: true,
      opportunity: true,
      system: true,
      review: true
    },
    enabledCapabilities: new Set(capabilities),
    currentTime: now
  })
}

describe('Phase 1 skill and combat fundamentals guidance', () => {
  it('recommends an available ultimate point from the observed level and skill allocation', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1_700_001_000_000

    fusion.updateLiveGameSnapshot(snapshot(now, 360), now)
    const cues = evaluate(engine, fusion, now)
    const skillCue = cues.find((cue) => cue.ruleId === 'rule_skill_point_guidance')

    expect(skillCue?.observationText).toContain('1 个未分配技能点')
    expect(skillCue?.impactText).toContain('R（灵魄突袭）')
    expect(skillCue?.evidenceIds).toHaveLength(1)

    expect(
      evaluate(engine, fusion, now + 1000).filter(
        (cue) => cue.ruleId === 'rule_skill_point_guidance'
      )
    ).toHaveLength(0)
  })

  it('emits position, lane, combo and enemy-composition fundamentals once per game phase', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1_700_002_000_000

    fusion.updateLiveGameSnapshot(snapshot(now, 180), now)
    const laneCue = evaluate(engine, fusion, now).find(
      (cue) => cue.ruleId === 'rule_combat_fundamentals'
    )
    expect(laneCue?.observationText).toContain('基础对线阶段')
    expect(laneCue?.options).toHaveLength(2)
    expect(laneCue?.impactText).toContain('切入威胁')
    expect(laneCue?.priority).toBeGreaterThanOrEqual(40)

    expect(
      evaluate(engine, fusion, now + 1000).filter(
        (cue) => cue.ruleId === 'rule_combat_fundamentals'
      )
    ).toHaveLength(0)

    fusion.updateLiveGameSnapshot(snapshot(now + 2000, 700), now + 2000)
    expect(
      evaluate(engine, fusion, now + 2000).some((cue) => cue.ruleId === 'rule_combat_fundamentals')
    ).toBe(true)
  })

  it('fails closed when the independent micro-guidance capability is disabled', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = 1_700_003_000_000

    fusion.updateLiveGameSnapshot(snapshot(now, 180), now)
    const cues = evaluate(engine, fusion, now, [])
    expect(cues.some((cue) => cue.ruleId === 'rule_skill_point_guidance')).toBe(false)
    expect(cues.some((cue) => cue.ruleId === 'rule_combat_fundamentals')).toBe(false)
  })
})
