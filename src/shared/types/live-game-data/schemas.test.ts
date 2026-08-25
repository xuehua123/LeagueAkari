import { describe, expect, it } from 'vitest'

import {
  liveGameSnapshotSchema,
  liveGameSourceHealthSchema,
  normalizedActivePlayerSchema,
  normalizedPlayerSchema
} from './schemas'

describe('live-game-data schemas', () => {
  it('validates liveGameSourceHealthSchema', () => {
    const health = {
      domain: 'game-stats',
      state: 'healthy',
      lastSuccessAt: 1700000000000,
      lastErrorCode: null,
      consecutiveFailures: 0
    }
    expect(liveGameSourceHealthSchema.safeParse(health).success).toBe(true)
  })

  it('validates normalizedPlayerSchema and items', () => {
    const player = {
      summonerName: 'Akari',
      riotId: 'Akari#KR1',
      riotIdGameName: 'Akari',
      riotIdTagLine: 'KR1',
      championName: 'Ahri',
      championId: 103,
      team: 'ORDER',
      position: 'MIDDLE',
      level: 6,
      isDead: false,
      respawnTimer: 0,
      isBot: false,
      kills: 2,
      deaths: 0,
      assists: 1,
      creepScore: 54,
      wardScore: 4,
      items: [
        {
          itemID: 1056,
          displayName: "Doran's Ring",
          count: 1,
          price: 400,
          slot: 0,
          canUse: false,
          consumable: false
        }
      ],
      summonerSpells: {
        spell1: { displayName: 'Flash', rawDisplayName: 'SummonerFlash' },
        spell2: { displayName: 'Ignite', rawDisplayName: 'SummonerDot' }
      }
    }
    expect(normalizedPlayerSchema.safeParse(player).success).toBe(true)
  })

  it('validates normalizedActivePlayerSchema', () => {
    const activePlayer = {
      summonerName: 'Akari',
      riotId: 'Akari#KR1',
      riotIdGameName: 'Akari',
      riotIdTagLine: 'KR1',
      championName: 'Ahri',
      level: 6,
      currentGold: 1250,
      team: 'ORDER',
      abilities: {
        Q: { abilityLevel: 3, displayName: 'Orb of Deception' }
      }
    }
    expect(normalizedActivePlayerSchema.safeParse(activePlayer).success).toBe(true)
  })

  it('validates liveGameSnapshotSchema round-trip', () => {
    const snapshot = {
      sessionId: 'sess_123',
      patch: '14.15.1',
      gameTimeSeconds: 612.5,
      activePlayer: {
        summonerName: 'Akari',
        riotId: 'Akari#KR1',
        riotIdGameName: 'Akari',
        riotIdTagLine: 'KR1',
        championName: 'Ahri',
        level: 6,
        currentGold: 1250,
        team: 'ORDER',
        abilities: {
          Q: { abilityLevel: 3, displayName: 'Orb of Deception' }
        }
      },
      players: [],
      events: [
        {
          eventId: 1,
          eventTime: 120.5,
          eventName: 'FirstBlood',
          payload: { recipient: 'Akari' }
        }
      ],
      sourceHealth: [
        {
          domain: 'game-stats',
          state: 'healthy',
          lastSuccessAt: 1700000000000,
          lastErrorCode: null,
          consecutiveFailures: 0
        }
      ],
      clock: {
        observedAt: 1700000000000,
        receivedAt: 1700000000020,
        sequence: 100
      }
    }
    expect(liveGameSnapshotSchema.safeParse(snapshot).success).toBe(true)
  })
})
