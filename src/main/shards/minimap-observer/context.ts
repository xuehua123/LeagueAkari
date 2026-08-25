import type { GameClientMain } from '../game-client'
import type { AkariIpcMain } from '../ipc'
import type { LeagueClientMain } from '../league-client'
import type { LiveCoachMain } from '../live-coach'
import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { MinimapObserverState } from './state'

export const MINIMAP_OBSERVER_MAIN_NAMESPACE = 'minimap-observer-main'

export interface MinimapObserverMainContext {
  namespace: string
  logger: AkariLogger
  state: MinimapObserverState
  ipc: AkariIpcMain
  mobxUtils: MobxUtilsMain
  leagueClient: LeagueClientMain
  gameClient: GameClientMain
  liveCoach: LiveCoachMain
}
