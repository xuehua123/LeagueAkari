import {
  CoachConversationPublicDto,
  CoachCuePublicDto,
  CoachPublicError,
  CoachSessionState,
  CoachUnavailableReason
} from '@shared/types/live-coach'
import { makeAutoObservable, observable } from 'mobx'

export class LiveCoachSettings {
  public enabled: boolean = false
  public coachMode: 'minimal' | 'balanced' | 'training' = 'balanced'
  public outputMode: Array<'sound' | 'subtitle' | 'speech'> = ['sound', 'subtitle', 'speech']
  public captureBackend: 'auto' | 'wgc' | 'dda' = 'auto'
  public minimapSide: 'auto' | 'left' | 'right' = 'auto'
  public manualCalibration: unknown = null
  public speechEnabled: boolean = true
  public speechVoiceId: string | null = null
  public speechOutputDeviceId: string | null = null
  public speechVolume: number = 0.8
  public speechRate: number = 1
  public cueCategories: Record<string, boolean> = {
    information: true,
    warning: true,
    opportunity: true,
    system: true,
    review: true
  }
  public pauseShortcut: string | null = null
  public muteShortcut: string | null = null
  public overlayShortcut: string | null = null
  public recalibrateShortcut: string | null = null
  public overlayEnabled: boolean = true
  public overlayOpacity: number = 0.92
  public replaySpeechSimulation: boolean = false

  constructor() {
    makeAutoObservable(this, {
      cueCategories: observable.struct,
      manualCalibration: observable.ref
    })
  }

  setEnabled(val: boolean) {
    this.enabled = val
  }
  setCoachMode(val: 'minimal' | 'balanced' | 'training') {
    this.coachMode = val
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
  setManualCalibration(val: unknown) {
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
  setSpeechRate(val: number) {
    this.speechRate = Math.max(0.5, Math.min(2, val))
  }
  setCueCategories(val: Record<string, boolean>) {
    this.cueCategories = val
  }
  setOverlayEnabled(val: boolean) {
    this.overlayEnabled = val
  }
  setOverlayOpacity(val: number) {
    this.overlayOpacity = Math.max(0.2, Math.min(1, val))
  }
  setReplaySpeechSimulation(val: boolean) {
    this.replaySpeechSimulation = val
  }
}

export class LiveCoachState {
  public session: {
    id: string | null
    state: CoachSessionState
    mapId: number | null
    queueId: number | null
    patch: string | null
    startedAt: number | null
  } = {
    id: null,
    state: 'disabled',
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
  } = {
    state: 'idle',
    backend: null,
    fps: 0,
    frameAgeMs: null,
    roiState: 'unknown'
  }

  public liveData: {
    state: string
    lastSuccessAt: number | null
  } = {
    state: 'idle',
    lastSuccessAt: null
  }

  public cue: CoachCuePublicDto | null = null

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
      lastError: observable.ref
    })
  }

  setSessionState(state: CoachSessionState) {
    this.session.state = state
  }

  setSessionInfo(info: Partial<LiveCoachState['session']>) {
    Object.assign(this.session, info)
  }

  setCapability(enabledFeatureIds: string[], unavailable: Record<string, CoachUnavailableReason>) {
    this.capability.enabledFeatureIds = enabledFeatureIds
    this.capability.unavailable = unavailable
  }

  setCaptureState(info: Partial<LiveCoachState['capture']>) {
    Object.assign(this.capture, info)
  }

  setLiveDataState(state: string, lastSuccessAt: number | null) {
    this.liveData.state = state
    this.liveData.lastSuccessAt = lastSuccessAt
  }

  setCue(cue: CoachCuePublicDto | null) {
    this.cue = cue
  }

  setSpeechState(
    state: 'idle' | 'speaking' | 'muted' | 'unavailable',
    cueId: string | null = null
  ) {
    this.speech.state = state
    this.speech.cueId = cueId
  }

  setLastError(error: CoachPublicError | null) {
    this.lastError = error
  }

  reset() {
    this.session = {
      id: null,
      state: 'idle',
      mapId: null,
      queueId: null,
      patch: null,
      startedAt: null
    }
    this.cue = null
    this.speech = { state: 'idle', cueId: null }
    this.lastError = null
  }
}
