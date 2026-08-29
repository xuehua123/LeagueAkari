import {
  CoachCommunicationAuditRecord,
  CoachCommunicationCategorySettings,
  CoachCommunicationTemplates,
  CoachConversationPublicDto,
  CoachCooldownRecord,
  CoachCuePublicDto,
  CoachPauseReason,
  CoachPublicError,
  CoachSessionState,
  CoachUnavailableReason,
  FogInference,
  ItemPurchaseGuidance,
  LiveCoachSessionSummary
} from '@shared/types/live-coach'
import type {
  CustomItemBuilds,
  ItemGuidanceMode,
  LiveCoachBuildChannel
} from '@shared/types/live-coach'
import type { MinimapCalibration } from '@shared/types/live-coach'
import type { LiveGameSourceHealth } from '@shared/types/live-game-data'
import { makeAutoObservable, observable } from 'mobx'

export class LiveCoachSettings {
  public enabled: boolean = false
  public onboardingCompleted: boolean = false
  public privacyConsentVersion: string | null = null
  public autoStartEnabled: boolean = true
  public coachMode: 'minimal' | 'balanced' | 'training' = 'balanced'
  public shadowModeEnabled: boolean = false
  public cueDensity: 'low' | 'standard' | 'high' = 'standard'
  public minimumCueIntervalSeconds: number = 3
  // A voice coach must be immediately observable on first use. Speech remains local,
  // short, rate-limited, and can be disabled with one click.
  public outputMode: Array<'sound' | 'subtitle' | 'speech'> = ['subtitle', 'speech']
  public captureBackend: 'auto' | 'wgc' | 'dda' = 'auto'
  public minimapSide: 'auto' | 'left' | 'right' = 'auto'
  public itemGuidanceMode: ItemGuidanceMode = 'adaptive'
  public customItemBuilds: CustomItemBuilds = {}
  public fogInferenceEnabled: boolean = true
  public fogInferenceDetail: 'region' | 'route' | 'intent' = 'route'
  public itemGuidanceEnabled: boolean = true
  public cooldownTrackingEnabled: boolean = true
  public communicationAssistEnabled: boolean = false
  public communicationTemplates: CoachCommunicationTemplates = {
    missing: '敌方失踪，请注意',
    resource: '准备争夺资源',
    retreat: '先撤退，等待队友',
    push: '可以推进兵线',
    group: '请集合',
    danger: '危险，请后退'
  }
  public communicationCategories: CoachCommunicationCategorySettings = {
    missing: true,
    resource: true,
    retreat: true,
    push: true,
    group: true,
    danger: true
  }
  public communicationCooldownSeconds: number = 10
  public communicationConfirmShortcut: string | null = null
  public manualCalibration: MinimapCalibration | null = null
  public speechEnabled: boolean = true
  public speechVoiceId: string | null = null
  public speechOutputDeviceId: string | null = null
  public speechVolume: number = 0.8
  public soundVolume: number = 0.8
  public speechRate: number = 1
  public cueCategories: Record<string, boolean> = {
    information: true,
    warning: true,
    resource: true,
    opportunity: true,
    system: true,
    review: true
  }
  public muted: boolean = false
  public pauseShortcut: string | null = null
  public muteShortcut: string | null = null
  public repeatShortcut: string | null = null
  public overlayShortcut: string | null = null
  public recalibrateShortcut: string | null = null
  public overlayEnabled: boolean = true
  public overlayOpacity: number = 0.92
  public overlayLocked: boolean = true
  public replaySpeechSimulation: boolean = false

  constructor() {
    makeAutoObservable(this, {
      cueCategories: observable.struct,
      customItemBuilds: observable.struct,
      communicationTemplates: observable.struct,
      communicationCategories: observable.struct,
      manualCalibration: observable.ref
    })
  }

