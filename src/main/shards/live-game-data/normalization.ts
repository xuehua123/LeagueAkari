import {
  LiveGameDomain,
  LiveGameSnapshot,
  LiveGameSourceHealth,
  NormalizedActivePlayer,
  NormalizedGameEvent,
  NormalizedPlayer,
  NormalizedPlayerItem,
  NormalizedPlayerSummonerSpell
} from '@shared/types/live-game-data'

export function normalizeTeam(rawTeam: unknown): 'ORDER' | 'CHAOS' | 'UNKNOWN' {
  if (typeof rawTeam !== 'string') {
    return 'UNKNOWN'
  }
  const upper = rawTeam.toUpperCase()
  if (upper.includes('ORDER') || upper === '100' || upper === 'BLUE') {
    return 'ORDER'
  }
  if (upper.includes('CHAOS') || upper === '200' || upper === 'RED') {
    return 'CHAOS'
  }
  return 'UNKNOWN'
}

export function normalizePlayerItems(rawItems: unknown): NormalizedPlayerItem[] {
  if (!Array.isArray(rawItems)) {
    return []
  }
  return rawItems.map((item, idx) => ({
    itemID: typeof item.itemID === 'number' ? item.itemID : 0,
    displayName: typeof item.displayName === 'string' ? item.displayName : '',
    rawDisplayName: typeof item.rawDisplayName === 'string' ? item.rawDisplayName : undefined,
    rawDescription: typeof item.rawDescription === 'string' ? item.rawDescription : undefined,
    count: typeof item.count === 'number' ? item.count : 1,
    price: typeof item.price === 'number' ? item.price : 0,
    slot: typeof item.slot === 'number' ? item.slot : idx,
    canUse: Boolean(item.canUse),
    consumable: Boolean(item.consumable)
  }))
}

export function normalizeSummonerSpell(
  rawSpell: unknown
): NormalizedPlayerSummonerSpell | undefined {
  if (!rawSpell || typeof rawSpell !== 'object') {
    return undefined
  }
  const s = rawSpell as Record<string, unknown>
  return {
    displayName: typeof s.displayName === 'string' ? s.displayName : '',
    rawDisplayName: typeof s.rawDisplayName === 'string' ? s.rawDisplayName : '',
    rawDescription: typeof s.rawDescription === 'string' ? s.rawDescription : undefined
  }
}

export function normalizePlayer(rawPlayer: any): NormalizedPlayer {
  const riotId = typeof rawPlayer.riotId === 'string' ? rawPlayer.riotId : ''
  let riotIdGameName = typeof rawPlayer.riotIdGameName === 'string' ? rawPlayer.riotIdGameName : ''
  let riotIdTagLine = typeof rawPlayer.riotIdTagLine === 'string' ? rawPlayer.riotIdTagLine : ''

  if (!riotIdGameName && riotId.includes('#')) {
    const [name, tag] = riotId.split('#')
    riotIdGameName = name
    riotIdTagLine = tag
  }

  const spells = rawPlayer.summonerSpells ?? {}
  const spell1 = normalizeSummonerSpell(spells.summonerSpellOne ?? spells.spell1)
  const spell2 = normalizeSummonerSpell(spells.summonerSpellTwo ?? spells.spell2)

  const scores = rawPlayer.scores ?? {}

  return {
    summonerName: typeof rawPlayer.summonerName === 'string' ? rawPlayer.summonerName : '',
    riotId: riotId || (riotIdGameName ? `${riotIdGameName}#${riotIdTagLine}` : ''),
    riotIdGameName,
    riotIdTagLine,
    championName: typeof rawPlayer.championName === 'string' ? rawPlayer.championName : '',
    championId: typeof rawPlayer.skinID === 'number' ? Math.floor(rawPlayer.skinID / 1000) : null,
    team: normalizeTeam(rawPlayer.team),
    position: typeof rawPlayer.position === 'string' ? rawPlayer.position : 'UNKNOWN',
    level: typeof rawPlayer.level === 'number' ? rawPlayer.level : 1,
    isDead: Boolean(rawPlayer.isDead),
    respawnTimer: typeof rawPlayer.respawnTimer === 'number' ? rawPlayer.respawnTimer : 0,
    isBot: Boolean(rawPlayer.isBot),
    kills: typeof scores.kills === 'number' ? scores.kills : 0,
    deaths: typeof scores.deaths === 'number' ? scores.deaths : 0,
    assists: typeof scores.assists === 'number' ? scores.assists : 0,
    creepScore: typeof scores.creepScore === 'number' ? scores.creepScore : 0,
    wardScore: typeof scores.wardScore === 'number' ? scores.wardScore : 0,
    items: normalizePlayerItems(rawPlayer.items),
    summonerSpells: {
      spell1,
      spell2
    },
    skinID: typeof rawPlayer.skinID === 'number' ? rawPlayer.skinID : undefined,
    runes: rawPlayer.runes
  }
}

