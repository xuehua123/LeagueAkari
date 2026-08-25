import { CoachCue, CoachCuePublicDto } from '@shared/types/live-coach'

import type { LiveCoachMainContext } from './context'
import { LocalSpeechExecutor } from './local-speech-executor'

export class CueSchedulerController {
  private _pendingCues: CoachCue[] = []
  private _currentSpeakingCue: CoachCue | null = null
  private _lastSpokenTime = 0
  private readonly _minSpokenIntervalMs = 5000
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

    for (const cue of cues) {
      // Check if category is enabled in settings
      if (this._context.settings.cueCategories[cue.category] === false) {
        continue
      }

      // Check if cue is not expired
      if (cue.expiresAt <= now) {
        continue
      }

      // Insert and sort by priority descending
      this._pendingCues.push(cue)
    }

    this._pendingCues.sort((a, b) => b.priority - a.priority)

    // Keep queue small (max 5 pending cues)
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
    }, 400)
  }

  private async _processQueue(): Promise<void> {
    const now = Date.now()

    // 1. Purge expired cues
    const unexpired: CoachCue[] = []
    for (const cue of this._pendingCues) {
      if (cue.expiresAt <= now) {
        this._notifyCueCancelled(cue.id, 'expired')
      } else {
        unexpired.push(cue)
      }
    }
    this._pendingCues = unexpired

    // 2. Check if currently speaking or in cooldown
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
      // Subtitle only simulation duration (e.g. 3s)
      await new Promise((r) => setTimeout(r, 3000))
    }

    if (this._currentSpeakingCue === nextCue) {
      this._currentSpeakingCue = null
      this._context.state.setSpeechState('idle')
      this._notifyCueSpoken(nextCue.id)

      // Retain subtitle on screen for a moment before clearing
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