  setEnabled(val: boolean) {
    this.enabled = val
  }
  setOnboardingCompleted(val: boolean) {
    this.onboardingCompleted = val
  }
  setPrivacyConsentVersion(val: string | null) {
    this.privacyConsentVersion = val
  }
  setAutoStartEnabled(val: boolean) {
    this.autoStartEnabled = val
  }
  setCoachMode(val: 'minimal' | 'balanced' | 'training') {
    this.coachMode = val
  }
  setShadowModeEnabled(val: boolean) {
    this.shadowModeEnabled = val
  }
  setCueDensity(val: 'low' | 'standard' | 'high') {
    this.cueDensity = val
  }
  setMinimumCueIntervalSeconds(val: number) {
    this.minimumCueIntervalSeconds = Math.max(2, Math.min(15, val))
  }
  setOutputMode(val: Array<'sound' | 'subtitle' | 'speech'>) {
    this.outputMode = val
  }
  setCaptureBackend(val: 'auto' | 'wgc' | 'dda') {
    this.captureBackend = val
  }
  setMinimapSide(val: 'auto' | 'left' | 'right') {
    this.minimapSide = val
  }
  setItemGuidanceMode(val: ItemGuidanceMode) {
    this.itemGuidanceMode = val
  }
  setCustomItemBuilds(val: CustomItemBuilds) {
    this.customItemBuilds = val
  }
  setFogInferenceEnabled(val: boolean) {
    this.fogInferenceEnabled = val
  }
  setFogInferenceDetail(val: 'region' | 'route' | 'intent') {
    this.fogInferenceDetail = val
  }
  setItemGuidanceEnabled(val: boolean) {
    this.itemGuidanceEnabled = val
  }
  setCooldownTrackingEnabled(val: boolean) {
    this.cooldownTrackingEnabled = val
  }
  setCommunicationAssistEnabled(val: boolean) {
    this.communicationAssistEnabled = val
  }
  setCommunicationTemplates(val: CoachCommunicationTemplates) {
    this.communicationTemplates = val
  }
  setCommunicationCategories(val: CoachCommunicationCategorySettings) {
    this.communicationCategories = val
  }
  setCommunicationCooldownSeconds(val: number) {
    this.communicationCooldownSeconds = Math.max(3, Math.min(60, val))
  }
  setCommunicationConfirmShortcut(val: string | null) {
    this.communicationConfirmShortcut = val
  }
  setManualCalibration(val: MinimapCalibration | null) {
    this.manualCalibration = val
  }
  setSpeechEnabled(val: boolean) {
    this.speechEnabled = val
  }
  setSpeechVoiceId(val: string | null) {
    this.speechVoiceId = val
  }
  setSpeechOutputDeviceId(val: string | null) {
    this.speechOutputDeviceId = val
  }
  setSpeechVolume(val: number) {
    this.speechVolume = Math.max(0, Math.min(1, val))
  }
  setSoundVolume(val: number) {
    this.soundVolume = Math.max(0, Math.min(1, val))
  }
  setSpeechRate(val: number) {
    this.speechRate = Math.max(0.5, Math.min(2, val))
  }
  setCueCategories(val: Record<string, boolean>) {
    this.cueCategories = val
  }
  setMuted(val: boolean) {
    this.muted = val
  }
  setPauseShortcut(val: string | null) {
    this.pauseShortcut = val
  }
  setMuteShortcut(val: string | null) {
    this.muteShortcut = val
  }
  setRepeatShortcut(val: string | null) {
    this.repeatShortcut = val
  }
  setOverlayShortcut(val: string | null) {
    this.overlayShortcut = val
  }
  setRecalibrateShortcut(val: string | null) {
    this.recalibrateShortcut = val
  }
  setOverlayEnabled(val: boolean) {
    this.overlayEnabled = val
  }
  setOverlayOpacity(val: number) {
    this.overlayOpacity = Math.max(0.2, Math.min(1, val))
  }
  setOverlayLocked(val: boolean) {
    this.overlayLocked = val
  }
  setReplaySpeechSimulation(val: boolean) {
    this.replaySpeechSimulation = val
  }
}

