import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type {
  CaptureEnvironmentFingerprint,
  CoachCommunicationAuditRecord,
  CoachCommunicationCategorySettings,
  CoachCommunicationTemplates,
  CoachCooldownRecord,
  CoachFeedbackRecord,
  CustomItemBuilds,
  ImportVideoReplayRequest,
  ItemGuidanceMode,
  LiveCoachAcceptanceReport,
  MinimapCalibration,
  PrepareVideoReplayRequest,
  RecordUserCooldownRequest,
  ReplayAnalysisHistoryEntry,
  ReplayAnalysisStoredResult,
  ReplaySelectedFileGrant,
  ReplayVideoPreparationView,
  RetryReplayAnalysisRequest,
  SubmitCoachFeedback
} from '@shared/types/live-coach'
import { CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION } from '@shared/types/live-coach'

import { AkariIpcRenderer } from '../ipc'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import { MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW } from '../window-manager/context'
import {
  LIVE_COACH_MAIN_NAMESPACE,
  LIVE_COACH_RENDERER_NAMESPACE,
  type LiveCoachRendererContext
} from './context'
import { syncLiveCoachState } from './state-sync'

@Shard(LiveCoachRenderer.id)
export class LiveCoachRenderer implements IAkariShardInitDispose {
  static id = LIVE_COACH_RENDERER_NAMESPACE
  static readonly PAUSE_SHORTCUT_TARGET_ID = 'live-coach-main/pause'
  static readonly MUTE_SHORTCUT_TARGET_ID = 'live-coach-main/mute'
  static readonly REPEAT_SHORTCUT_TARGET_ID = 'live-coach-main/repeat'
  static readonly RECALIBRATE_SHORTCUT_TARGET_ID = 'minimap-observer-main/recalibrate'
  static readonly OVERLAY_SHORTCUT_TARGET_ID = `${MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW}/interaction`
  static readonly COMMUNICATION_CONFIRM_SHORTCUT_TARGET_ID = 'live-coach-main/communication-confirm'

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

