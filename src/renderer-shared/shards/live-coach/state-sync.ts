import { LIVE_COACH_MAIN_NAMESPACE, type LiveCoachRendererContext } from './context'
import { useLiveCoachStore } from './store'

export async function syncLiveCoachState(context: LiveCoachRendererContext) {
  const store = useLiveCoachStore()

  await context.piniaMobxUtils.sync(LIVE_COACH_MAIN_NAMESPACE, 'settings', store.settings)
  await context.piniaMobxUtils.sync(LIVE_COACH_MAIN_NAMESPACE, 'state', store)
}
