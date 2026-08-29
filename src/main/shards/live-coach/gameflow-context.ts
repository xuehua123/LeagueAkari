import type { GameflowSession } from '@shared/types/league-client/gameflow'

const CUSTOM_QUEUE_ID = 0
const SUPPORTED_CUSTOM_GAME_MODES = new Set(['CLASSIC', 'PRACTICETOOL'])

export interface LiveCoachGameflowContext {
  mapId: number | null
  queueId: number | null
  gameMode: string | null
  isCustomGame: boolean
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function normalizeGameMode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return normalized || null
}

/**
 * Resolves the LCU gameflow fields used by Live Coach from one shared source of truth.
 *
 * Custom games can briefly expose their authoritative custom-game flags before the queue
 * object is complete. In that case, Summoner's Rift custom and Practice Tool sessions use
 * Riot's canonical custom queue id (0). Explicit tutorial or unknown special modes remain
 * fail-closed instead of being mistaken for a supported custom match.
 */
export function resolveLiveCoachGameflowContext(
  session: GameflowSession | null | undefined
): LiveCoachGameflowContext {
  const queue = session?.gameData?.queue
  const explicitQueueId = normalizeNonNegativeInteger(queue?.id)
  const queueGameMode = normalizeGameMode(queue?.gameMode)
  const mapGameMode = normalizeGameMode(session?.map?.gameMode)
  const gameMode = queueGameMode ?? mapGameMode
  const isCustomGame =
    session?.gameData?.isCustomGame === true || queue?.isCustom === true || explicitQueueId === 0
  const reportedGameModes = [queueGameMode, mapGameMode].filter(
    (value): value is string => value !== null
  )
  const isUnsupportedCustomMode =
    isCustomGame &&
    (reportedGameModes.length === 0 ||
      reportedGameModes.some((mode) => !SUPPORTED_CUSTOM_GAME_MODES.has(mode)))

  return {
    mapId:
      normalizeNonNegativeInteger(session?.map?.id) ?? normalizeNonNegativeInteger(queue?.mapId),
    queueId: isUnsupportedCustomMode
      ? null
      : (explicitQueueId ??
        (isCustomGame && gameMode !== null && SUPPORTED_CUSTOM_GAME_MODES.has(gameMode)
          ? CUSTOM_QUEUE_ID
          : null)),
    gameMode,
    isCustomGame
  }
}
