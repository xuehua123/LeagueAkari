import { CoachCue } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { CueSchedulerController } from './cue-scheduler-controller'
import { LocalSpeechExecutor } from './local-speech-executor'

describe('CueSchedulerController', () => {
  function createMockContext() {
    return {
      namespace: 'live-coach-main',
      settings: {
        enabled: true,
        coachMode: 'balanced',
        shadowModeEnabled: false,
        cueCategories: {
          warning: true,
          opportunity: true,
          information: true,
          system: true,
          review: true
        },
        outputMode: ['subtitle'],
        speechEnabled: false,
        speechVolume: 1,
        soundVolume: 0.8,
        speechRate: 1,
        speechVoiceId: null,
        speechOutputDeviceId: null
      },
      state: {
        session: { state: 'active' },
        cue: null as any,
        setCue: vi.fn(),
        addRecentCue: vi.fn(),
        setSpeechState: vi.fn()
      },
      ipc: {
        sendEvent: vi.fn()
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    } as any
  }

  it('keeps the public speech state unavailable when the native engine is missing', () => {
    const ctx = createMockContext()
    const scheduler = new CueSchedulerController(ctx, {
      isAvailable: false,
      isSpeaking: false,
      cancel: vi.fn()
    } as any)

    scheduler.reset()

    expect(ctx.state.setSpeechState).toHaveBeenLastCalledWith('unavailable')
  })

  it('records eligible cues without starting any output while shadow mode is enabled', () => {
    const ctx = createMockContext()
    ctx.settings.shadowModeEnabled = true
    const speech = {
      isAvailable: true,
      isSpeaking: false,
      speak: vi.fn(),
      cancel: vi.fn()
    } as any
    const sound = { playSound: vi.fn() } as any
    const scheduler = new CueSchedulerController(ctx, speech, sound)
    const now = Date.now()

    scheduler.submitCues([
      {
        id: 'cue_shadow',
        sessionId: 'session',
        ruleId: 'rule',
        ruleVersion: '1',
        category: 'warning',
        priority: 80,
        observationText: 'Missing enemy',
        impactText: null,
        options: [],
        spokenText: 'Enemy may be moving',
        evidenceIds: ['evidence-1'],
        createdAt: now,
        expiresAt: now + 10_000,
        status: 'pending',
        cancellationReason: null
      }
    ])

    expect(ctx.state.addRecentCue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cue_shadow',
        status: 'suppressed',
        cancellationReason: 'shadow-mode'
      })
    )
    expect(ctx.state.setCue).not.toHaveBeenCalled()
    expect(speech.speak).not.toHaveBeenCalled()
    expect(sound.playSound).not.toHaveBeenCalled()
  })

  it('keeps subtitles active while muted and suppresses all audio output', async () => {
    vi.useFakeTimers()
    const ctx = createMockContext()
    ctx.settings.outputMode = ['sound', 'speech']
    ctx.settings.speechEnabled = true
    ctx.settings.muted = true
    ctx.state.capability = {
      enabledFeatureIds: ['coach.output.sound', 'coach.output.tts', 'coach.output.subtitle']
    }
    const speech: any = {
      isSpeaking: false,
      speak: vi.fn().mockResolvedValue(true),
      cancel: vi.fn()
    }
    const sound = { playSound: vi.fn().mockResolvedValue(true) } as any
    const scheduler = new CueSchedulerController(ctx, speech, sound)
    const now = Date.now()

    scheduler.submitCues([
      {
        id: 'cue_muted',
        sessionId: 'session',
        ruleId: 'rule',
        ruleVersion: '1',
        category: 'warning',
        priority: 80,
        observationText: 'Missing enemy',
        impactText: null,
        options: [],
        spokenText: 'Enemy may be moving',
        evidenceIds: [],
        createdAt: now,
        expiresAt: now + 10_000,
        status: 'pending',
        cancellationReason: null
      }
    ])

    expect(ctx.state.setCue).toHaveBeenCalledWith(expect.objectContaining({ id: 'cue_muted' }))
    expect(speech.speak).not.toHaveBeenCalled()
    expect(sound.playSound).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2_100)
    expect(scheduler.showLastCueAgain()).toBe(true)
    expect(ctx.state.setCue).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'cue_muted', status: 'spoken' })
    )
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('stops active speech and records an already-visible subtitle when speech output is disabled', async () => {
    vi.useFakeTimers()
    const ctx = createMockContext()
    ctx.settings.outputMode = ['subtitle', 'speech']
    ctx.settings.speechEnabled = true
    ctx.settings.muted = false
    ctx.state.capability = {
      enabledFeatureIds: ['coach.output.tts', 'coach.output.subtitle']
    }
    ctx.state.setCue = vi.fn((cue) => {
      ctx.state.cue = cue
    })

    let resolveSpeech!: (value: boolean) => void
    const speech: any = {
      isSpeaking: false,
      speak: vi.fn(() => {
        speech.isSpeaking = true
        return new Promise<boolean>((resolve) => (resolveSpeech = resolve))
      }),
      cancel: vi.fn()
    }
    const scheduler = new CueSchedulerController(ctx, speech)
    const cue: CoachCue = {
      id: 'cue_disable_speech',
      sessionId: 'session',
      ruleId: 'rule',
      ruleVersion: '1',
      category: 'warning',
      priority: 80,
      observationText: 'Missing enemy',
      impactText: null,
      options: [],
      spokenText: 'Enemy may be moving',
      evidenceIds: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + 10_000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])
    await Promise.resolve()
    scheduler.cancelSpeechPlayback()

    expect(speech.cancel).toHaveBeenCalled()
    expect(cue.status).toBe('spoken')
    expect(ctx.state.addRecentCue).toHaveBeenCalledWith(
      expect.objectContaining({ id: cue.id, status: 'spoken' })
    )

    resolveSpeech(false)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2_100)
    expect(ctx.state.setCue).toHaveBeenLastCalledWith(null)
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('immediately cancels an active cue when its category is disabled', () => {
    vi.useFakeTimers()
    const ctx = createMockContext()
    const speech = new LocalSpeechExecutor(ctx)
    const scheduler = new CueSchedulerController(ctx, speech)
    const now = Date.now()
    const cue: CoachCue = {
      id: 'cue_disabled_category',
      sessionId: 'session',
      ruleId: 'rule',
      ruleVersion: '1',
      category: 'warning',
      priority: 80,
      observationText: 'Warning',
      impactText: null,
      options: [],
      spokenText: 'Warning',
      evidenceIds: [],
      createdAt: now,
      expiresAt: now + 10_000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])
    scheduler.applyCategorySettings({ warning: false })

    expect(cue).toMatchObject({ status: 'cancelled', cancellationReason: 'category-disabled' })
    expect(ctx.ipc.sendEvent).toHaveBeenCalledWith('live-coach-main', 'cue-cancelled', {
      cueId: cue.id,
      reason: 'category-disabled'
    })
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('automatically continues processing next cue in queue after first cue finishes', async () => {
    vi.useFakeTimers()
    const ctx = createMockContext()
    const speech = new LocalSpeechExecutor(ctx)
    const scheduler = new CueSchedulerController(ctx, speech)

    const now = Date.now()
    const cue1: CoachCue = {
      id: 'cue_1',
      sessionId: 'sess_1',
      ruleId: 'r1',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 80,
      observationText: 'Cue 1',
      impactText: null,
      options: [],
      spokenText: 'Cue 1 Text',
      evidenceIds: ['evi_1'],
      createdAt: now,
      expiresAt: now + 20000,
      status: 'pending',
      cancellationReason: null
    }

    const cue2: CoachCue = {
      id: 'cue_2',
      sessionId: 'sess_1',
      ruleId: 'r2',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 70,
      observationText: 'Cue 2',
      impactText: null,
      options: [],
      spokenText: 'Cue 2 Text',
      evidenceIds: ['evi_2'],
      createdAt: now,
      expiresAt: now + 20000,
      status: 'pending',
      cancellationReason: null
    }

    // 提交两条 Cue
    scheduler.submitCues([cue1, cue2])

    // 第一条 Cue 正在处理
    expect(ctx.state.setCue).toHaveBeenCalledWith(expect.objectContaining({ id: 'cue_1' }))

    // 字幕显示 2000ms 后，仅等待到距上次开始共 2500ms，而不是额外再等 2500ms
    await vi.advanceTimersByTimeAsync(2600)

    // 验证第二条 Cue 自动被调度执行！
    expect(ctx.state.setCue).toHaveBeenCalledWith(expect.objectContaining({ id: 'cue_2' }))

    vi.useRealTimers()
  })

  it('cancels queued and active cues when matching invalidated evidence IDs', async () => {
    const ctx = createMockContext()
    const speech = new LocalSpeechExecutor(ctx)
    const scheduler = new CueSchedulerController(ctx, speech)

    const now = Date.now()
    const cue: CoachCue = {
      id: 'cue_fog_1',
      sessionId: 'sess_1',
      ruleId: 'rule_fog_inference',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 70,
      observationText: 'Fog Warning',
      impactText: null,
      options: [],
      spokenText: 'Fog Spoken',
      evidenceIds: ['evi_last_seen_zed', 'evi_fog_zed_123'],
      createdAt: now,
      expiresAt: now + 20000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])
    expect(ctx.state.setCue).toHaveBeenCalledWith(expect.objectContaining({ id: 'cue_fog_1' }))

    // 敌方重新出现，证据失效广播
    scheduler.cancelCuesByEvidenceIds(['evi_fog_zed_123'])

    // 验证 Cue 已被取消
    expect(ctx.ipc.sendEvent).toHaveBeenCalledWith(
      'live-coach-main',
      'cue-cancelled',
      expect.objectContaining({ cueId: 'cue_fog_1', reason: 'evidence-invalidated' })
    )
  })

  it('suppresses cues without calling setCue, speak, or sending cue-spoken when Gate B is disabled', () => {
    const ctx = createMockContext()
    ctx.state.capability = {
      enabledFeatureIds: [], // Gate B 关闭：无 coach.output.subtitle / tts
      unavailableReasons: { 'coach.output.subtitle': 'capability-disabled' }
    }
    const speech = new LocalSpeechExecutor(ctx)
    const speakSpy = vi.spyOn(speech, 'speak')
    const scheduler = new CueSchedulerController(ctx, speech)

    const cue: CoachCue = {
      id: 'cue_gate_b_1',
      sessionId: 'sess_1',
      ruleId: 'r1',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 80,
      observationText: 'Obs',
      impactText: null,
      options: [],
      spokenText: 'Spoken text',
      evidenceIds: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + 10000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])

    // 断言：setCue 未被调用
    expect(ctx.state.setCue).not.toHaveBeenCalled()
    // 断言：TTS speak 未被调用
    expect(speakSpy).not.toHaveBeenCalled()
    // 断言：未发送 cue-spoken 事件
    expect(ctx.ipc.sendEvent).not.toHaveBeenCalledWith(
      'live-coach-main',
      'cue-spoken',
      expect.anything()
    )
    expect(ctx.state.addRecentCue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: cue.id,
        status: 'cancelled',
        cancellationReason: 'suppressed/output-gated'
      })
    )
  })

  it('plays sound through LocalSoundExecutor when sound output is enabled', async () => {
    const ctx = createMockContext()
    ctx.settings.outputMode = ['sound']
    ctx.state.capability = {
      enabledFeatureIds: ['coach.output.sound', 'coach.output.subtitle'],
      unavailableReasons: {}
    }

    const soundExecutor = {
      isAvailable: vi.fn().mockReturnValue(true),
      playSound: vi.fn().mockResolvedValue(true)
    } as any

    const speech = new LocalSpeechExecutor(ctx)
    const scheduler = new CueSchedulerController(ctx, speech, soundExecutor)

    const cue: CoachCue = {
      id: 'cue_sound_1',
      sessionId: 'sess_1',
      ruleId: 'r1',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 80,
      observationText: 'Sound Warning',
      impactText: null,
      options: [],
      spokenText: 'Warning text',
      evidenceIds: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + 10000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])
    await new Promise((r) => setTimeout(r, 20))
    expect(soundExecutor.playSound).toHaveBeenCalledWith('warning', expect.anything())
  })

  it('falls back to displaying subtitle when sound playback fails in sound-only mode', async () => {
    const ctx = createMockContext()
    ctx.settings.outputMode = ['sound']
    ctx.state.capability = {
      enabledFeatureIds: ['coach.output.sound', 'coach.output.subtitle'],
      unavailableReasons: {}
    }

    const soundExecutor = {
      isAvailable: vi.fn().mockReturnValue(true),
      playSound: vi.fn().mockResolvedValue(false)
    } as any

    const speech = new LocalSpeechExecutor(ctx)
    const scheduler = new CueSchedulerController(ctx, speech, soundExecutor)

    const cueFail: CoachCue = {
      id: 'cue_sound_fail',
      sessionId: 'sess_1',
      ruleId: 'r1',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 80,
      observationText: 'Sound Warning Fail',
      impactText: null,
      options: [],
      spokenText: 'Warning text',
      evidenceIds: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + 10000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cueFail])
    await new Promise((r) => setTimeout(r, 20))
    expect(ctx.state.setCue).toHaveBeenCalledWith(expect.objectContaining({ id: 'cue_sound_fail' }))
  })

  it('falls back to subtitle when speech-only delivery fails', async () => {
    const ctx = createMockContext()
    ctx.settings.outputMode = ['speech']
    ctx.settings.speechEnabled = true
    ctx.state.capability = {
      enabledFeatureIds: ['coach.output.tts', 'coach.output.subtitle'],
      unavailableReasons: {}
    }
    const speech = {
      isSpeaking: false,
      speak: vi.fn().mockResolvedValue(false),
      cancel: vi.fn()
    } as any
    const scheduler = new CueSchedulerController(ctx, speech)
    const now = Date.now()
    const cue: CoachCue = {
      id: 'cue_speech_fail',
      sessionId: 'sess_1',
      ruleId: 'r1',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 80,
      observationText: 'Speech failure',
      impactText: null,
      options: [],
      spokenText: 'Speech failure',
      evidenceIds: [],
      createdAt: now,
      expiresAt: now + 10000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])
    await Promise.resolve()
    await Promise.resolve()

    expect(speech.speak).toHaveBeenCalledOnce()
    expect(ctx.state.setCue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cue_speech_fail' })
    )
    scheduler.dispose()
  })

  it('falls back to subtitle when sound and speech both fail', async () => {
    const ctx = createMockContext()
    ctx.settings.outputMode = ['sound', 'speech']
    ctx.settings.speechEnabled = true
    ctx.state.capability = {
      enabledFeatureIds: ['coach.output.sound', 'coach.output.tts', 'coach.output.subtitle'],
      unavailableReasons: {}
    }
    const speech = {
      isSpeaking: false,
      speak: vi.fn().mockResolvedValue(false),
      cancel: vi.fn()
    } as any
    const sound = {
      playSound: vi.fn().mockResolvedValue(false)
    } as any
    const scheduler = new CueSchedulerController(ctx, speech, sound)
    const now = Date.now()
    const cue: CoachCue = {
      id: 'cue_audio_fail',
      sessionId: 'sess_1',
      ruleId: 'r1',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 80,
      observationText: 'Audio failure',
      impactText: null,
      options: [],
      spokenText: 'Audio failure',
      evidenceIds: [],
      createdAt: now,
      expiresAt: now + 10000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(sound.playSound).toHaveBeenCalledOnce()
    expect(speech.speak).toHaveBeenCalledOnce()
    expect(ctx.state.setCue).toHaveBeenCalledWith(expect.objectContaining({ id: 'cue_audio_fail' }))
    scheduler.dispose()
  })

  it('treats cue IDs as idempotency keys and never speaks the same cue twice', async () => {
    vi.useFakeTimers()
    const ctx = createMockContext()
    const speech = new LocalSpeechExecutor(ctx)
    const scheduler = new CueSchedulerController(ctx, speech)
    const now = Date.now()
    const cue: CoachCue = {
      id: 'cue_duplicate',
      sessionId: 'sess_1',
      ruleId: 'r1',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 80,
      observationText: 'Duplicate',
      impactText: null,
      options: [],
      spokenText: 'Duplicate',
      evidenceIds: [],
      createdAt: now,
      expiresAt: now + 10000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])
    scheduler.submitCues([{ ...cue }])
    await vi.advanceTimersByTimeAsync(6000)

    const displayed = ctx.state.setCue.mock.calls.filter(([value]) => value?.id === cue.id)
    expect(displayed).toHaveLength(1)
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('keeps suppressed and pre-pause cue IDs idempotent', () => {
    const ctx = createMockContext()
    ctx.settings.coachMode = 'minimal'
    const scheduler = new CueSchedulerController(ctx, {
      isAvailable: true,
      isSpeaking: true,
      cancel: vi.fn()
    } as any)
    const now = Date.now()
    const suppressed: CoachCue = {
      id: 'cue_suppressed_once',
      sessionId: 'session',
      ruleId: 'rule',
      ruleVersion: '1',
      category: 'information',
      priority: 40,
      observationText: 'Suppressed',
      impactText: null,
      options: [],
      spokenText: 'Suppressed',
      evidenceIds: [],
      createdAt: now,
      expiresAt: now + 10_000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([suppressed])
    scheduler.submitCues([{ ...suppressed, status: 'pending', cancellationReason: null }])

    expect(ctx.state.addRecentCue).toHaveBeenCalledTimes(1)
    expect(scheduler.getCue(suppressed.id)).toMatchObject({
      status: 'suppressed',
      cancellationReason: 'priority-below-current-mode'
    })

    ctx.settings.coachMode = 'balanced'
    const pending: CoachCue = {
      ...suppressed,
      id: 'cue_before_pause',
      priority: 60,
      status: 'pending',
      cancellationReason: null
    }
    scheduler.submitCues([pending])
    scheduler.reset(true)
    scheduler.submitCues([{ ...pending, status: 'pending', cancellationReason: null }])

    expect(scheduler.getCue(pending.id)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'scheduler-reset'
    })
    scheduler.dispose()
  })

  it('applies density changes to queued cues immediately', () => {
    const ctx = createMockContext()
    ctx.settings.cueDensity = 'standard'
    ctx.settings.minimumCueIntervalSeconds = 3
    const scheduler = new CueSchedulerController(ctx, {
      isAvailable: true,
      isSpeaking: true,
      cancel: vi.fn()
    } as any)
    const now = Date.now()
    const cue: CoachCue = {
      id: 'cue-density',
      sessionId: 'session',
      ruleId: 'rule',
      ruleVersion: '1',
      category: 'information',
      priority: 45,
      observationText: 'Density',
      impactText: null,
      options: [],
      spokenText: 'Density',
      evidenceIds: [],
      createdAt: now,
      expiresAt: now + 10000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])
    expect(scheduler.getCue(cue.id)?.status).toBe('pending')

    ctx.settings.cueDensity = 'low'
    scheduler.applyPacingSettings()

    expect(scheduler.getCue(cue.id)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'pacing-settings-changed'
    })
    scheduler.dispose()
  })

  it('drops a real-time cue that already waited more than 2.5 seconds', () => {
    const ctx = createMockContext()
    const speech = new LocalSpeechExecutor(ctx)
    const scheduler = new CueSchedulerController(ctx, speech)
    const now = Date.now()
    const cue: CoachCue = {
      id: 'cue_stale',
      sessionId: 'sess_1',
      ruleId: 'r1',
      ruleVersion: '1.0',
      category: 'warning',
      priority: 80,
      observationText: 'Stale',
      impactText: null,
      options: [],
      spokenText: 'Stale',
      evidenceIds: [],
      createdAt: now - 2501,
      expiresAt: now + 10000,
      status: 'pending',
      cancellationReason: null
    }

    scheduler.submitCues([cue])

    expect(cue.status).toBe('expired')
    expect(cue.cancellationReason).toBe('queue-delay-exceeded')
    expect(ctx.state.setCue).not.toHaveBeenCalled()
    expect(ctx.state.addRecentCue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: cue.id,
        status: 'expired',
        cancellationReason: 'queue-delay-exceeded'
      })
    )
    scheduler.dispose()
  })

  it('prevents an interrupted async playback from overwriting the replacement cue state', async () => {
    const ctx = createMockContext()
    ctx.settings.outputMode = ['speech']
    ctx.settings.speechEnabled = true
    ctx.state.capability = {
      enabledFeatureIds: ['coach.output.tts', 'coach.output.subtitle'],
      unavailableReasons: {}
    }

    let resolveLow!: (value: boolean) => void
    let resolveHigh!: (value: boolean) => void
    const speech = {
      isSpeaking: false,
      speak: vi
        .fn()
        .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveLow = resolve)))
        .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveHigh = resolve))),
      cancel: vi.fn()
    } as any
    const scheduler = new CueSchedulerController(ctx, speech)
    const now = Date.now()
    const makeCue = (id: string, priority: number): CoachCue => ({
      id,
      sessionId: 'sess_1',
      ruleId: id,
      ruleVersion: '1.0',
      category: 'warning',
      priority,
      observationText: id,
      impactText: null,
      options: [],
      spokenText: id,
      evidenceIds: [],
      createdAt: now,
      expiresAt: now + 10000,
      status: 'pending',
      cancellationReason: null
    })
    const low = makeCue('cue_low', 50)
    const high = makeCue('cue_high', 80)

    scheduler.submitCues([low])
    await Promise.resolve()
    scheduler.submitCues([high])
    await Promise.resolve()
    resolveHigh(true)
    await Promise.resolve()
    await Promise.resolve()
    resolveLow(false)
    await Promise.resolve()
    await Promise.resolve()

    expect(low.status).toBe('cancelled')
    expect(low.cancellationReason).toBe('interrupted-by-higher-priority')
    expect(ctx.state.setCue).not.toHaveBeenCalledWith(expect.objectContaining({ id: low.id }))
    expect(ctx.ipc.sendEvent).toHaveBeenCalledWith('live-coach-main', 'cue-spoken', {
      cueId: high.id
    })
    scheduler.dispose()
  })
})
