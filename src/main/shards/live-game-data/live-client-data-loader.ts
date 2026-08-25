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
    patch: string = ''
  ): Promise<LiveGameSnapshot | null> {
    const observedAt = Date.now()
    try {
      const resp = await this._http.get<RawAllGameDataResponse>('/liveclientdata/allgamedata')
      const receivedAt = Date.now()
      const data = resp.data || {}

      const now = Date.now()
      this._markSuccess('game-stats', now)
      this._markSuccess('players', now)
      this._markSuccess('events', now)
      this._markSuccess('active-player', now)

      const activePlayer = normalizeActivePlayer(data.activePlayer)
      const players = Array.isArray(data.allPlayers)
        ? data.allPlayers.map((p) => normalizePlayer(p))
        : []
      const events = normalizeGameEvents(data.events)
      const gameTimeSeconds =
        typeof data.gameData?.gameTime === 'number' ? data.gameData.gameTime : null

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
      const errCode = err?.code || err?.message || 'REQUEST_FAILED'
      this._markFailure('game-stats', errCode)
      this._markFailure('players', errCode)
      this._markFailure('events', errCode)
      this._markFailure('active-player', errCode)
      return null
    }
  }
}
