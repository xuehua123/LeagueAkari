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
import type { LiveGameSourceHealth } from '@shared/types/live-game-data'
import { defineStore } from 'pinia'
import { reactive, ref, shallowRef } from 'vue'

export const useLiveCoachStore = defineStore('shard:live-coach-renderer', () => {
  const buildChannel = ref<LiveCoachBuildChannel>('public')
  const settings = reactive({
    enabled: false,
    onboardingCompleted: false,
    privacyConsentVersion: null as string | null,
    autoStartEnabled: true,
    coachMode: 'balanced' as 'minimal' | 'balanced' | 'training',
    shadowModeEnabled: false,
    cueDensity: 'standard' as 'low' | 'standard' | 'high',
    minimumCueIntervalSeconds: 3,
    outputMode: ['subtitle', 'speech'] as Array<'sound' | 'subtitle' | 'speech'>,
    captureBackend: 'auto' as 'auto' | 'wgc' | 'dda',
    minimapSide: 'auto' as 'auto' | 'left' | 'right',
    itemGuidanceMode: 'adaptive' as ItemGuidanceMode,
    customItemBuilds: {} as CustomItemBuilds,
    fogInferenceEnabled: true,
    fogInferenceDetail: 'route' as 'region' | 'route' | 'intent',
    itemGuidanceEnabled: true,
    cooldownTrackingEnabled: true,
    communicationAssistEnabled: false,
    communicationTemplates: {
      missing: '敌方失踪，请注意',
      resource: '准备争夺资源',
      retreat: '先撤退，等待队友',
      push: '可以推进兵线',
      group: '请集合',
      danger: '危险，请后退'
    } as CoachCommunicationTemplates,
    communicationCategories: {
      missing: true,
      resource: true,
      retreat: true,
      push: true,
      group: true,
      danger: true
    } as CoachCommunicationCategorySettings,
    communicationCooldownSeconds: 10,
    communicationConfirmShortcut: null as string | null,
    speechEnabled: true,
    speechVoiceId: null as string | null,
    speechOutputDeviceId: null as string | null,
    speechVolume: 0.8,
    soundVolume: 0.8,
    speechRate: 1,
    cueCategories: {
      information: true,
      warning: true,
      resource: true,
      opportunity: true,
      system: true,
      review: true
    } as Record<string, boolean>,
    muted: false,
    pauseShortcut: null as string | null,
    muteShortcut: null as string | null,
    repeatShortcut: null as string | null,
    overlayShortcut: null as string | null,
    recalibrateShortcut: null as string | null,
    overlayEnabled: true,
    overlayOpacity: 0.92,
    overlayLocked: true,
    replaySpeechSimulation: false
  })

  const session = reactive({
    id: null as string | null,
    state: 'disabled' as CoachSessionState,
    pauseReason: null as CoachPauseReason | null,
    mapId: null as number | null,
    queueId: null as number | null,
    patch: null as string | null,
    startedAt: null as number | null
  })

  const capability = reactive({
    enabledFeatureIds: [] as string[],
    unavailable: {} as Record<string, CoachUnavailableReason>
  })

  const capture = reactive({
    state: 'idle',
    backend: null as string | null,
    fps: 0,
    frameAgeMs: null as number | null,
    roiState: 'unknown',
    resolution: null as { width: number; height: number } | null,
    confidence: null as number | null,
    lastObservationAt: null as number | null,
    modelVersions: {} as Record<string, string>,
    captureLatencyMs: null as number | null,
    inferenceLatencyMs: null as number | null,
    dropCount: 0,
    queueDepth: null as number | null,
    workerHeartbeatAt: null as number | null,
    workerRestartCount: 0
  })

  const liveData = reactive({
    state: 'idle',
    lastSuccessAt: null as number | null,
    sourceHealth: [] as LiveGameSourceHealth[]
  })

  const cue = shallowRef<CoachCuePublicDto | null>(null)
  const recentCues = shallowRef<CoachCuePublicDto[]>([])
  const sessionCueStats = reactive({
    total: 0,
    information: 0,
    warning: 0,
    opportunity: 0,
    system: 0,
    review: 0
  })
  const lastSessionSummary = shallowRef<LiveCoachSessionSummary | null>(null)
  const fogInferences = shallowRef<FogInference[]>([])
  const itemGuidance = shallowRef<ItemPurchaseGuidance | null>(null)
  const cooldowns = shallowRef<CoachCooldownRecord[]>([])
  const communicationHistory = shallowRef<CoachCommunicationAuditRecord[]>([])

  const speech = reactive({
    state: 'idle' as 'idle' | 'speaking' | 'muted' | 'unavailable',
    cueId: null as string | null
  })

  const conversation = reactive<CoachConversationPublicDto>({
    conversationId: null,
    state: 'idle',
    userTranscript: null,
    aiResponse: null
  })

  const lastError = shallowRef<CoachPublicError | null>(null)

  return {
    buildChannel,
    settings,
    session,
    capability,
    capture,
    liveData,
    cue,
    recentCues,
    sessionCueStats,
    lastSessionSummary,
    fogInferences,
    itemGuidance,
    cooldowns,
    communicationHistory,
    speech,
    conversation,
    lastError
  }
})
