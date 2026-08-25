import type { GameClientMain } from '../game-client'
import type { LeagueClientMain } from '../league-client'
import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { LiveGameDataState } from './state'

export const LIVE_GAME_DATA_MAIN_NAMESPACE = 'live-game-data-main'

export interface LiveGameDataMainContext {
  namespace: string
  logger: AkariLogger
  state: LiveGameDataState
  leagueClient: LeagueClientMain
  gameClient: GameClientMain
  mobxUtils: MobxUtilsMain
}
