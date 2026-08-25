import { CoachCue, CoachCuePublicDto } from '@shared/types/live-coach'

import type { LiveCoachMainContext } from './context'
import { LocalSpeechExecutor } from './local-speech-executor'

export class CueSchedulerController {
  private readonly _cues = new Map<string, CoachCue>()
  private _pendingCues: CoachCue[] = []
  private _currentSpeakingCue: CoachCue | null = null
  private _lastSpokenTime = 0
  private readonly _minSpokenIntervalMs = 3000

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _speechExecutor: LocalSpeechExecutor
  ) {}

  public init(): void {}

  public dispose(): void {
    this.reset()
  }

  public submitCues(cues: CoachCue[]): void {
    for (const cue of cues) {
      this._cues.set(cue.id, cue)
      this._pendingCues.push(cue)
    }

    // 按优先级降序排序 (Priority 越高越先播放)
    this._pendingCues.sort((a, b) => b.priority - a.priority)
    this._processNextCue()
  }

  public cancelCue(cueId: string, reason: string = 'user-cancelled'): void {
    const cue = this._cues.get(cueId)
    if (!cue) return

    cue.status = 'cancelled'
    cue.cancellationReason = reason
    this._pendingCues = this._pendingCues.filter((c) => c.id !== cueId)

    if (this._currentSpeakingCue?.id === cueId) {
      this._speechExecutor.cancel()
      this._currentSpeakingCue = null
      this._context.state.setSpeechState('idle')
      this._context.state.setCue(null)
    }

    this._notifyCueCancelled(cueId, reason)
  }

  /**
   * 根据失效的证据 ID 批量撤销正在排队或正在播报的 Cue（P1-005）
   */
  public cancelCuesByEvidenceIds(
    invalidatedEvidenceIds: string[],
    reason: string = 'evidence-invalidated'
  ): void {
    const idSet = new Set(invalidatedEvidenceIds)
    const cancelledIds: string[] = []

    for (const cue of this._cues.values()) {
      if (cue.status === 'pending' || cue.status === 'speaking') {
        if (cue.evidenceIds.some((id) => idSet.has(id))) {
          cue.status = 'cancelled'
          cue.cancellationReason = reason
          cancelledIds.push(cue.id)
        }
      }
    }

    this._pendingCues = this._pendingCues.filter((c) => !cancelledIds.includes(c.id))

    if (this._currentSpeakingCue && cancelledIds.includes(this._currentSpeakingCue.id)) {
      this._speechExecutor.cancel()
      this._currentSpeakingCue = null
      this._context.state.setSpeechState('idle')
      this._context.state.setCue(null)
    }

    for (const id of cancelledIds) {
      this._notifyCueCancelled(id, reason)
    }
  }

  public reset(): void {
    this._speechExecutor.cancel()
    this._pendingCues = []
    this._currentSpeakingCue = null
    this._cues.clear()
    this._context.state.setCue(null)
    this._context.state.setSpeechState('idle')
  }

  private async _processNextCue(): Promise<void> {
    const now = Date.now()

    // 1. 清理过期 Cue
    const unexpired: CoachCue[] = []
    for (const cue of this._pendingCues) {
      if (cue.expiresAt <= now) {
        cue.status = 'expired'
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
      options: nextCue.options.map((o) => ({
        id: o.id,
        label: o.label,
        role: o.role
      })),
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
