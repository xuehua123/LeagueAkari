import { createManager } from '@renderer-shared/shards'
import { AkariApiRenderer } from '@renderer-shared/shards/akari-api'
import { AkariProtocolRenderer } from '@renderer-shared/shards/akari-protocol'
import { AppCommonRenderer } from '@renderer-shared/shards/app-common'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { LiveCoachRenderer } from '@renderer-shared/shards/live-coach'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import { PiniaMobxUtilsRenderer } from '@renderer-shared/shards/pinia-mobx-utils'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { SetupInAppScopeRenderer } from '@renderer-shared/shards/setup-in-app-scope'
import { WindowManagerRenderer } from '@renderer-shared/shards/window-manager'

const manager = createManager()

manager.use(AkariIpcRenderer)
manager.use(AkariApiRenderer)
manager.use(AkariProtocolRenderer)
manager.use(AppCommonRenderer)
manager.use(LiveCoachRenderer)
manager.use(LoggerRenderer)
manager.use(PiniaMobxUtilsRenderer)
manager.use(SettingUtilsRenderer)
manager.use(SetupInAppScopeRenderer)
manager.use(WindowManagerRenderer)

export { manager }
