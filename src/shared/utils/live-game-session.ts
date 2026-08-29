export const PROVISIONAL_LIVE_GAME_SESSION_ID = 'pending-game'

/**
 * Returns the one session identifier shared by every real-time consumer while LCU is still
 * populating gameData.gameId. A deterministic provisional value prevents independent shards from
 * generating incompatible timestamp ids and silently rejecting each other's early-game payloads.
 */
export function resolveLiveGameSessionId(gameId: unknown): string {
  if (typeof gameId === 'number' && Number.isFinite(gameId) && gameId > 0) {
    return String(gameId)
  }
  if (typeof gameId === 'string' && gameId.trim().length > 0) {
    return gameId.trim()
  }
  return PROVISIONAL_LIVE_GAME_SESSION_ID
}