export class LiveCoachState {
  public buildChannel: LiveCoachBuildChannel = 'public'

  public session: {
    id: string | null
    state: CoachSessionState
    pauseReason: CoachPauseReason | null
    mapId: number | null
    queueId: number | null
    patch: string | null
    startedAt: number | null
  } = {
    id: null,
    state: 'disabled',
    pauseReason: null,
    mapId: null,
    queueId: null,
    patch: null,
    startedAt: null
  }

  public capability: {
    enabledFeatureIds: string[]
    unavailable: Record<string, CoachUnavailableReason>
  } = {
    enabledFeatureIds: [],
    unavailable: {}
  }

  public capture: {
    state: string
    backend: string | null
    fps: number
    frameAgeMs: number | null
    roiState: string
    resolution: { width: number; height: number } | null
    confidence: number | null
    lastObservationAt: number | null
    modelVersions: Record<string, string>
    captureLatencyMs: number | null
    inferenceLatencyMs: number | null
    dropCount: number
    queueDepth: number | null
    workerHeartbeatAt: number | null
    workerRestartCount: number
  } = {
    state: 'idle',
    backend: null,
    fps: 0,
    frameAgeMs: null,
    roiState: 'unknown',
    resolution: null,
    confidence: null,
    lastObservationAt: null,
    modelVersions: {},
    captureLatencyMs: null,
    inferenceLatencyMs: null,
    dropCount: 0,
    queueDepth: null,
    workerHeartbeatAt: null,
    workerRestartCount: 0
  }

  public liveData: {
    state: string
    lastSuccessAt: number | null
    sourceHealth: LiveGameSourceHealth[]
  } = {
    state: 'idle',
    lastSuccessAt: null,
    sourceHealth: []
  }

  public cue: CoachCuePublicDto | null = null
  public recentCues: CoachCuePublicDto[] = []
  public sessionCueStats: LiveCoachSessionSummary['cueCounts'] & { total: number } = {
    total: 0,
    information: 0,
    warning: 0,
    opportunity: 0,
    system: 0,
    review: 0
  }
  public lastSessionSummary: LiveCoachSessionSummary | null = null
  public fogInferences: FogInference[] = []
  public itemGuidance: ItemPurchaseGuidance | null = null
  public cooldowns: CoachCooldownRecord[] = []
  public communicationHistory: CoachCommunicationAuditRecord[] = []

  public speech: {
    state: 'idle' | 'speaking' | 'muted' | 'unavailable'
    cueId: string | null
  } = {
    state: 'idle',
    cueId: null
  }

  public conversation: CoachConversationPublicDto = {
    conversationId: null,
    state: 'idle',
    userTranscript: null,
    aiResponse: null
  }

  public lastError: CoachPublicError | null = null

  constructor() {
    makeAutoObservable(this, {
      cue: observable.ref,
      recentCues: observable.shallow,
      lastSessionSummary: observable.ref,
      fogInferences: observable.shallow,
      itemGuidance: observable.ref,
      cooldowns: observable.shallow,
      communicationHistory: observable.shallow,
      lastError: observable.ref
    })
  }

  setSessionState(state: CoachSessionState) {
    this.session = {
      ...this.session,
      state,
      pauseReason: state === 'paused' ? this.session.pauseReason : null
    }
  }

  setSessionInfo(info: Partial<LiveCoachState['session']>) {
    const nextSession = { ...this.session, ...info }
    if (info.state !== undefined && info.state !== 'paused') nextSession.pauseReason = null
    this.session = nextSession
  }

  setCapability(enabledFeatureIds: string[], unavailable: Record<string, CoachUnavailableReason>) {
    this.capability = {
      enabledFeatureIds: [...enabledFeatureIds],
      unavailable: { ...unavailable }
    }
  }

  setBuildChannel(buildChannel: LiveCoachBuildChannel) {
    this.buildChannel = buildChannel
  }

