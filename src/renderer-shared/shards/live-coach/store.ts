import {
  CoachConversationPublicDto,
  CoachCuePublicDto,
  CoachPublicError,
  CoachSessionState,
  CoachUnavailableReason
} from '@shared/types/live-coach'
import { defineStore } from 'pinia'
import { reactive, shallowRef } from 'vue'

export const useLiveCoachStore = defineStore('shard:live-coach-renderer', () => {
  const settings = reactive({
    enabled: false,
    coachMode: 'balanced' as 'minimal' | 'balanced' | 'training',
    outputMode: ['sound', 'subtitle', 'speech'] as Array<'sound' | 'subtitle' | 'speech'>,
    captureBackend: 'auto' as 'auto' | 'wgc' | 'dda',
    minimapSide: 'auto' as 'auto' | 'left' | 'right',
    speechEnabled: true,
    speechVoiceId: null as string | null,
    speechOutputDeviceId: null as string | null,
    speechVolume: 0.8,
    speechRate: 1,
    cueCategories: {
      information: true,
      warning: true,
      opportunity: true,
      system: true,
      review: true
    } as Record<string, boolean>,
    overlayEnabled: true,
    overlayOpacity: 0.92,
    replaySpeechSimulation: false
  })

  const session = reactive({
    id: null as string | null,
    state: 'disabled' as CoachSessionState,
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
    roiState: 'unknown'
  })

  const liveData = reactive({
    state: 'idle',
    lastSuccessAt: null as number | null
  })

  const cue = shallowRef<CoachCuePublicDto | null>(null)

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
    settings,
    session,
    capability,
    capture,
    liveData,
    cue,
    speech,
    conversation,
    lastError
  }
})
