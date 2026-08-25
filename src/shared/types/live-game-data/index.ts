import { CoachClock } from '../live-coach/evidence'

export type LiveGameDomain = 'game-stats' | 'players' | 'events' | 'active-player'

export interface LiveGameSourceHealth {
  domain: LiveGameDomain
  state: 'idle' | 'healthy' | 'degraded' | 'unavailable'
  lastSuccessAt: number | null
  lastErrorCode: string | null
  consecutiveFailures: number
}

export interface NormalizedActivePlayerAbility {
  abilityLevel: number
  displayName?: string
  id?: string
  rawDescription?: string
  rawDisplayName?: string
}

export interface NormalizedActivePlayer {
  summonerName: string
  riotId: string
  riotIdGameName: string
  riotIdTagLine: string
  championName: string
  level: number
  currentGold: number
  team: 'ORDER' | 'CHAOS' | 'UNKNOWN'
  abilities: Record<string, NormalizedActivePlayerAbility>
  runes?: unknown
}

export interface NormalizedPlayerItem {
  canUse: boolean
  consumable: boolean
  count: number
  displayName: string
  itemID: number
  price: number
  rawDescription?: string
  rawDisplayName?: string
  slot: number
}

export interface NormalizedPlayerSummonerSpell {
  displayName: string
  rawDescription?: string
  rawDisplayName: string
}

export interface NormalizedPlayer {
  summonerName: string
  riotId: string
  riotIdGameName: string
  riotIdTagLine: string
  championName: string
  championId: number | null
  team: 'ORDER' | 'CHAOS' | 'UNKNOWN'
  position: string
  level: number
  isDead: boolean
  respawnTimer: number
  isBot: boolean
  kills: number
  deaths: number
  assists: number
  creepScore: number
  wardScore: number
  items: NormalizedPlayerItem[]
  summonerSpells: {
    spell1?: NormalizedPlayerSummonerSpell
    spell2?: NormalizedPlayerSummonerSpell
  }
  skinID?: number
  runes?: unknown
}

export interface NormalizedGameEvent {
  eventId: number
  eventTime: number
  eventName: string
  payload: Record<string, unknown>
}

export interface LiveGameSnapshot {
  sessionId: string
  patch: string
  gameTimeSeconds: number | null
  activePlayer: NormalizedActivePlayer | null
  players: NormalizedPlayer[]
  events: NormalizedGameEvent[]
  sourceHealth: LiveGameSourceHealth[]
  clock: CoachClock
}
