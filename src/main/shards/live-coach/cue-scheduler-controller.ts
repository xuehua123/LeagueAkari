import { CoachCue, CoachCuePublicDto } from '@shared/types/live-coach'

import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import type { LiveCoachMainContext } from './context'
import { LocalSoundExecutor } from './local-sound-executor'
import { LocalSpeechExecutor } from './local-speech-executor'

export class CueSchedulerController {
  public onCueAudit: ((cue: Readonly<CoachCue>) => void) | null = null
  private readonly _cues = new Map<string, CoachCue>()
  private readonly _cueHistory = new Map<string, CoachCue>()
  private _pendingCues: CoachCue[] = []
  private _currentSpeakingCue: CoachCue | null = null
  private _lastDeliveredCue: CoachCuePublicDto | null = null
  private _lastSpokenTime = 0
  private readonly _maxQueueDelayMs = 2500
  private _playbackGeneration = 0
  private _nextCueTimer: NodeJS.Timeout | null = null
  private _repeatedCueTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _speechExecutor: LocalSpeechExecutor,
    private readonly _soundExecutor?: LocalSoundExecutor
  ) {}

  public init(): void {}

  public dispose(): void {
    this.reset()
  }

  public submitCues(cues: CoachCue[]): void {
    const now = Date.now()
    const categories = this._context.settings.cueCategories
    const minPriorityThreshold = this._minimumPriorityThreshold()

    let highestNewPriority = 0

    for (const cue of cues) {
      // Cue ID 是一次提示的幂等键。重复提交只保留第一次，避免同一事实被排队、播报两次。
      if (this._cues.has(cue.id) || this._cueHistory.has(cue.id)) {
        continue
      }
      // 即使随后因类别、模式或时效被抑制，也必须先登记幂等键和审计记录。
      // 否则每次规则评估都会把同一个终态 Cue 当作新提示重复处理。
      this._cues.set(cue.id, cue)
      this._cueHistory.set(cue.id, cue)
      // Capture evidence traceability at the actual scheduler boundary while the rule engine's
      // current evidence is still available. Later terminal audits preserve that verified result.
      this.onCueAudit?.(cue)
      // 1. 过滤已关闭类别
      if (categories && categories[cue.category] === false) {
        cue.status = 'suppressed'
        cue.cancellationReason = 'category-disabled'
        this._recordCue(cue)
        continue
      }
      // 2. 过滤不满足模式门槛的提示
      if (cue.priority < minPriorityThreshold) {
        cue.status = 'suppressed'
        cue.cancellationReason = 'priority-below-current-mode'
        this._recordCue(cue)
        continue
      }
      // 3. 过滤已过期或已经错过实时播报窗口的提示
      if (cue.expiresAt <= now || now - cue.createdAt > this._maxQueueDelayMs) {
        cue.status = 'expired'
        cue.cancellationReason = 'queue-delay-exceeded'
        this._recordCue(cue)
        continue
      }
      // Shadow 模式完整运行检测、规则与过滤逻辑，但绝不进入任何声音或字幕输出队列。
      // 终态保留在审计历史中，供真实对局质量评估使用。
      if (
        this._context.settings.shadowModeEnabled ||
        this._context.state.session.state === 'shadow'
      ) {
        cue.status = 'suppressed'
        cue.cancellationReason = 'shadow-mode'
        this._recordCue(cue)
        continue
      }

      this._pendingCues.push(cue)
      if (cue.priority > highestNewPriority) {
        highestNewPriority = cue.priority
      }
    }

    // 按优先级降序排序 (Priority 越高越先播放)
    this._pendingCues.sort((a, b) => b.priority - a.priority)

    // 限制队列上限（保留最高优先级的 5 条提示）
    if (this._pendingCues.length > 5) {
      const dropped = this._pendingCues.slice(5)
      this._pendingCues = this._pendingCues.slice(0, 5)
      for (const cue of dropped) {
        cue.status = 'cancelled'
        cue.cancellationReason = 'queue-overflow'
        this._recordCue(cue)
        this._notifyCueCancelled(cue.id, 'queue-overflow')
      }
    }

    // 高优先级打断低优先级播报（Preemption）
    if (
      this._currentSpeakingCue &&
      highestNewPriority >= 70 &&
      highestNewPriority > this._currentSpeakingCue.priority + 15
    ) {
      const interruptedCue = this._currentSpeakingCue
      const interruptedCueId = interruptedCue.id
      interruptedCue.status = 'cancelled'
      interruptedCue.cancellationReason = 'interrupted-by-higher-priority'
      this._speechExecutor.cancel()
      this._playbackGeneration++
      this._currentSpeakingCue = null
      this._lastSpokenTime = 0
      this._setReadySpeechState()
      this._context.state.setCue(null)
      this._recordCue(interruptedCue)
      this._notifyCueCancelled(interruptedCueId, 'interrupted-by-higher-priority')
    }

    this._processNextCue()
  }

  public cancelCue(cueId: string, reason: string = 'user-cancelled'): void {
    const cue = this._cues.get(cueId)
    if (!cue) return

    cue.status = 'cancelled'
    cue.cancellationReason = reason
    this._recordCue(cue)
    this._pendingCues = this._pendingCues.filter((c) => c.id !== cueId)

    if (this._currentSpeakingCue?.id === cueId) {
      this._speechExecutor.cancel()
      this._playbackGeneration++
      this._currentSpeakingCue = null
      this._setReadySpeechState()
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
      this._playbackGeneration++
      this._currentSpeakingCue = null
      this._setReadySpeechState()
      this._context.state.setCue(null)
      this._scheduleNextProcess(100)
    }

    for (const id of cancelledIds) {
      const cue = this._cues.get(id)
      if (cue) this._recordCue(cue)
      this._notifyCueCancelled(id, reason)
    }
  }

  public cancelCuesByRuleIds(ruleIds: string[], reason: string = 'feature-disabled'): void {
    const ruleIdSet = new Set(ruleIds)
    const cueIds = Array.from(this._cues.values())
      .filter(
        (cue) =>
          ruleIdSet.has(cue.ruleId) && (cue.status === 'pending' || cue.status === 'speaking')
      )
      .map((cue) => cue.id)
    for (const cueId of cueIds) {
      this.cancelCue(cueId, reason)
    }
  }

  public reset(preserveHistory: boolean = false): void {
    if (this._nextCueTimer) {
      clearTimeout(this._nextCueTimer)
      this._nextCueTimer = null
    }
    if (this._repeatedCueTimer) {
      clearTimeout(this._repeatedCueTimer)
      this._repeatedCueTimer = null
    }
    this._speechExecutor.cancel()
    this._playbackGeneration++
    if (preserveHistory) {
      for (const cue of this._cues.values()) {
        if (cue.status !== 'pending' && cue.status !== 'speaking') continue
        cue.status = 'cancelled'
        cue.cancellationReason = 'scheduler-reset'
        this._recordCue(cue)
        this._notifyCueCancelled(cue.id, 'scheduler-reset')
      }
    }
    this._pendingCues = []
    this._currentSpeakingCue = null
    this._lastSpokenTime = 0
    this._cues.clear()
    if (!preserveHistory) {
      this._cueHistory.clear()
      this._lastDeliveredCue = null
    }
    this._context.state.setCue(null)
    this._setReadySpeechState()
  }

  public applyMuteState(muted: boolean): void {
    if (muted) {
      this._cancelActivePlayback('muted')
      this._context.state.setSpeechState('muted')
      this._scheduleNextProcess(0)
      return
    }

    this._setReadySpeechState()
    this._scheduleNextProcess(0)
  }

  public cancelSpeechPlayback(): void {
    if (!this._speechExecutor.isSpeaking) {
      return
    }
    this._cancelActivePlayback('speech-output-disabled')
    this._setReadySpeechState()
    this._scheduleNextProcess(0)
  }

  public applyCategorySettings(categories: Record<string, boolean>): void {
    const isDisabled = (cue: CoachCue) => categories[cue.category] === false
    const cancelledPending = this._pendingCues.filter(isDisabled)
    this._pendingCues = this._pendingCues.filter((cue) => !isDisabled(cue))

    for (const cue of cancelledPending) {
      cue.status = 'cancelled'
      cue.cancellationReason = 'category-disabled'
      this._recordCue(cue)
      this._notifyCueCancelled(cue.id, 'category-disabled')
    }

    if (this._currentSpeakingCue && isDisabled(this._currentSpeakingCue)) {
      this.cancelCue(this._currentSpeakingCue.id, 'category-disabled')
    } else if (cancelledPending.length > 0) {
      this._scheduleNextProcess(0)
    }
  }

  public applyCoachMode(_mode: 'minimal' | 'balanced' | 'training'): void {
    this._applyPacingThreshold('coach-mode-changed')
  }

  public applyPacingSettings(): void {
    this._applyPacingThreshold('pacing-settings-changed')
    this._scheduleNextProcess(0)
  }

  private _applyPacingThreshold(reason: string): void {
    const minimumPriority = this._minimumPriorityThreshold()
    const belowThreshold = (cue: CoachCue) => cue.priority < minimumPriority
    const cancelledPending = this._pendingCues.filter(belowThreshold)
    this._pendingCues = this._pendingCues.filter((cue) => !belowThreshold(cue))

    for (const cue of cancelledPending) {
      cue.status = 'cancelled'
      cue.cancellationReason = reason
      this._recordCue(cue)
      this._notifyCueCancelled(cue.id, reason)
    }

    if (this._currentSpeakingCue && belowThreshold(this._currentSpeakingCue)) {
      this.cancelCue(this._currentSpeakingCue.id, reason)
    } else if (cancelledPending.length > 0) {
      this._scheduleNextProcess(0)
    }
  }

  public showLastCueAgain(): boolean {
    if (
      !this._lastDeliveredCue ||
      !['active', 'paused'].includes(this._context.state.session.state)
    ) {
      return false
    }

    this._context.state.setCue({ ...this._lastDeliveredCue, status: 'spoken' })
    if (this._repeatedCueTimer) {
      clearTimeout(this._repeatedCueTimer)
    }
    const cueId = this._lastDeliveredCue.id
    this._repeatedCueTimer = setTimeout(() => {
      this._repeatedCueTimer = null
      if (this._context.state.cue?.id === cueId) {
        this._context.state.setCue(null)
      }
    }, 3000)
    return true
  }

  public getCue(cueId: string): Readonly<CoachCue> | null {
    return this._cues.get(cueId) ?? this._cueHistory.get(cueId) ?? null
  }

  private _cancelActivePlayback(reason: string): void {
    this._speechExecutor.cancel()
    this._playbackGeneration++

    const currentCue = this._currentSpeakingCue
    this._currentSpeakingCue = null
    if (!currentCue) {
      return
    }

    const visibleCue = this._context.state.cue
    const subtitleWasDelivered = visibleCue?.id === currentCue.id
    currentCue.status = subtitleWasDelivered ? 'spoken' : 'cancelled'
    currentCue.cancellationReason = subtitleWasDelivered ? null : reason

    if (subtitleWasDelivered) {
      const deliveredCue: CoachCuePublicDto = { ...visibleCue, status: 'spoken' }
      this._lastDeliveredCue = deliveredCue
      this._recordCue(currentCue, deliveredCue)
      setTimeout(() => {
        if (this._context.state.cue?.id === currentCue.id) {
          this._context.state.setCue(null)
        }
      }, 2000)
    } else {
      this._recordCue(currentCue)
      this._notifyCueCancelled(currentCue.id, reason)
    }
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
      if (cue.expiresAt <= now || now - cue.createdAt > this._maxQueueDelayMs) {
        cue.status = 'expired'
        cue.cancellationReason = cue.expiresAt <= now ? 'expired' : 'queue-delay-exceeded'
        this._recordCue(cue)
        this._notifyCueCancelled(cue.id, cue.cancellationReason)
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
    const minimumCueIntervalMs = this._minimumCueIntervalMs()
    if (elapsedSinceLastSpoken < minimumCueIntervalMs) {
      const waitTime = minimumCueIntervalMs - elapsedSinceLastSpoken
      this._scheduleNextProcess(waitTime)
      return
    }

    if (this._pendingCues.length === 0) {
      return
    }

    const nextCue = this._pendingCues.shift()!
    this._currentSpeakingCue = nextCue
    const playbackGeneration = ++this._playbackGeneration
    this._lastSpokenTime = now

    const publicDto = this._toPublicDto(nextCue, 'speaking')

    const enabledCaps = new Set(
      this._context.state.capability?.enabledFeatureIds ?? [
        'coach.output.subtitle',
        'coach.output.tts'
      ]
    )
    const outputs = this._context.settings.outputMode
    const muted = this._context.settings.muted

    const shouldShowSubtitle =
      (outputs.includes('subtitle') || muted) && enabledCaps.has('coach.output.subtitle')
    const shouldSpeak =
      this._context.settings.speechEnabled &&
      !muted &&
      outputs.includes('speech') &&
      enabledCaps.has('coach.output.tts')
    const shouldPlaySound =
      !muted && outputs.includes('sound') && enabledCaps.has('coach.output.sound')

    // 关键修正：当所有输出渠道均不可用（例如 Gate B 关闭或输出模式禁用）时，
    // 直接标记为 suppressed/output-gated 并快速进入下一个，严禁假装 spoken 或虚假发送 cue-spoken 事件！
    if (!shouldShowSubtitle && !shouldSpeak && !shouldPlaySound) {
      nextCue.status = 'cancelled'
      nextCue.cancellationReason = 'suppressed/output-gated'
      this._recordCue(nextCue)
      this._currentSpeakingCue = null
      this._scheduleNextProcess(100)
      return
    }

    if (shouldShowSubtitle) {
      this._context.state.setCue(publicDto)
    }

    let soundSucceeded = false
    if (shouldPlaySound && this._soundExecutor) {
      try {
        soundSucceeded = await this._soundExecutor.playSound(
          nextCue.category,
          this._context.settings.soundVolume ?? 0.8
        )
      } catch (err) {
        this._context.logger.warn(formatSanitizedErrorLog('Sound playback error', err))
      }
    }

    if (!this._isCurrentPlayback(nextCue, playbackGeneration)) {
      return
    }

    let ttsSucceeded = false
    try {
      if (shouldSpeak) {
        this._context.state.setSpeechState('speaking', nextCue.id)
        ttsSucceeded = await this._speechExecutor.speak(nextCue.spokenText, {
          volume: this._context.settings.speechVolume,
          rate: this._context.settings.speechRate,
          voiceId: this._context.settings.speechVoiceId,
          outputDeviceId: this._context.settings.speechOutputDeviceId
        })
      }
    } catch (err) {
      this._context.logger.warn(formatSanitizedErrorLog('Speech synthesis error', err))
    } finally {
      if (this._isCurrentPlayback(nextCue, playbackGeneration)) {
        this._setReadySpeechState()
      }
    }

    if (!this._isCurrentPlayback(nextCue, playbackGeneration)) {
      return
    }

    const requestedAudio = shouldPlaySound || shouldSpeak
    const audioDelivered = soundSucceeded || ttsSucceeded
    const isFallbackSubtitle =
      requestedAudio &&
      !audioDelivered &&
      !shouldShowSubtitle &&
      enabledCaps.has('coach.output.subtitle')

    if (isFallbackSubtitle) {
      this._context.state.setCue(publicDto)
    }

    if ((!shouldSpeak && shouldShowSubtitle) || isFallbackSubtitle) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    if (this._currentSpeakingCue === nextCue) {
      this._currentSpeakingCue = null
      const isDelivered = audioDelivered || shouldShowSubtitle || isFallbackSubtitle
      nextCue.status = isDelivered ? 'spoken' : 'cancelled'
      if (isDelivered) {
        this._lastDeliveredCue = { ...publicDto, status: 'spoken', cancellationReason: null }
        this._recordCue(nextCue, this._lastDeliveredCue)
      } else {
        nextCue.cancellationReason = 'output-delivery-failed'
        this._recordCue(nextCue)
        this._notifyCueCancelled(nextCue.id, nextCue.cancellationReason)
      }

      // 关键修正：只有 TTS 真实执行完成时才发送 cue-spoken 事件
      if (ttsSucceeded) {
        this._notifyCueSpoken(nextCue.id)
      }

      if (shouldShowSubtitle || isFallbackSubtitle) {
        setTimeout(() => {
          if (this._context.state.cue?.id === nextCue.id) {
            this._context.state.setCue(null)
          }
        }, 2000)
      }

      const remainingInterval = Math.max(
        0,
        this._minimumCueIntervalMs() - (Date.now() - this._lastSpokenTime)
      )
      this._scheduleNextProcess(remainingInterval)
    }
  }

  private _isCurrentPlayback(cue: CoachCue, generation: number): boolean {
    return this._currentSpeakingCue === cue && this._playbackGeneration === generation
  }

  private _toPublicDto(
    cue: CoachCue,
    status: CoachCuePublicDto['status'] = cue.status
  ): CoachCuePublicDto {
    return {
      id: cue.id,
      sessionId: cue.sessionId,
      category: cue.category,
      priority: cue.priority,
      observationText: cue.observationText,
      impactText: cue.impactText,
      options: cue.options.map((option) => ({
        id: option.id,
        label: option.label,
        role: option.role
      })),
      spokenText: cue.spokenText,
      createdAt: cue.createdAt,
      expiresAt: cue.expiresAt,
      status,
      cancellationReason: cue.cancellationReason
    }
  }

  private _recordCue(cue: CoachCue, dto: CoachCuePublicDto = this._toPublicDto(cue)): void {
    this._context.state.addRecentCue(dto)
    this.onCueAudit?.(cue)
  }

  private _minimumPriorityThreshold(): number {
    const mode = this._context.settings.coachMode
    const modeThreshold = mode === 'minimal' ? 70 : mode === 'balanced' ? 40 : 20
    const density = this._context.settings.cueDensity ?? 'standard'
    const densityAdjustment = density === 'low' ? 10 : density === 'high' ? -10 : 0
    return Math.max(10, Math.min(90, modeThreshold + densityAdjustment))
  }

  private _minimumCueIntervalMs(): number {
    const seconds = this._context.settings.minimumCueIntervalSeconds ?? 2.5
    return Math.round(Math.max(2, Math.min(15, seconds)) * 1000)
  }

  private _setReadySpeechState(): void {
    this._context.state.setSpeechState(
      this._context.settings.muted
        ? 'muted'
        : this._speechExecutor.isAvailable === false
          ? 'unavailable'
          : 'idle'
    )
  }

  private _notifyCueSpoken(cueId: string): void {
    this._context.ipc.sendEvent(this._context.namespace, 'cue-spoken', { cueId })
  }

  private _notifyCueCancelled(cueId: string, reason: string): void {
    this._context.ipc.sendEvent(this._context.namespace, 'cue-cancelled', { cueId, reason })
  }
}
