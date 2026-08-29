import {
  LiveGameDomain,
  LiveGameSnapshot,
  LiveGameSourceHealth
} from '@shared/types/live-game-data'
import axios, { AxiosInstance } from 'axios'
import https from 'https'

import {
  createInitialDomainHealth,
  normalizeActivePlayer,
  normalizeGameEvents,
  normalizePlayer
} from './normalization'

export interface RawAllGameDataResponse {
  activePlayer?: unknown
  allPlayers?: unknown
  events?: unknown
  gameData?: {
    gameMode?: string
    gameTime?: number
    mapName?: string
    mapNumber?: number
    mapTerrain?: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasValidGameStats(data: RawAllGameDataResponse): boolean {
  return (
    isRecord(data.gameData) && isFiniteNumber(data.gameData.gameTime) && data.gameData.gameTime >= 0
  )
}

function hasValidPlayers(data: RawAllGameDataResponse): boolean {
  return (
    Array.isArray(data.allPlayers) &&
    data.allPlayers.length > 0 &&
    data.allPlayers.every(
      (player) =>
        isRecord(player) &&
        typeof player.championName === 'string' &&
        typeof player.team === 'string' &&
        Array.isArray(player.items)
    )
  )
}

function hasValidEvents(data: RawAllGameDataResponse): boolean {
  return (
    Array.isArray(data.events) ||
    (isRecord(data.events) && Array.isArray((data.events as Record<string, unknown>).Events))
  )
}

function hasValidActivePlayer(data: RawAllGameDataResponse): boolean {
  return (
    isRecord(data.activePlayer) &&
    isFiniteNumber(data.activePlayer.currentGold) &&
    data.activePlayer.currentGold >= 0 &&
    isRecord(data.activePlayer.abilities)
  )
}

export class LiveClientDataLoader {
  private readonly _http: AxiosInstance
  private _sequence = 0
  private _domainHealth: Record<LiveGameDomain, LiveGameSourceHealth> = {
    'game-stats': createInitialDomainHealth('game-stats'),
    players: createInitialDomainHealth('players'),
    events: createInitialDomainHealth('events'),
    'active-player': createInitialDomainHealth('active-player')
  }

  constructor(baseURL: string = 'https://127.0.0.1:2999') {
    this._http = axios.create({
      baseURL,
      timeout: 1200,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true,
        maxFreeSockets: 16,
        maxCachedSessions: 32
      })
    })
  }

  public resetHealth(): void {
    this._sequence = 0
    this._domainHealth = {
      'game-stats': createInitialDomainHealth('game-stats'),
      players: createInitialDomainHealth('players'),
      events: createInitialDomainHealth('events'),
      'active-player': createInitialDomainHealth('active-player')
    }
  }

  public getSourceHealth(): LiveGameSourceHealth[] {
    return Object.values(this._domainHealth).map((health) => ({ ...health }))
  }

  private _markSuccess(domain: LiveGameDomain, now: number): void {
    this._domainHealth[domain] = {
      domain,
      state: 'healthy',
      lastSuccessAt: now,
      lastErrorCode: null,
      consecutiveFailures: 0
    }
  }

  private _markFailure(domain: LiveGameDomain, errorCode: string): void {
    const prev = this._domainHealth[domain]
    const consecutive = prev.consecutiveFailures + 1
    this._domainHealth[domain] = {
      domain,
      state: consecutive >= 3 ? 'unavailable' : 'degraded',
      lastSuccessAt: prev.lastSuccessAt,
      lastErrorCode: errorCode,
      consecutiveFailures: consecutive
    }
  }

  public async fetchSnapshot(
    sessionId: string,
    patch: string = '',
    signal?: AbortSignal
  ): Promise<LiveGameSnapshot | null> {
    const observedAt = Date.now()
    try {
      const resp = await this._http.get<RawAllGameDataResponse>('/liveclientdata/allgamedata', {
        signal
      })
      const receivedAt = Date.now()
      const data = resp.data || {}

      const now = Date.now()
      const domainValidity: Record<LiveGameDomain, boolean> = {
        'game-stats': hasValidGameStats(data),
        players: hasValidPlayers(data),
        events: hasValidEvents(data),
        'active-player': hasValidActivePlayer(data)
      }
      for (const domain of Object.keys(domainValidity) as LiveGameDomain[]) {
        if (domainValidity[domain]) {
          this._markSuccess(domain, now)
        } else {
          this._markFailure(domain, 'SCHEMA_INVALID')
        }
      }

      const activePlayer = domainValidity['active-player']
        ? normalizeActivePlayer(data.activePlayer)
        : null
      const players =
        domainValidity.players && Array.isArray(data.allPlayers)
          ? data.allPlayers.map((p) => normalizePlayer(p))
          : []
      const events = domainValidity.events ? normalizeGameEvents(data.events) : []
      const gameTimeSeconds = domainValidity['game-stats'] ? data.gameData!.gameTime! : null

      this._sequence++

      return {
        sessionId,
        patch,
        gameTimeSeconds,
        activePlayer,
        players,
        events,
        sourceHealth: Object.values(this._domainHealth),
        clock: {
          observedAt,
          receivedAt,
          sequence: this._sequence
        }
      }
    } catch (err: any) {
      if (axios.isCancel(err) || signal?.aborted || err?.name === 'CanceledError') {
        return null
      }
      const errCode = err?.code || err?.message || 'REQUEST_FAILED'
      this._markFailure('game-stats', errCode)
      this._markFailure('players', errCode)
      this._markFailure('events', errCode)
      this._markFailure('active-player', errCode)
      return null
    }
  }
}
