import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'

import { AkariIpcRenderer } from '../ipc'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import {
  LIVE_COACH_MAIN_NAMESPACE,
  LIVE_COACH_RENDERER_NAMESPACE,
  type LiveCoachRendererContext
} from './context'
import { syncLiveCoachState } from './state-sync'

@Shard(LiveCoachRenderer.id)
export class LiveCoachRenderer implements IAkariShardInitDispose {
  static id = LIVE_COACH_RENDERER_NAMESPACE

  private readonly _context: LiveCoachRendererContext

  constructor(
    @Dep(PiniaMobxUtilsRenderer) piniaMobxUtils: PiniaMobxUtilsRenderer,
    @Dep(SettingUtilsRenderer) settingUtils: SettingUtilsRenderer,
    @Dep(AkariIpcRenderer) private readonly _ipc: AkariIpcRenderer
  ) {
    this._context = {
      piniaMobxUtils,
      settingUtils
    }
  }

  async onInit() {
    await syncLiveCoachState(this._context)
  }

  setEnabled(value: boolean) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'enabled', value)
  }

  setCoachMode(value: 'minimal' | 'balanced' | 'training') {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'coachMode', value)
  }

  setOutputMode(value: Array<'sound' | 'subtitle' | 'speech'>) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'outputMode', value)
  }

  setSpeechEnabled(value: boolean) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'speechEnabled', value)
  }

  setSpeechVolume(value: number) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'speechVolume', value)
  }

  setSpeechRate(value: number) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'speechRate', value)
  }

  setSpeechVoiceId(value: string | null) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'speechVoiceId', value)
  }

  setOverlayEnabled(value: boolean) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'overlayEnabled', value)
  }

  setOverlayOpacity(value: number) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'overlayOpacity', value)
  }

  setMinimapSide(value: 'auto' | 'left' | 'right') {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'minimapSide', value)
  }

  setCaptureBackend(value: 'auto' | 'wgc' | 'dda') {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'captureBackend', value)
  }

  setCueCategoryEnabled(
    category: string,
    enabled: boolean,
    currentCategories: Record<string, boolean>
  ) {
    const updated = { ...currentCategories, [category]: enabled }
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'cueCategories', updated)
  }

  startInternalSession(options: any = {}) {
    return this._ipc.call<any>(LIVE_COACH_MAIN_NAMESPACE, 'startInternalSession', options)
  }

  stopSession(reason: string = 'user-stop') {
    return this._ipc.call<any>(LIVE_COACH_MAIN_NAMESPACE, 'stopSession', reason)
  }

  pause(reason: string = 'user-pause') {
    return this._ipc.call<any>(LIVE_COACH_MAIN_NAMESPACE, 'pause', reason)
  }

  resume() {
    return this._ipc.call<any>(LIVE_COACH_MAIN_NAMESPACE, 'resume')
  }

  testSpeech(options: any = {}) {
    return this._ipc.call<{ success: boolean }>(LIVE_COACH_MAIN_NAMESPACE, 'testSpeech', options)
  }

  listVoices() {
    return this._ipc.call<Array<{ id: string; name: string; culture: string; gender: string }>>(
      LIVE_COACH_MAIN_NAMESPACE,
      'listVoices'
    )
  }

  getEvidence(evidenceId: string) {
    return this._ipc.call<any>(LIVE_COACH_MAIN_NAMESPACE, 'getEvidence', evidenceId)
  }

  getSampleReplay() {
    return this._ipc.call<{ session: any; sidecar: any; markdown: string; cues: any[] }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'getSampleReplay'
    )
  }

  simulateReplaySession(session: any) {
    return this._ipc.call<{ sidecar: any; markdown: string; cues: any[] }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'simulateReplaySession',
      session
    )
  }

  onCueSpoken(listener: (payload: { cueId: string }) => void) {
    return this._ipc.onEvent(LIVE_COACH_MAIN_NAMESPACE, 'cue-spoken', listener)
  }

  onCueCancelled(listener: (payload: { cueId: string; reason: string }) => void) {
    return this._ipc.onEvent(LIVE_COACH_MAIN_NAMESPACE, 'cue-cancelled', listener)
  }
}
