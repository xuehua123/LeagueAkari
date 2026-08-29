import {
  CoachFeedbackDocument,
  CoachFeedbackRecord,
  SubmitCoachFeedback,
  coachFeedbackDocumentSchema
} from '@shared/types/live-coach'
import { randomUUID } from 'node:crypto'

import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import type { LiveCoachMainContext } from './context'
import type { CueSchedulerController } from './cue-scheduler-controller'

const FEEDBACK_FILENAME = 'cue-feedback.json'
const FEEDBACK_RETENTION_MS = 180 * 24 * 60 * 60 * 1000

export class CueFeedbackController {
  private readonly _feedback = new Map<string, CoachFeedbackRecord>()
  private _writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _cueScheduler: CueSchedulerController
  ) {}

  public async init(): Promise<void> {
    if (!(await this._context.settingService.jsonConfigFileExists(FEEDBACK_FILENAME))) {
      return
    }

    try {
      const raw = await this._context.settingService.readFromJsonConfigFile(FEEDBACK_FILENAME)
      const document = coachFeedbackDocumentSchema.parse(raw)
      const cutoff = Date.now() - FEEDBACK_RETENTION_MS

      for (const feedback of document.feedback) {
        if (feedback.createdAt >= cutoff) {
          this._feedback.set(feedback.id, feedback)
        }
      }

      if (this._feedback.size !== document.feedback.length) {
        await this._persist()
      }
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Unable to load persisted cue feedback', error)
      )
    }
  }

  public async submit(params: SubmitCoachFeedback): Promise<CoachFeedbackRecord> {
    const cue = this._cueScheduler.getCue(params.cueId)
    if (!cue) {
      throw new Error(`Cue ${params.cueId} is no longer available for feedback`)
    }

    const duplicate = Array.from(this._feedback.values()).find(
      (feedback) =>
        feedback.cueId === params.cueId &&
        feedback.type === params.type &&
        feedback.status === 'active'
    )
    if (duplicate) {
      return duplicate
    }

    const feedback: CoachFeedbackRecord = {
      id: `feedback_${randomUUID()}`,
      cueId: cue.id,
      sessionId: cue.sessionId,
      ruleId: cue.ruleId,
      ruleVersion: cue.ruleVersion,
      evidenceIds: [...cue.evidenceIds],
      type: params.type,
      comment: params.comment?.trim() || null,
      status: 'active',
      createdAt: Date.now(),
      withdrawnAt: null
    }

    this._feedback.set(feedback.id, feedback)
    try {
      await this._persist()
    } catch (error) {
      this._feedback.delete(feedback.id)
      throw error
    }
    return feedback
  }

  public list(filters: { cueId?: string; sessionId?: string } = {}): CoachFeedbackRecord[] {
    return Array.from(this._feedback.values())
      .filter(
        (feedback) =>
          (!filters.cueId || feedback.cueId === filters.cueId) &&
          (!filters.sessionId || feedback.sessionId === filters.sessionId)
      )
      .toSorted((a, b) => b.createdAt - a.createdAt)
  }

  public async withdraw(feedbackId: string): Promise<CoachFeedbackRecord | null> {
    const feedback = this._feedback.get(feedbackId)
    if (!feedback) {
      return null
    }
    if (feedback.status === 'withdrawn') {
      return feedback
    }

    const withdrawn: CoachFeedbackRecord = {
      ...feedback,
      status: 'withdrawn',
      withdrawnAt: Date.now()
    }
    this._feedback.set(feedbackId, withdrawn)
    try {
      await this._persist()
    } catch (error) {
      this._feedback.set(feedbackId, feedback)
      throw error
    }
    return withdrawn
  }

  public async delete(feedbackId: string): Promise<boolean> {
    const feedback = this._feedback.get(feedbackId)
    if (!feedback) return false

    this._feedback.delete(feedbackId)
    try {
      await this._persist()
      return true
    } catch (error) {
      this._feedback.set(feedbackId, feedback)
      throw error
    }
  }

  public async clear(): Promise<number> {
    const deletedCount = this._feedback.size
    await this._writeChain.catch(() => undefined)
    await this._context.settingService.deleteJsonConfigFile(FEEDBACK_FILENAME)
    this._feedback.clear()
    return deletedCount
  }

  private _persist(): Promise<void> {
    const snapshot: CoachFeedbackDocument = {
      schemaVersion: 1,
      feedback: Array.from(this._feedback.values()).toSorted((a, b) => a.createdAt - b.createdAt)
    }

    const write = this._writeChain.then(() =>
      this._context.settingService.writeToJsonConfigFile(FEEDBACK_FILENAME, snapshot)
    )
    this._writeChain = write.catch((error) => {
      this._context.logger.warn(formatSanitizedErrorLog('Unable to persist cue feedback', error))
    })
    return write
  }
}
