import { describe, expect, it } from 'vitest'

import {
  createInitialSnapshot,
  normalizeActivePlayer,
  normalizeGameEvents,
  normalizePlayer,
  normalizeTeam
} from './normalization'

describe('normalization logic', () => {
  it('normalizes teams correctly', () => {
    expect(normalizeTeam('ORDER')).toBe('ORDER')
    expect(normalizeTeam('Chaos')).toBe('CHAOS')
    expect(normalizeTeam('100')).toBe('ORDER')
    expect(normalizeTeam('200')).toBe('CHAOS')
    expect(normalizeTeam('BLUE')).toBe('ORDER')
    expect(normalizeTeam('RED')).toBe('CHAOS')
    expect(normalizeTeam('invalid')).toBe('UNKNOWN')
    expect(normalizeTeam(null)).toBe('UNKNOWN')
  })

  it('normalizes players with items, summoner spells, and scores', () => {
    const rawPlayer = {
      championName: 'Ahri',
      isBot: false,
      isDead: true,
      items: [
        {
          canUse: false,
          consumable: false,
          count: 1,
          displayName: "Doran's Ring",
          itemID: 1056,
          price: 400,
          rawDescription: 'Item description',
          rawDisplayName: 'Item_1056',
          slot: 0
        }
      ],
      level: 7,
      position: 'MIDDLE',
      rawChampionName: 'game_character_displayname_Ahri',
      respawnTimer: 18.5,
      riotId: 'Faker#T1',
      skinID: 103001,
      scores: {
        assists: 3,
        creepScore: 68,
        deaths: 1,
        kills: 4,
        wardScore: 5
      },
      summonerName: 'Hide on bush',
      summonerSpells: {
        summonerSpellOne: {
          displayName: 'Flash',
          rawDescription: 'Teleports...',
          rawDisplayName: 'SummonerFlash'
        },
        summonerSpellTwo: {
          displayName: 'Teleport',
          rawDescription: 'Teleport to...',
          rawDisplayName: 'SummonerTeleport'
        }
      },
      team: 'ORDER'
    }

    const normalized = normalizePlayer(rawPlayer)
    expect(normalized.summonerName).toBe('Hide on bush')
    expect(normalized.riotId).toBe('Faker#T1')
    expect(normalized.riotIdGameName).toBe('Faker')
    expect(normalized.riotIdTagLine).toBe('T1')
    expect(normalized.championName).toBe('Ahri')
    expect(normalized.championId).toBe(103)
    expect(normalized.team).toBe('ORDER')
    expect(normalized.isDead).toBe(true)
    expect(normalized.respawnTimer).toBe(18.5)
    expect(normalized.kills).toBe(4)
    expect(normalized.items).toHaveLength(1)
    expect(normalized.items[0].itemID).toBe(1056)
    expect(normalized.summonerSpells.spell1?.displayName).toBe('Flash')
    expect(normalized.summonerSpells.spell2?.displayName).toBe('Teleport')
  })

  it('normalizes active player abilities and gold', () => {
    const rawActivePlayer = {
      abilities: {
        Q: {
          abilityLevel: 2,
          displayName: 'Orb of Deception',
          id: 'AhriQ',
          rawDescription: 'game_ability_ahri_q_description',
          rawDisplayName: 'game_ability_ahri_q_name'
        },
        W: { abilityLevel: 1, displayName: 'Fox-Fire', id: 'AhriW' }
      },
      championName: 'Ahri',
      currentGold: 850.5,
      level: 3,
      riotId: 'Test#123',
      summonerName: 'Player1',
      team: 'CHAOS'
    }

    const normalized = normalizeActivePlayer(rawActivePlayer)
    expect(normalized).not.toBeNull()
    expect(normalized?.currentGold).toBe(850.5)
    expect(normalized?.team).toBe('CHAOS')
    expect(normalized?.abilities.Q.abilityLevel).toBe(2)
    expect(normalized?.abilities.Q.rawDescription).toBe('game_ability_ahri_q_description')
    expect(normalized?.abilities.Q.rawDisplayName).toBe('game_ability_ahri_q_name')
    expect(normalized?.abilities.W.displayName).toBe('Fox-Fire')
  })

  it('normalizes game events list', () => {
    const rawEvents = {
      Events: [
        {
          EventID: 0,
          EventName: 'GameStart',
          EventTime: 0.03
        },
        {
          EventID: 1,
          EventName: 'ChampionKill',
          EventTime: 180.25,
          KillerName: 'Player1',
          VictimName: 'Player2'
        }
      ]
    }

    const events = normalizeGameEvents(rawEvents)
    expect(events).toHaveLength(2)
    expect(events[0].eventName).toBe('GameStart')
    expect(events[1].eventName).toBe('ChampionKill')
    expect(events[1].payload.KillerName).toBe('Player1')
  })

  it('creates initial empty snapshot with all domains in idle state', () => {
    const snapshot = createInitialSnapshot('sess_1')
    expect(snapshot.sessionId).toBe('sess_1')
    expect(snapshot.sourceHealth).toHaveLength(4)
    expect(snapshot.sourceHealth.every((h) => h.state === 'idle')).toBe(true)
  })
})
