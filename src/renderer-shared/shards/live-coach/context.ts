import type { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import type { SettingUtilsRenderer } from '../setting-utils'

export const LIVE_COACH_MAIN_NAMESPACE = 'live-coach-main'
export const LIVE_COACH_RENDERER_NAMESPACE = 'live-coach-renderer'

export interface LiveCoachRendererContext {
  piniaMobxUtils: PiniaMobxUtilsRenderer
  settingUtils: SettingUtilsRenderer
}
