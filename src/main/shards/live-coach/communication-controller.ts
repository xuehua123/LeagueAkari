import {
  CoachCommunicationAuditRecord,
  CoachCommunicationKind,
  CoachCuePublicDto
} from '@shared/types/live-coach'
import { randomUUID } from 'node:crypto'

import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import type { LiveCoachMainContext } from './context'

function getCommunicationKind(optionId: string): CoachCommunicationKind | null {
  const match = /^opt_(?:ping|chat)_(missing|resource|retreat|push|group|danger)$/i.exec(optionId)
  return (match?.[1]?.toLowerCase() as CoachCommunicationKind | undefined) ?? null
}

function findCue(state: LiveCoachMainContext['state'], cueId: string): CoachCuePublicDto | null {
  if (state.cue?.id === cueId) return state.cue
  return state.recentCues.find((cue) => cue.id === cueId) ?? null
}

export class CommunicationController {
  private _lastConfirmedAt = 0

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _writeClipboard: (text: string) => void
  ) {}

  public reset(): void {
    this._lastConfirmedAt = 0
  }

  public confirmCueOption(
    cueId: string,
    optionId: string,
    now: number = Date.now()
  ): CoachCommunicationAuditRecord {
    const sessionId = this._context.state.session.id || 'no-session'
    const cue = findCue(this._context.state, cueId)
    if (!cue || cue.expiresAt <= now || cue.status === 'cancelled' || cue.status === 'expired') {
      return this._audit({
        sessionId,
        cueId,
        optionId,
        kind: getCommunicationKind(optionId) ?? 'danger',
        action: 'blocked',
        channel: 'chat',
        message: '',
        reason: 'cue-unavailable-or-expired',
        createdAt: now
      })
    }

    const option = cue.options.find((candidate) => candidate.id === optionId)
    const kind = option ? getCommunicationKind(option.id) : null
    if (!option || !kind) {
      return this._audit({
        sessionId,
        cueId,
        optionId,
        kind: kind ?? 'danger',
        action: 'blocked',
        channel: 'chat',
        message: '',
        reason: 'option-is-not-communication-suggestion',
        createdAt: now
      })
    }

    const channel = option.id.startsWith('opt_ping_') ? 'ping' : 'chat'
    if (this._context.settings.communicationCategories[kind] === false) {
      return this._audit({
        sessionId,
        cueId,
        optionId,
        kind,
        action: 'blocked',
        channel,
        message: '',
        reason: 'communication-category-disabled',
        createdAt: now
      })
    }
    const requiredCapability =
      channel === 'ping' ? 'coach.communication.ping' : 'coach.communication.chat'
    if (!this._context.state.capability.enabledFeatureIds.includes(requiredCapability)) {
      return this._audit({
        sessionId,
        cueId,
        optionId,
        kind,
        action: 'blocked',
        channel,
        message: '',
        reason: 'communication-capability-unavailable',
        createdAt: now
      })
    }

    const cooldownMs = this._context.settings.communicationCooldownSeconds * 1000
    if (this._lastConfirmedAt > 0 && now - this._lastConfirmedAt < cooldownMs) {
      return this._audit({
        sessionId,
        cueId,
        optionId,
        kind,
        action: 'blocked',
        channel,
        message: '',
        reason: 'rate-limited',
        createdAt: now
      })
    }

    const message = this._context.settings.communicationTemplates[kind]
    try {
      this._writeClipboard(message)
      this._lastConfirmedAt = now
      return this._audit({
        sessionId,
        cueId,
        optionId,
        kind,
        action: 'copied',
        channel,
        message,
        reason: 'approved-in-game-send-interface-unavailable',
        createdAt: now
      })
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Unable to copy confirmed communication suggestion', error)
      )
      return this._audit({
        sessionId,
        cueId,
        optionId,
        kind,
        action: 'blocked',
        channel,
        message,
        reason: 'clipboard-unavailable',
        createdAt: now
      })
    }
  }

  public confirmLatest(now: number = Date.now()): CoachCommunicationAuditRecord | null {
    const candidates = [
      ...(this._context.state.cue ? [this._context.state.cue] : []),
      ...this._context.state.recentCues.toReversed()
    ]
    for (const cue of candidates) {
      if (
        cue.expiresAt <= now ||
        cue.status === 'cancelled' ||
        cue.status === 'expired' ||
        cue.status === 'suppressed'
      ) {
        continue
      }
      const option = cue.options.find((candidate) => getCommunicationKind(candidate.id) !== null)
      if (option) return this.confirmCueOption(cue.id, option.id, now)
    }
    return null
  }

  private _audit(record: Omit<CoachCommunicationAuditRecord, 'id'>): CoachCommunicationAuditRecord {
    const completeRecord: CoachCommunicationAuditRecord = {
      id: `communication_${randomUUID()}`,
      ...record
    }
    this._context.state.addCommunicationAudit(completeRecord)
    return completeRecord
  }
}
