import {
  type ReplayAnalysisHistoryDocument,
  type ReplayAnalysisStoredResult,
  replayAnalysisHistoryDocumentSchema,
  replayAnalysisStoredResultSchema
} from '@shared/types/live-coach'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ZodType } from 'zod'

export const REPLAY_HISTORY_RELATIVE_DIRECTORY = path.join('live-coach', 'replay-history-v1')
export const REPLAY_HISTORY_MAX_INDEX_BYTES = 1 * 1024 * 1024
export const REPLAY_HISTORY_MAX_RESULT_BYTES = 8 * 1024 * 1024
export const REPLAY_HISTORY_MAX_TOTAL_BYTES = 128 * 1024 * 1024

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class ReplayHistoryStorageError extends Error {
  constructor(
    public readonly code:
      | 'invalid-id'
      | 'invalid-data'
      | 'index-too-large'
      | 'result-too-large'
      | 'quota-exceeded'
      | 'result-exists'
      | 'not-initialized',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ReplayHistoryStorageError'
  }
}

export interface ReplayHistoryIndexLoadResult {
  document: ReplayAnalysisHistoryDocument | null
  recoveredFromBackup: boolean
  discardedInvalidIndex: boolean
}

export function resolveReplayHistoryDirectory(userDataDirectory: string): string {
  return path.join(userDataDirectory, REPLAY_HISTORY_RELATIVE_DIRECTORY)
}

export class ReplayHistoryFileExecutor {
  private readonly _indexPath: string
  private readonly _backupIndexPath: string
  private readonly _resultsDirectory: string
  private readonly _temporaryDirectory: string
  private _initialized = false

  constructor(public readonly rootDirectory: string) {
    this._indexPath = path.join(rootDirectory, 'index.json')
    this._backupIndexPath = path.join(rootDirectory, 'index.bak')
    this._resultsDirectory = path.join(rootDirectory, 'results')
    this._temporaryDirectory = path.join(rootDirectory, 'tmp')
  }

  async init(): Promise<void> {
    await fs.promises.mkdir(this._resultsDirectory, { recursive: true })
    await fs.promises.mkdir(this._temporaryDirectory, { recursive: true })
    this._initialized = true
  }

  async readIndex(): Promise<ReplayHistoryIndexLoadResult> {
    this._assertInitialized()
    const primary = await this._tryReadJson(
      this._indexPath,
      REPLAY_HISTORY_MAX_INDEX_BYTES,
      replayAnalysisHistoryDocumentSchema
    )
    const backup = await this._tryReadJson(
      this._backupIndexPath,
      REPLAY_HISTORY_MAX_INDEX_BYTES,
      replayAnalysisHistoryDocumentSchema
    )

    const primaryDocument = primary.value
    const backupDocument = backup.value
    const shouldRecoverBackup =
      backupDocument !== null &&
      (primaryDocument === null || backupDocument.generation > primaryDocument.generation)

    if (shouldRecoverBackup) {
      await this._restorePrimaryIndex(backupDocument)
      return {
        document: backupDocument,
        recoveredFromBackup: true,
        discardedInvalidIndex: primary.invalid
      }
    }

    if (primaryDocument) {
      return {
        document: primaryDocument,
        recoveredFromBackup: false,
        discardedInvalidIndex: false
      }
    }

    if (primary.invalid) await this._quarantineInvalidIndex(this._indexPath)
    if (backup.invalid) await this._quarantineInvalidIndex(this._backupIndexPath)
    return {
      document: null,
      recoveredFromBackup: false,
      discardedInvalidIndex: primary.invalid || backup.invalid
    }
  }

