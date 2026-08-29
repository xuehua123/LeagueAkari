import {
  type FailReplayAnalysisTaskInput,
  REPLAY_HISTORY_MAX_ENTRIES,
  REPLAY_HISTORY_SCHEMA_VERSION,
  type ReplayAnalysisHistoryDocument,
  type ReplayAnalysisHistoryEntry,
  type ReplayAnalysisStoredResult,
  type StartReplayAnalysisTaskInput,
  type UpdateReplayAnalysisProgressInput,
  failReplayAnalysisTaskInputSchema,
  replayAnalysisHistoryDocumentSchema,
  replayAnalysisHistoryEntrySchema,
  replayAnalysisStoredResultSchema,
  startReplayAnalysisTaskInputSchema,
  updateReplayAnalysisProgressInputSchema
} from '@shared/types/live-coach'
import { randomUUID } from 'node:crypto'

import { ReplayHistoryFileExecutor } from './file-executor'
import { createReplayAnalysisFingerprint } from './projection'

export interface ReplayHistoryLogger {
  info(...args: unknown[]): unknown
  warn(...args: unknown[]): unknown
  error(...args: unknown[]): unknown
}

export interface ReplayHistoryControllerOptions {
  rootDirectory: string
  logger?: ReplayHistoryLogger
  now?: () => Date
  idFactory?: () => string
  fileExecutor?: ReplayHistoryFileExecutor
}

export interface ReplayAnalysisStartResult {
  entry: ReplayAnalysisHistoryEntry
  duplicate: ReplayAnalysisHistoryEntry | null
}

export interface ReplayAnalysisDeleteResult {
  deleted: boolean
  deletedBytes: number
}

export interface ReplayAnalysisClearResult {
  deletedEntries: number
  deletedBytes: number
}

export class ReplayHistoryControllerError extends Error {
  constructor(
    public readonly code:
      | 'not-initialized'
      | 'disposed'
      | 'not-found'
      | 'invalid-state'
      | 'history-limit'
      | 'invalid-retry'
      | 'fingerprint-mismatch'
      | 'result-mismatch',
    message: string
  ) {
    super(message)
    this.name = 'ReplayHistoryControllerError'
  }
}

export class ReplayHistoryController {
  private readonly _fileExecutor: ReplayHistoryFileExecutor
  private readonly _logger?: ReplayHistoryLogger
  private readonly _now: () => Date
  private readonly _idFactory: () => string
  private _document: ReplayAnalysisHistoryDocument = {
    schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION,
    generation: 0,
    entries: []
  }
  private _mutationQueue: Promise<void> = Promise.resolve()
  private _initialized = false
  private _disposed = false

  constructor(options: ReplayHistoryControllerOptions) {
    this._fileExecutor =
      options.fileExecutor ?? new ReplayHistoryFileExecutor(options.rootDirectory)
    this._logger = options.logger
    this._now = options.now ?? (() => new Date())
    this._idFactory = options.idFactory ?? randomUUID
  }

  async init(): Promise<void> {
    if (this._initialized) return
    if (this._disposed) {
      throw new ReplayHistoryControllerError('disposed', 'Replay history controller is disposed')
    }

    await this._fileExecutor.init()
    const loaded = await this._fileExecutor.readIndex()
    this._document = loaded.document ?? {
      schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION,
      generation: 0,
      entries: []
    }

    if (loaded.recoveredFromBackup) {
      this._logger?.warn('录像分析历史索引已从备份恢复')
    } else if (loaded.discardedInvalidIndex) {
      this._logger?.warn('录像分析历史索引损坏，已隔离并使用空索引')
    }

    let changed = false
    const now = this._now().toISOString()
    const recoveredEntries: ReplayAnalysisHistoryEntry[] = []
    for (const entry of this._document.entries) {
      if (entry.status === 'preparing' || entry.status === 'analyzing') {
        recoveredEntries.push({
          ...entry,
          status: 'interrupted',
          stage: 'interrupted',
          updatedAt: now,
          completedAt: null,
          resultId: null,
          failureCode: 'app-interrupted'
        })
        changed = true
        continue
      }

      if (entry.status === 'completed' && entry.resultId) {
        try {
          const result = await this._fileExecutor.readResult(entry.resultId)
          if (
            !result ||
            result.historyId !== entry.id ||
            result.analysisFingerprint !== entry.analysisFingerprint
          ) {
            throw new Error('Stored result does not match its history entry')
          }
        } catch {
          recoveredEntries.push({
            ...entry,
            status: 'failed',
            stage: 'failed',
            updatedAt: now,
            completedAt: null,
            resultId: null,
            failureCode: 'stored-result-unavailable'
          })
          await this._fileExecutor.deleteResult(entry.resultId)
          this._logger?.warn('录像分析结果无效，历史条目已标记为不可用', entry.id)
          changed = true
          continue
        }
      }
      recoveredEntries.push(entry)
    }

    if (changed) {
      await this._persistEntries(recoveredEntries)
    }

    const referencedResultIds = new Set(
      this._document.entries.flatMap((entry) => (entry.resultId ? [entry.resultId] : []))
    )
    await this._fileExecutor.cleanupOrphanResults(referencedResultIds)
    await this._fileExecutor.cleanupTemporaryFiles()
    this._initialized = true
  }

