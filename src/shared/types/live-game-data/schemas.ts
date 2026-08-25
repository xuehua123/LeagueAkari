import { z } from 'zod'

import { coachClockSchema } from '../live-coach/evidence'

export const liveGameDomainSchema = z.enum(['game-stats', 'players', 'events', 'active-player'])

export const liveGameSourceHealthSchema = z.object({
  domain: liveGameDomainSchema,
  state: z.enum(['idle', 'healthy', 'degraded', 'unavailable']),
  lastSuccessAt: z.number().nullable(),
  lastErrorCode: z.string().nullable(),
  consecutiveFailures: z.number()
})

export const normalizedActivePlayerAbilitySchema = z.object({
  abilityLevel: z.number(),
  displayName: z.string().optional(),
  id: z.string().optional(),
  rawDescription: z.string().optional(),
  rawDisplayName: z.string().optional()
})

export const normalizedActivePlayerSchema = z.object({
  summonerName: z.string(),
  riotId: z.string(),
  riotIdGameName: z.string(),
  riotIdTagLine: z.string(),
  championName: z.string(),
  level: z.number(),
  currentGold: z.number(),
  team: z.enum(['ORDER', 'CHAOS', 'UNKNOWN']),
  abilities: z.record(z.string(), normalizedActivePlayerAbilitySchema),
  runes: z.unknown().optional()
})

export const normalizedPlayerItemSchema = z.object({
  canUse: z.boolean(),
  consumable: z.boolean(),
  count: z.number(),
  displayName: z.string(),
  itemID: z.number(),
  price: z.number(),
  rawDescription: z.string().optional(),
  rawDisplayName: z.string().optional(),
  slot: z.number()
})

export const normalizedPlayerSummonerSpellSchema = z.object({
  displayName: z.string(),
  rawDescription: z.string().optional(),
  rawDisplayName: z.string()
})

export const normalizedPlayerSchema = z.object({
  summonerName: z.string(),
  riotId: z.string(),
  riotIdGameName: z.string(),
  riotIdTagLine: z.string(),
  championName: z.string(),
  championId: z.number().nullable(),
  team: z.enum(['ORDER', 'CHAOS', 'UNKNOWN']),
  position: z.string(),
  level: z.number(),
  isDead: z.boolean(),
  respawnTimer: z.number(),
  isBot: z.boolean(),
  kills: z.number(),
  deaths: z.number(),
  assists: z.number(),
  creepScore: z.number(),
  wardScore: z.number(),
  items: z.array(normalizedPlayerItemSchema),
  summonerSpells: z.object({
    spell1: normalizedPlayerSummonerSpellSchema.optional(),
    spell2: normalizedPlayerSummonerSpellSchema.optional()
  }),
  skinID: z.number().optional(),
  runes: z.unknown().optional()
})

export const normalizedGameEventSchema = z.object({
  eventId: z.number(),
  eventTime: z.number(),
  eventName: z.string(),
  payload: z.record(z.string(), z.unknown())
})

export const liveGameSnapshotSchema = z.object({
  sessionId: z.string(),
  patch: z.string(),
  gameTimeSeconds: z.number().nullable(),
  activePlayer: normalizedActivePlayerSchema.nullable(),
  players: z.array(normalizedPlayerSchema),
  events: z.array(normalizedGameEventSchema),
  sourceHealth: z.array(liveGameSourceHealthSchema),
  clock: coachClockSchema
})
