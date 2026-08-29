import type { LiveGameSnapshot, NormalizedPlayer } from '@shared/types/live-game-data'
import { describe, expect, it } from 'vitest'

import { FactFusionEngine, type ItemGuidancePreferences } from './fact-fusion'

const now = 1_700_000_000_000

function player(overrides: Partial<NormalizedPlayer> = {}): NormalizedPlayer {
  return {
    summonerName: 'Me',
    riotId: 'Me#CN1',
    riotIdGameName: 'Me',
    riotIdTagLine: 'CN1',
    championName: 'Aatrox',
    championId: 266,
    team: 'ORDER',
    position: 'TOP',
    level: 8,
    isDead: false,
    respawnTimer: 0,
    isBot: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 80,
    wardScore: 5,
    items: [],
    summonerSpells: {},
    ...overrides
  }
}

function snapshot(withHealingEnemy = false): LiveGameSnapshot {
  const players = [player()]
  if (withHealingEnemy) {
    players.push(
      player({
        summonerName: 'Enemy',
        riotId: 'Enemy#CN1',
        championName: 'Soraka',
        championId: 16,
        team: 'CHAOS'
      })
    )
  }

  return {
    sessionId: 'mode-test',
    patch: '16.17.1',
    gameTimeSeconds: 600,
    activePlayer: {
      summonerName: 'Me',
      riotId: 'Me#CN1',
      riotIdGameName: 'Me',
      riotIdTagLine: 'CN1',
      championName: 'Aatrox',
      level: 8,
      currentGold: 5_000,
      team: 'ORDER',
      abilities: {}
    },
    players,
    events: [],
    sourceHealth: [],
    clock: { observedAt: now, receivedAt: now, sequence: 1 }
  }
}

function guidanceFor(preferences: ItemGuidancePreferences, healingEnemy = false) {
  const fusion = new FactFusionEngine()
  fusion.configureItemGuidance(preferences)
  fusion.updateLiveGameSnapshot(snapshot(healingEnemy), now)
  return fusion.getItemPurchaseGuidance(now)
}

function item(itemID: number, slot: number): NormalizedPlayer['items'][number] {
  return {
    itemID,
    slot,
    count: 1,
    displayName: String(itemID),
    price: 0,
    canUse: true,
    consumable: false
  }
}

describe('Phase 1 item guidance modes', () => {
  it('uses the common archetype build without matchup counters', () => {
    const guidance = guidanceFor(
      {
        mode: 'common',
        customItemBuilds: {},
        systemRecommendedItemIds: {}
      },
      true
    )

    expect(guidance?.mode).toBe('common')
    expect(guidance?.primaryPlan.itemIds).toEqual([6631])
  })

  it('prioritizes matchup counters only in adaptive mode', () => {
    const guidance = guidanceFor(
      {
        mode: 'adaptive',
        customItemBuilds: {},
        systemRecommendedItemIds: {}
      },
      true
    )

    expect(guidance?.mode).toBe('adaptive')
    expect(guidance?.primaryPlan.itemIds).toEqual([3123])
  })

  it('does not invent an enemy side for adaptive counters when the player team is unknown', () => {
    const fusion = new FactFusionEngine()
    fusion.configureItemGuidance({
      mode: 'adaptive',
      customItemBuilds: {},
      systemRecommendedItemIds: {}
    })
    const input = snapshot(true)
    input.activePlayer!.team = 'UNKNOWN'
    input.players[0].team = 'UNKNOWN'
    input.players[1].team = 'ORDER'

    fusion.updateLiveGameSnapshot(input, now)

    expect(fusion.getItemPurchaseGuidance(now)?.primaryPlan.itemIds).toEqual([6631])
  })

  it('uses Riot Client system recommendations as their own source', () => {
    const guidance = guidanceFor({
      mode: 'system',
      customItemBuilds: {},
      systemRecommendedItemIds: { '266': [3142, 3814] }
    })

    expect(guidance?.mode).toBe('system')
    expect(guidance?.primaryPlan.itemIds).toEqual([3142])
    expect(guidance?.primaryPlan.conditions[0]).toContain('英雄联盟客户端推荐')
  })

  it('uses the champion-specific custom item order and rejects invalid custom ids', () => {
    const guidance = guidanceFor({
      mode: 'custom',
      customItemBuilds: { '266': [3071, 3156] },
      systemRecommendedItemIds: {}
    })
    expect(guidance?.mode).toBe('custom')
    expect(guidance?.primaryPlan.itemIds).toEqual([3071])

    expect(
      guidanceFor({
        mode: 'custom',
        customItemBuilds: { '266': [99999] },
        systemRecommendedItemIds: {}
      })
    ).toBeNull()
  })

  it('allows an in-place component combine when all six inventory slots are occupied', () => {
    const fusion = new FactFusionEngine()
    fusion.configureItemGuidance({
      mode: 'common',
      customItemBuilds: {},
      systemRecommendedItemIds: {}
    })
    const input = snapshot()
    input.activePlayer!.currentGold = 500
    input.players[0].items = [1036, 1036, 1055, 1001, 2003, 1028, 3340].map(item)

    fusion.updateLiveGameSnapshot(input, now)

    expect(fusion.getItemPurchaseGuidance(now)?.primaryPlan).toMatchObject({
      itemIds: [3077],
      totalCost: 500,
      missingGold: 0
    })
  })

  it('moves on to boots instead of recommending an already completed core item', () => {
    const fusion = new FactFusionEngine()
    fusion.configureItemGuidance({
      mode: 'common',
      customItemBuilds: {},
      systemRecommendedItemIds: {}
    })
    const input = snapshot()
    input.activePlayer!.currentGold = 500
    input.players[0].items = [6631, 3071].map(item)

    fusion.updateLiveGameSnapshot(input, now)

    expect(fusion.getItemPurchaseGuidance(now)?.primaryPlan.itemIds).toEqual([1001])
    expect(fusion.getItemPurchaseGuidance(now)?.primaryPlan.itemIds).not.toContain(6631)
  })
})