  async dispose(): Promise<void> {
    if (this._disposed) return
    await this._mutationQueue
    this._disposed = true
  }

  list(): ReplayAnalysisHistoryEntry[] {
    this._assertAvailable()
    return [...this._document.entries]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(cloneEntry)
  }

  get(id: string): ReplayAnalysisHistoryEntry | null {
    this._assertAvailable()
    const entry = this._document.entries.find((candidate) => candidate.id === id)
    return entry ? cloneEntry(entry) : null
  }

  async getResult(id: string): Promise<ReplayAnalysisStoredResult | null> {
    this._assertAvailable()
    const entry = this._document.entries.find((candidate) => candidate.id === id)
    if (!entry?.resultId) return null
    const result = await this._fileExecutor.readResult(entry.resultId)
    return result ? structuredClone(result) : null
  }

  findDuplicate(analysisFingerprint: string): ReplayAnalysisHistoryEntry | null {
    this._assertAvailable()
    const duplicate = this._document.entries.find(
      (entry) => entry.status === 'completed' && entry.analysisFingerprint === analysisFingerprint
    )
    return duplicate ? cloneEntry(duplicate) : null
  }

  async startTask(input: StartReplayAnalysisTaskInput): Promise<ReplayAnalysisStartResult> {
    return await this._enqueue(async () => {
      const validated = startReplayAnalysisTaskInputSchema.parse(input)
      const expectedFingerprint = createReplayAnalysisFingerprint({
        artifactSha256: validated.artifactSha256,
        sidecarSha256: validated.sidecarSha256,
        metadata: validated.metadata,
        roi: validated.roi,
        manifest: validated.manifest
      })
      if (validated.analysisFingerprint !== expectedFingerprint) {
        throw new ReplayHistoryControllerError(
          'fingerprint-mismatch',
          'Replay analysis fingerprint does not match its inputs'
        )
      }
      const duplicate = this._document.entries.find(
        (entry) =>
          entry.status === 'completed' &&
          entry.analysisFingerprint === validated.analysisFingerprint
      )
      if (duplicate) {
        const cloned = cloneEntry(duplicate)
        return { entry: cloned, duplicate: cloned }
      }
      if (this._document.entries.length >= REPLAY_HISTORY_MAX_ENTRIES) {
        throw new ReplayHistoryControllerError(
          'history-limit',
          `Replay history is limited to ${REPLAY_HISTORY_MAX_ENTRIES} entries`
        )
      }
      if (
        validated.retryOf &&
        !this._document.entries.some((entry) => entry.id === validated.retryOf)
      ) {
        throw new ReplayHistoryControllerError(
          'invalid-retry',
          'The replay history entry selected for retry does not exist'
        )
      }

      const timestamp = this._now().toISOString()
      const entry: ReplayAnalysisHistoryEntry = {
        schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION,
        id: this._idFactory(),
        sourceKind: validated.sourceKind,
        status: 'preparing',
        stage: 'queued',
        progress: 0,
        artifactSha256: validated.artifactSha256,
        sidecarSha256: validated.sidecarSha256,
        analysisFingerprint: validated.analysisFingerprint,
        metadata: validated.metadata,
        roi: validated.roi,
        manifest: validated.manifest,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        resultId: null,
        retryOf: validated.retryOf ?? null,
        failureCode: null,
        durationSeconds: null,
        frameCount: null,
        analysisFps: null,
        totalCues: null
      }
      const validatedEntry = replayAnalysisHistoryEntrySchema.parse(entry)
      await this._persistEntries([...this._document.entries, validatedEntry])
      return { entry: cloneEntry(validatedEntry), duplicate: null }
    })
  }

