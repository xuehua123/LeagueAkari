import { CoachCue, CoachCuePublicDto } from '@shared/types/live-coach'

import type { LiveCoachMainContext } from './context'
import { LocalSpeechExecutor } from './local-speech-executor'

export class CueSchedulerController {
  private readonly _cues = new Map<string, CoachCue>()
  private _pendingCues: CoachCue[] = []
  private _currentSpeakingCue: CoachCue | null = null
  private _lastSpokenTime = 0
  private readonly _minSpokenIntervalMs = 2500
  private _nextCueTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _speechExecutor: LocalSpeechExecutor
  ) {}

  public init(): void {}

  public dispose(): void {
    this.reset()
  }

  public submitCues(cues: CoachCue[]): void {
    const now = Date.now()
    const categories = this._context.settings.cueCategories
    const mode = this._context.settings.coachMode

    // 模式门槛判定：minimal 仅放行 >= 70 高危提示，balanced 放行 >= 40，training 放行 >= 20
    const minPriorityThreshold = mode === 'minimal' ? 70 : mode === 'balanced' ? 40 : 20

    let highestNewPriority = 0

    for (const cue of cues) {
      // 1. 过滤已关闭类别
      if (categories && categories[cue.category] === false) {
        continue
      }
      // 2. 过滤不满足模式门槛的提示
      if (cue.priority < minPriorityThreshold) {
        continue
      }
      // 3. 过滤已过期的提示
      if (cue.expiresAt <= now) {
        continue
      }

      this._cues.set(cue.id, cue)
      this._pendingCues.push(cue)
      if (cue.priority > highestNewPriority) {
        highestNewPriority = cue.priority
      }
    }

    // 按优先级降序排序 (Priority 越高越先播放)
    this._pendingCues.sort((a, b) => b.priority - a.priority)

    // 限制队列上限（保留最高优先级的 5 条提示）
    if (this._pendingCues.length > 5) {
      this._pendingCues = this._pendingCues.slice(0, 5)
    }

    // 高优先级打断低优先级播报（Preemption）
    if (
      this._currentSpeakingCue &&
      highestNewPriority >= 70 &&
      highestNewPriority > this._currentSpeakingCue.priority + 15
    ) {
      const interruptedCueId = this._currentSpeakingCue.id
      this._speechExecutor.cancel()
      this._currentSpeakingCue = null
      this._notifyCueCancelled(interruptedCueId, 'interrupted-by-higher-priority')
    }

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
      this._scheduleNextProcess(100)
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
      this._scheduleNextProcess(100)
    }

    for (const id of cancelledIds) {
      this._notifyCueCancelled(id, reason)
    }
  }

  public reset(): void {
    if (this._nextCueTimer) {
      clearTimeout(this._nextCueTimer)
      this._nextCueTimer = null
    }
    this._speechExecutor.cancel()
    this._pendingCues = []
    this._currentSpeakingCue = null
    this._cues.clear()
    this._context.state.setCue(null)
    this._context.state.setSpeechState('idle')
  }

  private _scheduleNextProcess(delayMs: number): void {
    if (this._nextCueTimer) {
      clearTimeout(this._nextCueTimer)
    }
    this._nextCueTimer = setTimeout(() => {
      this._nextCueTimer = null
      this._processNextCue()
    }, delayMs)
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

    // 2. 检查当前是否正在播报
    if (this._speechExecutor.isSpeaking || this._currentSpeakingCue) {
      return
    }

    // 3. 检查最小播报时间间隔
    const elapsedSinceLastSpoken = now - this._lastSpokenTime
    if (elapsedSinceLastSpoken < this._minSpokenIntervalMs) {
      const waitTime = this._minSpokenIntervalMs - elapsedSinceLastSpoken
      this._scheduleNextProcess(waitTime)
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

    try {
      if (shouldSpeak) {
        await this._speechExecutor.speak(nextCue.spokenText, {
          volume: this._context.settings.speechVolume,
          rate: this._context.settings.speechRate,
          voiceId: this._context.settings.speechVoiceId
        })
      } else {
        await new Promise((r) => setTimeout(r, 2000))
      }
    } catch {
      // 忽略播报中途被打断或取消错误
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

      // 4. 关键修复：播报完成后自动继续调度队列中的后续 Cue！
      this._scheduleNextProcess(this._minSpokenIntervalMs)
    }
  }

  private _notifyCueSpoken(cueId: string): void {
    this._context.ipc.sendEvent(this._context.namespace, 'cue-spoken', { cueId })
  }

  private _notifyCueCancelled(cueId: string, reason: string): void {
    this._context.ipc.sendEvent(this._context.namespace, 'cue-cancelled', { cueId, reason })
  }
}
