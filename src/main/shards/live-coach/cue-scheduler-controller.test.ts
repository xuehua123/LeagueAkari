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
        speechRate: 1,
        speechVoiceId: null
      },
      state: {
        cue: null as any,
        setCue: vi.fn(),
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

    // 前进 2000ms（字幕显示结束）+ 2500ms（最小播报间隔）
    await vi.advanceTimersByTimeAsync(4600)

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
})
