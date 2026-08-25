import { CoachCue, CoachCuePublicDto } from '@shared/types/live-coach'

import type { LiveCoachMainContext } from './context'
import { LocalSpeechExecutor } from './local-speech-executor'

export class CueSchedulerController {
  private _pendingCues: CoachCue[] = []
  private _currentSpeakingCue: CoachCue | null = null
  private _lastSpokenTime = 0
  private readonly _minSpokenIntervalMs = 4000
  private _schedulerTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _speechExecutor: LocalSpeechExecutor
  ) {}

  public init(): void {
    this._startLoop()
  }

  public dispose(): void {
    if (this._schedulerTimer) {
      clearInterval(this._schedulerTimer)
      this._schedulerTimer = null
    }
    this.cancelAll('coach-disposed')
  }

  public submitCues(cues: CoachCue[]): void {
    const now = Date.now()
    const mode = this._context.settings.coachMode

    for (const cue of cues) {
      // 1. 根据 coachMode 过滤
      if (mode === 'minimal' && cue.category !== 'warning') {
        continue
      }

      // 2. 检查分类开关
      if (this._context.settings.cueCategories[cue.category] === false) {
        continue
      }

      // 3. 检查是否已过期
      if (cue.expiresAt <= now) {
        continue
      }

      // 插入并按优先级降序排序
      this._pendingCues.push(cue)
    }

    this._pendingCues.sort((a, b) => b.priority - a.priority)

    // 4. 高优先级提示即时打断低优先级播报机制
    if (this._pendingCues.length > 0 && this._currentSpeakingCue) {
      const topPending = this._pendingCues[0]
      if (
        topPending.priority >= 70 &&
        topPending.priority > this._currentSpeakingCue.priority + 20
      ) {
        this._context.logger.info(
          `Interrupting cue [${this._currentSpeakingCue.id}] for higher priority cue [${topPending.id}]`
        )
        this._speechExecutor.cancel()
        this._notifyCueCancelled(this._currentSpeakingCue.id, 'interrupted-by-higher-priority')
        this._currentSpeakingCue = null
        this._lastSpokenTime = 0 // 允许立即播报
      }
    }

    // 保持队列精简（最多 5 条）
    if (this._pendingCues.length > 5) {
      const removed = this._pendingCues.splice(5)
      for (const cue of removed) {
        this._notifyCueCancelled(cue.id, 'queue-overflow')
      }
    }
  }

  public cancelAll(reason: string): void {
    for (const cue of this._pendingCues) {
      this._notifyCueCancelled(cue.id, reason)
    }
    this._pendingCues = []

    if (this._currentSpeakingCue) {
      this._speechExecutor.cancel()
      this._notifyCueCancelled(this._currentSpeakingCue.id, reason)
      this._currentSpeakingCue = null
      this._context.state.setCue(null)
    }
  }

  private _startLoop(): void {
    this._schedulerTimer = setInterval(() => {
      this._processQueue()
    }, 300)
  }

  private async _processQueue(): Promise<void> {
    const now = Date.now()

    // 1. 清理过期提示
    const unexpired: CoachCue[] = []
    for (const cue of this._pendingCues) {
      if (cue.expiresAt <= now) {
        this._notifyCueCancelled(cue.id, 'expired')
      } else {
        unexpired.push(cue)
      }
    }
    this._pendingCues = unexpired

    // 2. 检查当前是否正在播报或处于最小间隔期
    if (this._speechExecutor.isSpeaking || this._currentSpeakingCue) {
      return
    }

    if (now - this._lastSpokenTime < this._minSpokenIntervalMs) {
      return
    }

    if (this._pendingCues.length === 0) {
      return
    }

    const nextCue = this._pendingCues.shift()!
    this._currentSpeakingCue = nextCue
    this._lastSpokenTime = now

    const publicDto: CoachCuePublicDto = {
      id: nextCue.id,
      sessionId: nextCue.sessionId,
      category: nextCue.category,
      priority: nextCue.priority,
      observationText: nextCue.observationText,
      impactText: nextCue.impactText,
      options: nextCue.options.map((o) => ({ id: o.id, label: o.label })),
      spokenText: nextCue.spokenText,
      createdAt: nextCue.createdAt,
      expiresAt: nextCue.expiresAt,
      status: 'speaking'
    }

    this._context.state.setCue(publicDto)
    this._context.state.setSpeechState('speaking', nextCue.id)

    const outputs = this._context.settings.outputMode
    const shouldSpeak = this._context.settings.speechEnabled && outputs.includes('speech')

    if (shouldSpeak) {
      await this._speechExecutor.speak(nextCue.spokenText, {
        volume: this._context.settings.speechVolume,
        rate: this._context.settings.speechRate,
        voiceId: this._context.settings.speechVoiceId
      })
    } else {
      // 字幕模式模拟显示时长
      await new Promise((r) => setTimeout(r, 2500))
    }

    if (this._currentSpeakingCue === nextCue) {
      this._currentSpeakingCue = null
      this._context.state.setSpeechState('idle')
      this._notifyCueSpoken(nextCue.id)

      setTimeout(() => {
        if (this._context.state.cue?.id === nextCue.id) {
          this._context.state.setCue(null)
        }
      }, 2000)
    }
  }

  private _notifyCueSpoken(cueId: string): void {
    this._context.ipc.sendEvent(this._context.namespace, 'cue-spoken', { cueId })
  }

  private _notifyCueCancelled(cueId: string, reason: string): void {
    this._context.ipc.sendEvent(this._context.namespace, 'cue-cancelled', { cueId, reason })
  }
}