export function normalizeActivePlayer(rawActivePlayer: any): NormalizedActivePlayer | null {
  if (!rawActivePlayer || typeof rawActivePlayer !== 'object') {
    return null
  }

  const riotId = typeof rawActivePlayer.riotId === 'string' ? rawActivePlayer.riotId : ''
  let riotIdGameName =
    typeof rawActivePlayer.riotIdGameName === 'string' ? rawActivePlayer.riotIdGameName : ''
  let riotIdTagLine =
    typeof rawActivePlayer.riotIdTagLine === 'string' ? rawActivePlayer.riotIdTagLine : ''

  if (!riotIdGameName && riotId.includes('#')) {
    const [name, tag] = riotId.split('#')
    riotIdGameName = name
    riotIdTagLine = tag
  }

  const abilities: Record<string, { abilityLevel: number; displayName?: string; id?: string }> = {}
  if (rawActivePlayer.abilities && typeof rawActivePlayer.abilities === 'object') {
    for (const [key, val] of Object.entries(rawActivePlayer.abilities)) {
      if (val && typeof val === 'object') {
        const v = val as any
        abilities[key] = {
          abilityLevel: typeof v.abilityLevel === 'number' ? v.abilityLevel : 0,
          displayName: typeof v.displayName === 'string' ? v.displayName : undefined,
          id: typeof v.id === 'string' ? v.id : undefined
        }
      }
    }
  }

  return {
    summonerName:
      typeof rawActivePlayer.summonerName === 'string' ? rawActivePlayer.summonerName : '',
    riotId: riotId || (riotIdGameName ? `${riotIdGameName}#${riotIdTagLine}` : ''),
    riotIdGameName,
    riotIdTagLine,
    championName:
      typeof rawActivePlayer.championName === 'string' ? rawActivePlayer.championName : '',
    level: typeof rawActivePlayer.level === 'number' ? rawActivePlayer.level : 1,
    currentGold: typeof rawActivePlayer.currentGold === 'number' ? rawActivePlayer.currentGold : 0,
    team: normalizeTeam(rawActivePlayer.team),
    abilities,
    runes: rawActivePlayer.fullRunes ?? rawActivePlayer.runes
  }
}

export function normalizeGameEvents(rawEvents: any): NormalizedGameEvent[] {
  const eventsList = Array.isArray(rawEvents)
    ? rawEvents
    : Array.isArray(rawEvents?.Events)
      ? rawEvents.Events
      : []

  return eventsList.map((e: any) => {
    const { EventID, EventName, EventTime, ...rest } = e
    return {
      eventId: typeof EventID === 'number' ? EventID : 0,
      eventTime: typeof EventTime === 'number' ? EventTime : 0,
      eventName: typeof EventName === 'string' ? EventName : 'UnknownEvent',
      payload: rest || {}
    }
  })
}

export function createInitialDomainHealth(domain: LiveGameDomain): LiveGameSourceHealth {
  return {
    domain,
    state: 'idle',
    lastSuccessAt: null,
    lastErrorCode: null,
    consecutiveFailures: 0
  }
}

export function createInitialSnapshot(sessionId: string = ''): LiveGameSnapshot {
  return {
    sessionId,
    patch: '',
    gameTimeSeconds: null,
    activePlayer: null,
    players: [],
    events: [],
    sourceHealth: [
      createInitialDomainHealth('game-stats'),
      createInitialDomainHealth('players'),
      createInitialDomainHealth('events'),
      createInitialDomainHealth('active-player')
    ],
    clock: {
      observedAt: Date.now(),
      receivedAt: Date.now(),
      sequence: 0
    }
  }
}