  setCaptureState(info: Partial<LiveCoachState['capture']>) {
    this.capture = { ...this.capture, ...info }
  }

  setLiveDataState(
    state: string,
    lastSuccessAt: number | null,
    sourceHealth: LiveGameSourceHealth[] = []
  ) {
    this.liveData = {
      state,
      lastSuccessAt,
      sourceHealth: sourceHealth.map((health) => ({ ...health }))
    }
  }

  setCue(cue: CoachCuePublicDto | null) {
    this.cue = cue
  }

  addRecentCue(cue: CoachCuePublicDto) {
    const previous = this.recentCues.find((item) => item.id === cue.id)
    this.recentCues = [...this.recentCues.filter((item) => item.id !== cue.id), cue].slice(-20)
    if (cue.status === 'spoken' && previous?.status !== 'spoken') {
      this.sessionCueStats = {
        ...this.sessionCueStats,
        total: this.sessionCueStats.total + 1,
        [cue.category]: this.sessionCueStats[cue.category] + 1
      }
    }
  }

  clearCueHistory() {
    this.cue = null
    this.recentCues = []
  }

  clearSessionArtifacts(preserveCueHistory: boolean = false) {
    if (preserveCueHistory) {
      this.cue = null
    } else {
      this.clearCueHistory()
    }
    this.fogInferences = []
    this.itemGuidance = null
    this.cooldowns = []
    this.sessionCueStats = {
      total: 0,
      information: 0,
      warning: 0,
      opportunity: 0,
      system: 0,
      review: 0
    }
    this.speech = {
      state:
        this.speech.state === 'unavailable' || this.speech.state === 'muted'
          ? this.speech.state
          : 'idle',
      cueId: null
    }
    this.conversation = {
      conversationId: null,
      state: 'idle',
      userTranscript: null,
      aiResponse: null
    }
    this.lastError = null
  }

  completeSessionSummary(endReason: string, endedAt: number = Date.now()) {
    if (!this.session.id || this.session.startedAt === null) return
    this.lastSessionSummary = {
      sessionId: this.session.id,
      mapId: this.session.mapId,
      queueId: this.session.queueId,
      patch: this.session.patch,
      startedAt: this.session.startedAt,
      endedAt,
      durationSeconds: Math.max(0, Math.round((endedAt - this.session.startedAt) / 1000)),
      endReason,
      totalCues: this.sessionCueStats.total,
      cueCounts: {
        information: this.sessionCueStats.information,
        warning: this.sessionCueStats.warning,
        opportunity: this.sessionCueStats.opportunity,
        system: this.sessionCueStats.system,
        review: this.sessionCueStats.review
      }
    }
  }

  clearAllCoachData() {
    this.clearSessionArtifacts()
    this.communicationHistory = []
    this.lastSessionSummary = null
  }

  setFogInferences(inferences: FogInference[]) {
    this.fogInferences = inferences
  }

  setItemGuidance(guidance: ItemPurchaseGuidance | null) {
    this.itemGuidance = guidance
  }

  setCooldowns(cooldowns: CoachCooldownRecord[]) {
    this.cooldowns = cooldowns
  }

  addCommunicationAudit(record: CoachCommunicationAuditRecord) {
    this.communicationHistory = [...this.communicationHistory, record].slice(-100)
  }

  setSpeechState(
    state: 'idle' | 'speaking' | 'muted' | 'unavailable',
    cueId: string | null = null
  ) {
    this.speech = { state, cueId }
  }

  setLastError(error: CoachPublicError | null) {
    this.lastError = error
  }

  reset(sessionState: CoachSessionState = 'idle', preserveCueHistory: boolean = false) {
    this.session = {
      id: null,
      state: sessionState,
      pauseReason: null,
      mapId: null,
      queueId: null,
      patch: null,
      startedAt: null
    }
    this.clearSessionArtifacts(preserveCueHistory)
  }
}
