import { describe, expect, it } from 'vitest'

import { FactFusionEngine } from './fact-fusion'
import {
  CoachRuleEngine,
  RuleGoldSpendSuggestion,
  RuleMinimapEnemyGrouping,
  RuleObjectiveSpawn
} from './rule-engine'

describe('CoachRuleEngine & rules', () => {
  it('triggers RuleObjectiveSpawn at 4:30 into the game', () => {
    const fusion = new FactFusionEngine()
    fusion.updateLiveGameSnapshot({
      sessionId: 'sess_1',
      patch: '14.15.1',
      gameTimeSeconds: 270, // 4 mins 30s
      activePlayer: null,
      players: [],
      events: [],
      sourceHealth: [],
      clock: { observedAt: Date.now(), receivedAt: Date.now(), sequence: 1 }
    })

    const rule = new RuleObjectiveSpawn()
    const cue = rule.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { information: true }
    })

    expect(cue).not.toBeNull()
    expect(cue?.category).toBe('information')
    expect(cue?.options.length).toBeLessThanOrEqual(2)
  })

  it('triggers RuleGoldSpendSuggestion when active player holds > 1600g', () => {
    const fusion = new FactFusionEngine()
    fusion.updateLiveGameSnapshot({
      sessionId: 'sess_1',
      patch: '14.15.1',
      gameTimeSeconds: 400,
      activePlayer: {
        summonerName: 'Akari',
        riotId: 'Akari#1',
        riotIdGameName: 'Akari',
        riotIdTagLine: '1',
        championName: 'Ahri',
        level: 6,
        currentGold: 1850,
        team: 'ORDER',
        abilities: {}
      },
      players: [],
      events: [],
      sourceHealth: [],
      clock: { observedAt: Date.now(), receivedAt: Date.now(), sequence: 1 }
    })

    const rule = new RuleGoldSpendSuggestion()
    const cue = rule.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { opportunity: true }
    })

    expect(cue).not.toBeNull()
    expect(cue?.category).toBe('opportunity')
    expect(cue?.options.length).toBe(2)
  })

  it('triggers RuleMinimapEnemyGrouping when 3+ enemies grouped on minimap', () => {
    const fusion = new FactFusionEngine()
    const now = Date.now()
    fusion.updateMinimapBatch({
      sessionId: 'sess_1',
      patch: '14.15.1',
      calibrationVersion: '1.0',
      modelVersions: {},
      frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 20 },
      health: 'healthy',
      entities: [
        {
          trackId: 'e1',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.2, y: 0.2 },
          regionId: 'top-river',
          confidence: 0.9,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 3000
        },
        {
          trackId: 'e2',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.22, y: 0.21 },
          regionId: 'top-river',
          confidence: 0.9,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 3000
        },
        {
          trackId: 'e3',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.21, y: 0.23 },
          regionId: 'top-river',
          confidence: 0.9,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 3000
        }
      ],
      events: []
    })

    const rule = new RuleMinimapEnemyGrouping()
    const cue = rule.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true }
    })

    expect(cue).not.toBeNull()
    expect(cue?.category).toBe('warning')
    expect(cue?.options.length).toBe(2)
  })

  it('evaluates multiple rules through CoachRuleEngine', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const cues = engine.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { information: true, warning: true, opportunity: true }
    })
    expect(Array.isArray(cues)).toBe(true)
  })
})