  async updateProgress(
    id: string,
    input: UpdateReplayAnalysisProgressInput
  ): Promise<ReplayAnalysisHistoryEntry> {
    return await this._enqueue(async () => {
      const validated = updateReplayAnalysisProgressInputSchema.parse(input)
      const entry = this._requireEntry(id)
      this._assertActive(entry)
      const allowedStages = [
        'queued',
        'hashing',
        'probing',
        'extracting',
        'analyzing',
        'finalizing'
      ]
      const currentStageIndex = allowedStages.indexOf(entry.stage)
      const nextStageIndex = allowedStages.indexOf(validated.stage)
      if (
        nextStageIndex < 0 ||
        nextStageIndex < currentStageIndex ||
        validated.progress < entry.progress
      ) {
        throw new ReplayHistoryControllerError(
          'invalid-state',
          `Replay progress cannot move from ${entry.stage}/${entry.progress} to ${validated.stage}/${validated.progress}`
        )
      }
      const updated: ReplayAnalysisHistoryEntry = {
        ...entry,
        status: validated.stage === 'analyzing' ? 'analyzing' : entry.status,
        stage: validated.stage,
        progress: validated.progress,
        updatedAt: this._now().toISOString()
      }
      await this._replaceAndPersist(updated)
      return cloneEntry(updated)
    })
  }

  async completeTask(
    id: string,
    result: ReplayAnalysisStoredResult
  ): Promise<ReplayAnalysisHistoryEntry> {
    return await this._enqueue(async () => {
      const validatedResult = replayAnalysisStoredResultSchema.parse(result)
      const entry = this._requireEntry(id)
      this._assertActive(entry)
      if (
        validatedResult.historyId !== entry.id ||
        validatedResult.analysisFingerprint !== entry.analysisFingerprint ||
        validatedResult.summary.artifactSha256 !== entry.artifactSha256 ||
        validatedResult.summary.sidecarSha256 !== entry.sidecarSha256 ||
        validatedResult.summary.sourceKind !== entry.sourceKind
      ) {
        throw new ReplayHistoryControllerError(
          'result-mismatch',
          'Replay result does not match its history task'
        )
      }

      await this._fileExecutor.writeResult(validatedResult)
      const timestamp = this._now().toISOString()
      const updated: ReplayAnalysisHistoryEntry = {
        ...entry,
        status: 'completed',
        stage: 'completed',
        progress: 100,
        updatedAt: timestamp,
        completedAt: timestamp,
        resultId: entry.id,
        failureCode: null,
        durationSeconds: validatedResult.summary.durationSeconds,
        frameCount: validatedResult.summary.frameCount,
        analysisFps: validatedResult.summary.analysisFps,
        totalCues: validatedResult.summary.totalCues
      }
      await this._replaceAndPersist(updated)
      return cloneEntry(updated)
    })
  }

  async failTask(
    id: string,
    input: FailReplayAnalysisTaskInput
  ): Promise<ReplayAnalysisHistoryEntry> {
    return await this._enqueue(async () => {
      const validated = failReplayAnalysisTaskInputSchema.parse(input)
      const entry = this._requireEntry(id)
      this._assertActive(entry)
      const updated: ReplayAnalysisHistoryEntry = {
        ...entry,
        status: 'failed',
        stage: validated.stage ?? 'failed',
        updatedAt: this._now().toISOString(),
        completedAt: null,
        resultId: null,
        failureCode: validated.failureCode
      }
      await this._replaceAndPersist(updated)
      return cloneEntry(updated)
    })
  }

