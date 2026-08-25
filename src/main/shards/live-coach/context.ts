import type { GameClientMain } from '../game-client'
import type { AkariIpcMain } from '../ipc'
import type { LeagueClientMain } from '../league-client'
import type { LiveGameDataMain } from '../live-game-data'
import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { SetterSettingService } from '../setting-factory/setter-setting-service'
import type { LiveCoachSettings, LiveCoachState } from './state'

export const LIVE_COACH_MAIN_NAMESPACE = 'live-coach-main'

export interface LiveCoachMainContext {
  namespace: string
  logger: AkariLogger
  settings: LiveCoachSettings
  state: LiveCoachState
  settingService: SetterSettingService<LiveCoachSettings>
  ipc: AkariIpcMain
  mobxUtils: MobxUtilsMain
  leagueClient: LeagueClientMain
  gameClient: GameClientMain
  liveGameData: LiveGameDataMain
}
