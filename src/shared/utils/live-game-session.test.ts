import { describe, expect, it } from 'vitest'

import { PROVISIONAL_LIVE_GAME_SESSION_ID, resolveLiveGameSessionId } from './live-game-session'

describe('resolveLiveGameSessionId', () => {
  it('uses the official game id as soon as LCU exposes it', () => {
    expect(resolveLiveGameSessionId(123456)).toBe('123456')
    expect(resolveLiveGameSessionId(' 123456 ')).toBe('123456')
  })

  it('uses one deterministic provisional id for incomplete early-game sessions', () => {
    expect(resolveLiveGameSessionId(undefined)).toBe(PROVISIONAL_LIVE_GAME_SESSION_ID)
    expect(resolveLiveGameSessionId(null)).toBe(PROVISIONAL_LIVE_GAME_SESSION_ID)
    expect(resolveLiveGameSessionId(0)).toBe(PROVISIONAL_LIVE_GAME_SESSION_ID)
  })
})