  async writeIndex(document: ReplayAnalysisHistoryDocument): Promise<void> {
    this._assertInitialized()
    const validated = replayAnalysisHistoryDocumentSchema.parse(document)
    const serialized = this._serializeWithinLimit(
      validated,
      REPLAY_HISTORY_MAX_INDEX_BYTES,
      'index-too-large'
    )
    const temporaryPath = path.join(this.rootDirectory, `.index.${randomUUID()}.tmp`)
    await this._writeSyncedExclusive(temporaryPath, serialized)

    try {
      await fs.promises.rm(this._backupIndexPath, { force: true })
      try {
        await fs.promises.rename(this._indexPath, this._backupIndexPath)
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
      }
      await fs.promises.rename(temporaryPath, this._indexPath)
      await this._syncDirectory(this.rootDirectory)
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true })
      if (!(await this._exists(this._indexPath)) && (await this._exists(this._backupIndexPath))) {
        await fs.promises.copyFile(this._backupIndexPath, this._indexPath)
      }
      throw error
    }
  }

  async readResult(resultId: string): Promise<ReplayAnalysisStoredResult | null> {
    this._assertInitialized()
    const resultPath = this._resultPath(resultId)
    const loaded = await this._tryReadJson(
      resultPath,
      REPLAY_HISTORY_MAX_RESULT_BYTES,
      replayAnalysisStoredResultSchema
    )
    if (loaded.invalid) {
      throw new ReplayHistoryStorageError('invalid-data', 'Stored replay result is invalid')
    }
    return loaded.value
  }

  async writeResult(result: ReplayAnalysisStoredResult): Promise<number> {
    this._assertInitialized()
    const validated = replayAnalysisStoredResultSchema.parse(result)
    const resultPath = this._resultPath(validated.historyId)
    if (await this._exists(resultPath)) {
      throw new ReplayHistoryStorageError('result-exists', 'Replay result already exists')
    }

    const serialized = this._serializeWithinLimit(
      validated,
      REPLAY_HISTORY_MAX_RESULT_BYTES,
      'result-too-large'
    )
    const serializedBytes = Buffer.byteLength(serialized)
    const currentBytes = await this.getStorageUsageBytes()
    if (currentBytes + serializedBytes > REPLAY_HISTORY_MAX_TOTAL_BYTES) {
      throw new ReplayHistoryStorageError('quota-exceeded', 'Replay history storage quota exceeded')
    }

    const temporaryPath = path.join(
      this._resultsDirectory,
      `.${validated.historyId}.${randomUUID()}.tmp`
    )
    await this._writeSyncedExclusive(temporaryPath, serialized)
    try {
      await fs.promises.rename(temporaryPath, resultPath)
      await this._syncDirectory(this._resultsDirectory)
      return serializedBytes
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true })
      throw error
    }
  }

  async deleteResult(resultId: string): Promise<number> {
    this._assertInitialized()
    const resultPath = this._resultPath(resultId)
    let bytes = 0
    try {
      bytes = (await fs.promises.stat(resultPath)).size
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error
      return 0
    }
    await fs.promises.rm(resultPath, { force: true })
    return bytes
  }

  async cleanupTemporaryFiles(): Promise<number> {
    this._assertInitialized()
    let deletedBytes = await this._removeDirectoryContents(this._temporaryDirectory)
    deletedBytes += await this._removeMatchingFiles(this.rootDirectory, (name) =>
      /^\.index\.[0-9a-f-]+\.tmp$/i.test(name)
    )
    deletedBytes += await this._removeMatchingFiles(this._resultsDirectory, (name) =>
      /^\.[0-9a-f-]+\.[0-9a-f-]+\.tmp$/i.test(name)
    )
    return deletedBytes
  }

  async cleanupOrphanResults(referencedResultIds: ReadonlySet<string>): Promise<number> {
    this._assertInitialized()
    let deletedBytes = 0
    const entries = await fs.promises.readdir(this._resultsDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const match = /^([0-9a-f-]+)\.json$/i.exec(entry.name)
      if (!match || !UUID_PATTERN.test(match[1]) || referencedResultIds.has(match[1])) continue
      const resultPath = this._containedPath(this._resultsDirectory, entry.name)
      deletedBytes += await this._removeFileAndCount(resultPath)
    }
    return deletedBytes
  }

  async getStorageUsageBytes(): Promise<number> {
    this._assertInitialized()
    return await this._directorySize(this.rootDirectory)
  }

  async removeAllInternalData(): Promise<number> {
    this._assertInitialized()
    const bytes = await this.getStorageUsageBytes()
    await fs.promises.rm(this.rootDirectory, { recursive: true, force: true })
    await this.init()
    return bytes
  }

  private _resultPath(resultId: string): string {
    this._assertUuid(resultId)
    return this._containedPath(this._resultsDirectory, `${resultId}.json`)
  }

  private _assertUuid(value: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new ReplayHistoryStorageError('invalid-id', 'Invalid replay history id')
    }
  }

  private _containedPath(parentDirectory: string, fileName: string): string {
    const candidate = path.resolve(parentDirectory, fileName)
    const relative = path.relative(path.resolve(parentDirectory), candidate)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ReplayHistoryStorageError('invalid-id', 'Replay history path escapes its root')
    }
    return candidate
  }

  private async _tryReadJson<T>(
    filePath: string,
    maximumBytes: number,
    schema: ZodType<T>
  ): Promise<{ value: T | null; invalid: boolean }> {
    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile() || stat.size > maximumBytes) return { value: null, invalid: true }
      const text = await fs.promises.readFile(filePath, 'utf8')
      const parsedJson: unknown = JSON.parse(text)
      const parsed = schema.safeParse(parsedJson)
      return parsed.success
        ? { value: parsed.data, invalid: false }
        : { value: null, invalid: true }
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return { value: null, invalid: false }
      if (error instanceof SyntaxError) return { value: null, invalid: true }
      throw error
    }
  }

  private _serializeWithinLimit(
    data: unknown,
    maximumBytes: number,
    errorCode: 'index-too-large' | 'result-too-large'
  ): string {
    const serialized = JSON.stringify(data)
    if (Buffer.byteLength(serialized) > maximumBytes) {
      throw new ReplayHistoryStorageError(errorCode, 'Replay history data exceeds its size limit')
    }
    return serialized
  }

  private async _writeSyncedExclusive(filePath: string, data: string): Promise<void> {
    const handle = await fs.promises.open(filePath, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private async _restorePrimaryIndex(document: ReplayAnalysisHistoryDocument): Promise<void> {
    const serialized = this._serializeWithinLimit(
      document,
      REPLAY_HISTORY_MAX_INDEX_BYTES,
      'index-too-large'
    )
    const temporaryPath = path.join(this.rootDirectory, `.index.${randomUUID()}.tmp`)
    await this._writeSyncedExclusive(temporaryPath, serialized)
    try {
      await fs.promises.rm(this._indexPath, { force: true })
      await fs.promises.rename(temporaryPath, this._indexPath)
      await this._syncDirectory(this.rootDirectory)
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true })
      throw error
    }
  }

  private async _quarantineInvalidIndex(filePath: string): Promise<void> {
    if (!(await this._exists(filePath))) return
    const quarantinePath = path.join(this._temporaryDirectory, `invalid-index-${randomUUID()}.json`)
    try {
      await fs.promises.rename(filePath, quarantinePath)
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error
    }
  }

  private async _removeDirectoryContents(directory: string): Promise<number> {
    let deletedBytes = 0
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const target = this._containedPath(directory, entry.name)
      deletedBytes += entry.isDirectory()
        ? await this._directorySize(target)
        : await this._fileSize(target)
      await fs.promises.rm(target, { recursive: entry.isDirectory(), force: true })
    }
    return deletedBytes
  }

  private async _removeMatchingFiles(
    directory: string,
    predicate: (name: string) => boolean
  ): Promise<number> {
    let deletedBytes = 0
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !predicate(entry.name)) continue
      deletedBytes += await this._removeFileAndCount(this._containedPath(directory, entry.name))
    }
    return deletedBytes
  }

  private async _removeFileAndCount(filePath: string): Promise<number> {
    const bytes = await this._fileSize(filePath)
    await fs.promises.rm(filePath, { force: true })
    return bytes
  }

  private async _directorySize(directory: string): Promise<number> {
    let bytes = 0
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return 0
      throw error
    }
    for (const entry of entries) {
      const target = this._containedPath(directory, entry.name)
      if (entry.isDirectory()) bytes += await this._directorySize(target)
      else if (entry.isFile()) bytes += await this._fileSize(target)
    }
    return bytes
  }

  private async _fileSize(filePath: string): Promise<number> {
    try {
      return (await fs.promises.stat(filePath)).size
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return 0
      throw error
    }
  }

  private async _exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath)
      return true
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return false
      throw error
    }
  }

  private async _syncDirectory(directory: string): Promise<void> {
    if (process.platform === 'win32') return
    const handle = await fs.promises.open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private _assertInitialized(): void {
    if (!this._initialized) {
      throw new ReplayHistoryStorageError(
        'not-initialized',
        'Replay history file executor is not initialized'
      )
    }
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
