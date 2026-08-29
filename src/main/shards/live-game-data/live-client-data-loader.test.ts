import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LiveClientDataLoader, RawAllGameDataResponse } from './live-client-data-loader'

function validResponse(): RawAllGameDataResponse {
  return {
    gameData: { gameTime: 123, gameMode: 'CLASSIC' },
    activePlayer: {
      riotId: 'Player#CN1',
      championName: 'Garen',
      currentGold: 500,
      abilities: {}
    },
    allPlayers: [
      {
        riotId: 'Player#CN1',
        championName: 'Garen',
        skinID: 86000,
        team: 'ORDER',
        items: []
      }
    ],
    events: { Events: [] }
  }
}

describe('LiveClientDataLoader domain validation', () => {
  let loader: LiveClientDataLoader
  let get: ReturnType<typeof vi.fn>

  beforeEach(() => {
    loader = new LiveClientDataLoader()
    get = vi.fn()
    ;(loader as any)._http.get = get
  })

  it('marks every structurally valid domain healthy', async () => {
    get.mockResolvedValue({ data: validResponse() })

    const snapshot = await loader.fetchSnapshot('session-1', '16.16.1')

    expect(snapshot?.gameTimeSeconds).toBe(123)
    expect(snapshot?.activePlayer?.currentGold).toBe(500)
    expect(snapshot?.players).toHaveLength(1)
    expect(snapshot?.sourceHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'game-stats', state: 'healthy' }),
        expect.objectContaining({ domain: 'players', state: 'healthy' }),
        expect.objectContaining({ domain: 'events', state: 'healthy' }),
        expect.objectContaining({ domain: 'active-player', state: 'healthy' })
      ])
    )
  })

  it('fails each malformed domain closed without discarding independent valid domains', async () => {
    const data = validResponse()
    data.activePlayer = { currentGold: '500', abilities: {} }
    data.events = { Events: 'not-an-array' }
    get.mockResolvedValue({ data })

    const snapshot = await loader.fetchSnapshot('session-1', '16.16.1')

    expect(snapshot?.gameTimeSeconds).toBe(123)
    expect(snapshot?.players).toHaveLength(1)
    expect(snapshot?.activePlayer).toBeNull()
    expect(snapshot?.events).toEqual([])
    expect(snapshot?.sourceHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'game-stats', state: 'healthy' }),
        expect.objectContaining({ domain: 'players', state: 'healthy' }),
        expect.objectContaining({
          domain: 'events',
          state: 'degraded',
          lastErrorCode: 'SCHEMA_INVALID'
        }),
        expect.objectContaining({
          domain: 'active-player',
          state: 'degraded',
          lastErrorCode: 'SCHEMA_INVALID'
        })
      ])
    )
  })

  it('marks a repeatedly malformed domain unavailable after three responses', async () => {
    const data = validResponse()
    data.allPlayers = []
    get.mockResolvedValue({ data })

    await loader.fetchSnapshot('session-1')
    await loader.fetchSnapshot('session-1')
    const snapshot = await loader.fetchSnapshot('session-1')

    expect(snapshot?.players).toEqual([])
    expect(snapshot?.sourceHealth).toContainEqual(
      expect.objectContaining({
        domain: 'players',
        state: 'unavailable',
        consecutiveFailures: 3
      })
    )
  })
})
