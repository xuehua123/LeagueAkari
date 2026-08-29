import type { FogInference, ItemPurchaseGuidance } from '@shared/types/live-coach'
import { describe, expect, it } from 'vitest'

import { LiveCoachSettings, LiveCoachState } from './state'

describe('LiveCoachState session cleanup', () => {
  it('defaults to no versioned privacy consent', () => {
    const settings = new LiveCoachSettings()

    expect(settings.onboardingCompleted).toBe(false)
    expect(settings.privacyConsentVersion).toBeNull()
  })

  it('replaces synced public objects so renderer propSync observes runtime updates', () => {
    const state = new LiveCoachState()

    const session = state.session
    state.setSessionInfo({ id: 'session-sync', state: 'active' })
    expect(state.session).not.toBe(session)

    const capability = state.capability
    state.setCapability(['coach.output.subtitle'], {})
    expect(state.capability).not.toBe(capability)

    const capture = state.capture
    state.setCaptureState({ state: 'running', fps: 10 })
    expect(state.capture).not.toBe(capture)

    const liveData = state.liveData
    state.setLiveDataState('healthy', 1000, [
      {
        domain: 'game-stats',
        state: 'healthy',
        lastSuccessAt: 1000,
        lastErrorCode: null,
        consecutiveFailures: 0
      }
    ])
    expect(state.liveData).not.toBe(liveData)
    expect(state.liveData.sourceHealth).toEqual([
      expect.objectContaining({ domain: 'game-stats', state: 'healthy' })
    ])

    const speech = state.speech
    state.setSpeechState('speaking', 'cue-sync')
    expect(state.speech).not.toBe(speech)
  })

  it('clears every session-scoped artifact when the session resets', () => {
    const state = new LiveCoachState()
    state.setSessionInfo({ id: 'session-1', state: 'active', startedAt: 1000 })
    state.fogInferences = [{ id: 'fog-1' }] as FogInference[]
    state.itemGuidance = { id: 'guidance-1' } as ItemPurchaseGuidance
    state.conversation = {
      conversationId: 'conversation-1',
      state: 'completed',
      userTranscript: '我该回城吗',
      aiResponse: '可以回城'
    }
    state.setSpeechState('speaking', 'cue-1')
    state.setLastError({
      code: 'internal-error',
      stage: 'test',
      recoverable: true,
      occurredAt: Date.now()
    })
    state.addRecentCue({
      id: 'cue-1',
      sessionId: 'session-1',
      category: 'warning',
      priority: 80,
      observationText: '危险',
      impactText: null,
      options: [],
      spokenText: '危险',
      createdAt: 1500,
      expiresAt: 5000,
      status: 'spoken'
    })
    state.completeSessionSummary('game-ended', 4000)

    state.reset('idle')

    expect(state.session.id).toBeNull()
    expect(state.fogInferences).toEqual([])
    expect(state.itemGuidance).toBeNull()
    expect(state.conversation).toEqual({
      conversationId: null,
      state: 'idle',
      userTranscript: null,
      aiResponse: null
    })
    expect(state.speech).toEqual({ state: 'idle', cueId: null })
    expect(state.lastError).toBeNull()
    expect(state.sessionCueStats.total).toBe(0)
    expect(state.lastSessionSummary).toMatchObject({
      sessionId: 'session-1',
      durationSeconds: 3,
      endReason: 'game-ended',
      totalCues: 1,
      cueCounts: { warning: 1 }
    })
  })

  it('keeps terminal cue history after a session ends without counting suppressed cues as delivered', () => {
    const state = new LiveCoachState()
    state.setSessionInfo({ id: 'session-history', state: 'active', startedAt: 1000 })
    state.addRecentCue({
      id: 'cue-suppressed',
      sessionId: 'session-history',
      category: 'information',
      priority: 30,
      observationText: '低优先级提示',
      impactText: null,
      options: [],
      spokenText: '低优先级提示',
      createdAt: 1500,
      expiresAt: 5000,
      status: 'suppressed',
      cancellationReason: 'priority-below-current-mode'
    })
    state.addRecentCue({
      id: 'cue-delivered',
      sessionId: 'session-history',
      category: 'warning',
      priority: 80,
      observationText: '危险',
      impactText: null,
      options: [],
      spokenText: '危险',
      createdAt: 1600,
      expiresAt: 5000,
      status: 'spoken'
    })

    expect(state.sessionCueStats.total).toBe(1)
    state.completeSessionSummary('game-ended', 4000)
    state.reset('idle', true)

    expect(state.recentCues.map((cue) => cue.id)).toEqual(['cue-suppressed', 'cue-delivered'])
    expect(state.sessionCueStats.total).toBe(0)
    expect(state.lastSessionSummary?.totalCues).toBe(1)
  })

  it('does not turn a missing speech runtime into an idle/available-looking state on reset', () => {
    const state = new LiveCoachState()
    state.setSpeechState('unavailable')

    state.reset('disabled')

    expect(state.speech).toEqual({ state: 'unavailable', cueId: null })
  })

  it('keeps the public speech state muted while clearing session artifacts', () => {
    const state = new LiveCoachState()
    state.setSpeechState('muted', 'cue-before-reset')

    state.reset('idle')

    expect(state.speech).toEqual({ state: 'muted', cueId: null })
  })

  it('keeps communication audit across session resets and deletes it only with all coach data', () => {
    const state = new LiveCoachState()
    state.addCommunicationAudit({
      id: 'communication-1',
      sessionId: 'session-1',
      cueId: 'cue-1',
      optionId: 'opt_ping_missing',
      kind: 'missing',
      action: 'copied',
      channel: 'ping',
      message: '敌方失踪，请注意',
      reason: 'approved-in-game-send-interface-unavailable',
      createdAt: 1000
    })

    state.reset('idle')
    expect(state.communicationHistory).toHaveLength(1)

    state.clearAllCoachData()
    expect(state.communicationHistory).toEqual([])
  })
})