  async cancelTask(id: string): Promise<ReplayAnalysisHistoryEntry> {
    return await this._enqueue(async () => {
      const entry = this._requireEntry(id)
      this._assertActive(entry)
      const updated: ReplayAnalysisHistoryEntry = {
        ...entry,
        status: 'cancelled',
        stage: 'cancelled',
        updatedAt: this._now().toISOString(),
        completedAt: null,
        resultId: null,
        failureCode: null
      }
      await this._replaceAndPersist(updated)
      return cloneEntry(updated)
    })
  }

  async delete(id: string): Promise<ReplayAnalysisDeleteResult> {
    return await this._enqueue(async () => {
      const entry = this._document.entries.find((candidate) => candidate.id === id)
      if (!entry) return { deleted: false, deletedBytes: 0 }
      if (entry.status === 'preparing' || entry.status === 'analyzing') {
        throw new ReplayHistoryControllerError(
          'invalid-state',
          'An active replay task must be cancelled before deletion'
        )
      }
      const deletedBytes = entry.resultId
        ? await this._fileExecutor.deleteResult(entry.resultId)
        : 0
      // Delete the result first so an I/O failure leaves the indexed entry visible and the user
      // can retry. If the later index commit fails, the entry also remains retryable; a restart
      // will safely downgrade its now-missing result before another deletion attempt.
      await this._persistEntries(
        this._document.entries.filter((candidate) => candidate.id !== entry.id)
      )
      return { deleted: true, deletedBytes }
    })
  }

  async clear(): Promise<ReplayAnalysisClearResult> {
    return await this._enqueue(async () => {
      if (
        this._document.entries.some(
          (entry) => entry.status === 'preparing' || entry.status === 'analyzing'
        )
      ) {
        throw new ReplayHistoryControllerError(
          'invalid-state',
          'Active replay tasks must be cancelled before clearing replay history'
        )
      }
      const deletedEntries = this._document.entries.length
      const nextDocument: ReplayAnalysisHistoryDocument = {
        schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION,
        generation: this._document.generation + 1,
        entries: []
      }
      const deletedBytes = await this._fileExecutor.removeAllInternalData()
      await this._fileExecutor.writeIndex(nextDocument)
      this._document = nextDocument
      return { deletedEntries, deletedBytes }
    })
  }

  private async _replaceAndPersist(updated: ReplayAnalysisHistoryEntry): Promise<void> {
    await this._persistEntries(
      this._document.entries.map((entry) => (entry.id === updated.id ? updated : entry))
    )
  }

  private async _persistEntries(entries: ReplayAnalysisHistoryEntry[]): Promise<void> {
    const nextDocument = replayAnalysisHistoryDocumentSchema.parse({
      schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION,
      generation: this._document.generation + 1,
      entries
    })
    await this._fileExecutor.writeIndex(nextDocument)
    this._document = nextDocument
  }

  private _requireEntry(id: string): ReplayAnalysisHistoryEntry {
    const entry = this._document.entries.find((candidate) => candidate.id === id)
    if (!entry) {
      throw new ReplayHistoryControllerError('not-found', 'Replay history entry does not exist')
    }
    return entry
  }

  private _assertActive(entry: ReplayAnalysisHistoryEntry): void {
    if (entry.status !== 'preparing' && entry.status !== 'analyzing') {
      throw new ReplayHistoryControllerError(
        'invalid-state',
        `Replay history entry is already ${entry.status}`
      )
    }
  }

  private _assertAvailable(): void {
    if (this._disposed) {
      throw new ReplayHistoryControllerError('disposed', 'Replay history controller is disposed')
    }
    if (!this._initialized) {
      throw new ReplayHistoryControllerError(
        'not-initialized',
        'Replay history controller is not initialized'
      )
    }
  }

  private async _enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this._assertAvailable()
    const run = this._mutationQueue.then(operation, operation)
    this._mutationQueue = run.then(
      () => undefined,
      () => undefined
    )
    return await run
  }
}

function cloneEntry(entry: ReplayAnalysisHistoryEntry): ReplayAnalysisHistoryEntry {
  return structuredClone(entry)
}