  async setOnboardingCompleted(value: boolean) {
    if (!value) {
      await this._ipc.call<{ success: boolean }>(
        LIVE_COACH_MAIN_NAMESPACE,
        'withdrawPrivacyConsent'
      )
      return
    }

    // Revoke the boolean first so a legacy/stale acknowledgement can never become valid merely
    // because the version write completed. If a later write fails, the main-process gate stays
    // closed.
    await this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'onboardingCompleted', false)
    await this._context.settingUtils.set(
      LIVE_COACH_MAIN_NAMESPACE,
      'privacyConsentVersion',
      CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
    )
    await this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'onboardingCompleted', true)
  }

  setAutoStartEnabled(value: boolean) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'autoStartEnabled', value)
  }

  setCoachMode(value: 'minimal' | 'balanced' | 'training') {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'coachMode', value)
  }

  setShadowModeEnabled(value: boolean) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'shadowModeEnabled', value)
  }

  setCueDensity(value: 'low' | 'standard' | 'high') {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'cueDensity', value)
  }

  setMinimumCueIntervalSeconds(value: number) {
    return this._context.settingUtils.set(
      LIVE_COACH_MAIN_NAMESPACE,
      'minimumCueIntervalSeconds',
      value
    )
  }

  setItemGuidanceMode(value: ItemGuidanceMode) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'itemGuidanceMode', value)
  }

  setCustomItemBuilds(value: CustomItemBuilds) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'customItemBuilds', value)
  }

  setFogInferenceEnabled(value: boolean) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'fogInferenceEnabled', value)
  }

  setFogInferenceDetail(value: 'region' | 'route' | 'intent') {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'fogInferenceDetail', value)
  }

  setItemGuidanceEnabled(value: boolean) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'itemGuidanceEnabled', value)
  }

  setCooldownTrackingEnabled(value: boolean) {
    return this._context.settingUtils.set(
      LIVE_COACH_MAIN_NAMESPACE,
      'cooldownTrackingEnabled',
      value
    )
  }

  setCommunicationAssistEnabled(value: boolean) {
    return this._context.settingUtils.set(
      LIVE_COACH_MAIN_NAMESPACE,
      'communicationAssistEnabled',
      value
    )
  }

  setOutputMode(value: Array<'sound' | 'subtitle' | 'speech'>) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'outputMode', value)
  }

  setSpeechEnabled(value: boolean) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'speechEnabled', value)
  }

  setMuted(value: boolean) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'muted', value)
  }

  setPauseShortcut(value: string | null) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'pauseShortcut', value)
  }

  setMuteShortcut(value: string | null) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'muteShortcut', value)
  }

  setRepeatShortcut(value: string | null) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'repeatShortcut', value)
  }

  setRecalibrateShortcut(value: string | null) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'recalibrateShortcut', value)
  }

  setOverlayShortcut(value: string | null) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'overlayShortcut', value)
  }

  setCommunicationTemplates(value: CoachCommunicationTemplates) {
    return this._context.settingUtils.set(
      LIVE_COACH_MAIN_NAMESPACE,
      'communicationTemplates',
      value
    )
  }

  setCommunicationCategories(value: CoachCommunicationCategorySettings) {
    return this._context.settingUtils.set(
      LIVE_COACH_MAIN_NAMESPACE,
      'communicationCategories',
      value
    )
  }

  setCommunicationCooldownSeconds(value: number) {
    return this._context.settingUtils.set(
      LIVE_COACH_MAIN_NAMESPACE,
      'communicationCooldownSeconds',
      value
    )
  }

  setCommunicationConfirmShortcut(value: string | null) {
    return this._context.settingUtils.set(
      LIVE_COACH_MAIN_NAMESPACE,
      'communicationConfirmShortcut',
      value
    )
  }

  setSpeechVolume(value: number) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'speechVolume', value)
  }

  setSoundVolume(value: number) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'soundVolume', value)
  }

  setSpeechRate(value: number) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'speechRate', value)
  }

  setSpeechVoiceId(value: string | null) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'speechVoiceId', value)
  }

  setSpeechOutputDeviceId(value: string | null) {
    return this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'speechOutputDeviceId', value)
  }

  async setOverlayEnabled(value: boolean) {
    await Promise.all([
      this._context.settingUtils.set(MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'enabled', value),
      this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'overlayEnabled', value)
    ])
  }

  async setOverlayOpacity(value: number) {
    await Promise.all([
      this._context.settingUtils.set(MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'opacity', value),
      this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'overlayOpacity', value)
    ])
  }

  async setOverlayLocked(value: boolean) {
    await Promise.all([
      this._context.settingUtils.set(MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'locked', value),
      this._context.settingUtils.set(LIVE_COACH_MAIN_NAMESPACE, 'overlayLocked', value)
    ])
  }

  async beginOverlayAdjustment(): Promise<boolean> {
    try {
      await this.setOverlayEnabled(true)
      await this.setOverlayLocked(false)
      const entered = await this._ipc.call<boolean>(
        MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW,
        'setInteractionMode',
        true
      )
      if (!entered) {
        await this.setOverlayLocked(true)
      }
      return entered
    } catch (error) {
      await Promise.allSettled([
        this.setOverlayLocked(true),
        this._ipc.call(MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'setInteractionMode', false)
      ])
      throw error
    }
  }

  async finishOverlayAdjustment(): Promise<void> {
    try {
      await this.setOverlayLocked(true)
    } catch (error) {
      await this._ipc
        .call(MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'setInteractionMode', false)
        .catch(() => undefined)
      throw error
    }
    await this._ipc.call(MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'setInteractionMode', false)
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

  startManualSession() {
    return this._ipc.call<{ success: boolean; sessionId: string }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'startManualSession'
    )
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

  listAudioDevices() {
    return this._ipc.call<{
      outputDevices: Array<{ id: string; name: string; isDefault: boolean }>
    }>(LIVE_COACH_MAIN_NAMESPACE, 'listAudioDevices')
  }

  cancelSpeech() {
    return this._ipc.call<{ success: boolean }>(LIVE_COACH_MAIN_NAMESPACE, 'cancelSpeech')
  }

  recordUserCooldown(request: RecordUserCooldownRequest) {
    return this._ipc.call<CoachCooldownRecord>(
      LIVE_COACH_MAIN_NAMESPACE,
      'recordUserCooldown',
      request
    )
  }

  cancelCooldown(recordId: string) {
    return this._ipc.call<{ cancelled: boolean }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'cancelCooldown',
      recordId
    )
  }

  confirmCommunicationCue(cueId: string, optionId: string) {
    return this._ipc.call<CoachCommunicationAuditRecord>(
      LIVE_COACH_MAIN_NAMESPACE,
      'confirmCommunicationCue',
      { cueId, optionId }
    )
  }

  submitCueFeedback(feedback: SubmitCoachFeedback) {
    return this._ipc.call<CoachFeedbackRecord>(
      LIVE_COACH_MAIN_NAMESPACE,
      'submitCueFeedback',
      feedback
    )
  }

  listCueFeedback(filters: { cueId?: string; sessionId?: string } = {}) {
    return this._ipc.call<CoachFeedbackRecord[]>(
      LIVE_COACH_MAIN_NAMESPACE,
      'listCueFeedback',
      filters
    )
  }

  withdrawCueFeedback(feedbackId: string) {
    return this._ipc.call<CoachFeedbackRecord | null>(
      LIVE_COACH_MAIN_NAMESPACE,
      'withdrawCueFeedback',
      feedbackId
    )
  }

  deleteCueFeedback(feedbackId: string) {
    return this._ipc.call<{ deleted: boolean }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'deleteCueFeedback',
      feedbackId
    )
  }

  exportLocalCoachData() {
    return this._ipc.call<{ canceled: boolean }>(LIVE_COACH_MAIN_NAMESPACE, 'exportLocalCoachData')
  }

  exportDiagnosticsReport() {
    return this._ipc.call<{ canceled: boolean }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'exportDiagnosticsReport'
    )
  }

  getAcceptanceReport() {
    return this._ipc.call<LiveCoachAcceptanceReport>(
      LIVE_COACH_MAIN_NAMESPACE,
      'getAcceptanceReport'
    )
  }

  exportAcceptanceReport() {
    return this._ipc.call<{ canceled: boolean }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'exportAcceptanceReport'
    )
  }

  clearAcceptanceEvidence() {
    return this._ipc.call<{ sessions: number; offlineRecords: number }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'clearAcceptanceEvidence'
    )
  }

  deleteLocalCoachData() {
    return this._ipc.call<{
      deletedFeedbackCount: number
      deletedAcceptance: { sessions: number; offlineRecords: number }
      deletedReplayHistory: { deletedEntries: number; deletedBytes: number }
    }>(LIVE_COACH_MAIN_NAMESPACE, 'deleteLocalCoachData')
  }

  exportReplayAnalysis(params: { format: 'json' | 'markdown'; analysisId: string }) {
    return this._ipc.call<{ canceled: boolean }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'exportReplayAnalysis',
      params
    )
  }

  requestCalibrationPreview(includeImage = true) {
    return this._ipc.call<{
      requestId: string
      calibration: MinimapCalibration
      fingerprint: CaptureEnvironmentFingerprint
      imageDataUrl?: string
      sourceSize: { width: number; height: number } | null
      thumbnailSize: { width: number; height: number }
      expiresAt: number
    }>('minimap-observer-main', 'requestCalibrationPreview', includeImage)
  }

  probeCaptureSupport() {
    return this._ipc.call<{
      supported: boolean
      realtimeSupported: boolean
      platform: string
      backends: string[]
      nativeBackends: Array<'wgc' | 'dda'>
      fallbackAvailable: boolean
      hdrSupported: boolean
      permissionGranted: boolean | null
    }>('minimap-observer-main', 'probeSupport')
  }

  applyManualCalibration(roi: MinimapCalibration['roi'], side: 'left' | 'right') {
    return this._ipc.call<MinimapCalibration>('minimap-observer-main', 'applyManualCalibration', {
      roi,
      side
    })
  }

  resetCalibration() {
    return this._ipc.call<{ deletedCount: number; calibration: MinimapCalibration }>(
      'minimap-observer-main',
      'resetCalibration'
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

  selectReplayFile() {
    return this._ipc.call<ReplaySelectedFileGrant | null>(
      LIVE_COACH_MAIN_NAMESPACE,
      'selectReplayFile'
    )
  }

  selectReplaySidecarFile() {
    return this._ipc.call<ReplaySelectedFileGrant | null>(
      LIVE_COACH_MAIN_NAMESPACE,
      'selectReplaySidecarFile'
    )
  }

  listReplayAnalyses() {
    return this._ipc.call<ReplayAnalysisHistoryEntry[]>(
      LIVE_COACH_MAIN_NAMESPACE,
      'listReplayAnalyses'
    )
  }

  getReplayAnalysis(analysisId: string) {
    return this._ipc.call<{
      entry: ReplayAnalysisHistoryEntry
      result: ReplayAnalysisStoredResult | null
    } | null>(LIVE_COACH_MAIN_NAMESPACE, 'getReplayAnalysis', analysisId)
  }

  deleteReplayAnalysis(analysisId: string) {
    return this._ipc.call<{ deleted: boolean; deletedBytes: number }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'deleteReplayAnalysis',
      analysisId
    )
  }

  clearReplayAnalyses() {
    return this._ipc.call<{ deletedEntries: number; deletedBytes: number }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'clearReplayAnalyses'
    )
  }

  prepareVideoReplay(request: PrepareVideoReplayRequest) {
    return this._ipc.call<ReplayVideoPreparationView>(
      LIVE_COACH_MAIN_NAMESPACE,
      'prepareVideoReplay',
      request
    )
  }

  importVideoReplay(request: ImportVideoReplayRequest) {
    return this._ipc.call<{
      entry: ReplayAnalysisHistoryEntry
      result: ReplayAnalysisStoredResult
      duplicate: boolean
    }>(LIVE_COACH_MAIN_NAMESPACE, 'importVideoReplay', request)
  }

  retryReplayAnalysis(request: RetryReplayAnalysisRequest) {
    return this._ipc.call<{
      entry: ReplayAnalysisHistoryEntry
      result: ReplayAnalysisStoredResult
      duplicate: boolean
    }>(LIVE_COACH_MAIN_NAMESPACE, 'retryReplayAnalysis', request)
  }

  revokeReplayFileGrants(tokens: string[]) {
    return this._ipc.call<{ revoked: number }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'revokeReplayFileGrants',
      { tokens }
    )
  }

  cancelReplayImport(taskId?: string) {
    return this._ipc.call<{ cancelled: boolean; taskId: string | null }>(
      LIVE_COACH_MAIN_NAMESPACE,
      'cancelReplayImport',
      taskId
    )
  }

  onReplayImportProgress(
    listener: (payload: {
      taskId: string
      stage: string
      progress: number
      message: string
      messageCode?: string
      details?: Record<string, string | number>
    }) => void
  ) {
    return this._ipc.onEvent(LIVE_COACH_MAIN_NAMESPACE, 'replay-import-progress', listener)
  }
}
