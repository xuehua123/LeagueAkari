import {
  REPLAY_HISTORY_SCHEMA_VERSION,
  type ReplayAnalysisHistoryDocument,
  type ReplayAnalysisStoredResult
} from '@shared/types/live-coach'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  REPLAY_HISTORY_MAX_INDEX_BYTES,
  REPLAY_HISTORY_MAX_RESULT_BYTES,
  REPLAY_HISTORY_MAX_TOTAL_BYTES,
  ReplayHistoryFileExecutor,
  ReplayHistoryStorageError
} from './file-executor'

const HISTORY_ID = '1602a2cc-9796-4b7d-a58b-77b337eb31cd'
const temporaryDirectories: string[] = []

function createDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-replay-history-files-'))
  temporaryDirectories.push(directory)
  return directory
}

function createDocument(generation: number): ReplayAnalysisHistoryDocument {
  return { schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION, generation, entries: [] }
}

function createResult(): ReplayAnalysisStoredResult {
  return {
    schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION,
    historyId: HISTORY_ID,
    analysisFingerprint: 'a'.repeat(64),
    generatedAt: '2026-08-29T00:00:00.000Z',
    summary: {
      sourceKind: 'video',
      artifactSha256: 'b'.repeat(64),
      sidecarSha256: null,
      metadata: {
        patch: '16.17.1',
        mapId: 11,
        queueId: 420,
        selfTeam: 'blue',
        selfChampionId: 266,
        minimapSide: 'right',
        videoGameStartMs: 0,
        roster: null
      },
      durationSeconds: 60,
      frameCount: 300,
      analysisFps: 5,
      totalCues: 0,
      totalEvidences: 0
    },
    capabilityStatus: { available: [], disabled: [], missingFields: [] },
    timeline: []
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('ReplayHistoryFileExecutor', () => {
  it('atomically writes results and restores the highest valid backup index', async () => {
    const directory = createDirectory()
    const executor = new ReplayHistoryFileExecutor(directory)
    await executor.init()
    await executor.writeIndex(createDocument(1))
    await executor.writeIndex(createDocument(2))
    await executor.writeResult(createResult())

    fs.writeFileSync(path.join(directory, 'index.json'), '{broken')
    const restarted = new ReplayHistoryFileExecutor(directory)
    await restarted.init()
    const loaded = await restarted.readIndex()

    expect(loaded.recoveredFromBackup).toBe(true)
    expect(loaded.document?.generation).toBe(1)
    expect((await restarted.readIndex()).document?.generation).toBe(1)
    expect(await restarted.readResult(HISTORY_ID)).toEqual(createResult())
  })

  it('restores the previous primary if replacing the index fails', async () => {
    const directory = createDirectory()
    const executor = new ReplayHistoryFileExecutor(directory)
    await executor.init()
    await executor.writeIndex(createDocument(1))
    const originalRename = fs.promises.rename.bind(fs.promises)
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
      if (
        String(source).includes('.index.') &&
        destination === path.join(directory, 'index.json')
      ) {
        throw Object.assign(new Error('simulated rename failure'), { code: 'EIO' })
      }
      return await originalRename(source, destination)
    })

    await expect(executor.writeIndex(createDocument(2))).rejects.toThrow('simulated rename failure')
    vi.restoreAllMocks()
    const restarted = new ReplayHistoryFileExecutor(directory)
    await restarted.init()
    expect((await restarted.readIndex()).document?.generation).toBe(1)
  })

  it('rejects traversal ids and oversize indexes before reading or writing content', async () => {
    const directory = createDirectory()
    const executor = new ReplayHistoryFileExecutor(directory)
    await executor.init()
    await expect(executor.readResult('../../secret')).rejects.toMatchObject({
      code: 'invalid-id'
    } satisfies Partial<ReplayHistoryStorageError>)

    fs.writeFileSync(path.join(directory, 'index.json'), '{}')
    fs.truncateSync(path.join(directory, 'index.json'), REPLAY_HISTORY_MAX_INDEX_BYTES + 1)
    const loaded = await executor.readIndex()
    expect(loaded.document).toBeNull()
    expect(loaded.discardedInvalidIndex).toBe(true)
  })

  it('rejects a schema-valid result above the 8 MiB per-result boundary', async () => {
    const directory = createDirectory()
    const executor = new ReplayHistoryFileExecutor(directory)
    await executor.init()
    const result = createResult()
    const text = 'x'.repeat(2_048)
    result.timeline = Array.from({ length: 5_000 }, (_, index) => ({
      gameTimeMs: index,
      category: 'macro',
      observation: text,
      spokenText: text,
      options: [],
      evidenceHashes: []
    }))

    await expect(executor.writeResult(result)).rejects.toMatchObject({
      code: 'result-too-large'
    } satisfies Partial<ReplayHistoryStorageError>)
    expect(REPLAY_HISTORY_MAX_RESULT_BYTES).toBe(8 * 1024 * 1024)
    expect(REPLAY_HISTORY_MAX_TOTAL_BYTES).toBe(128 * 1024 * 1024)
  })

  it('cleans orphan results and reports bytes deleted without touching referenced results', async () => {
    const directory = createDirectory()
    const executor = new ReplayHistoryFileExecutor(directory)
    await executor.init()
    const bytes = await executor.writeResult(createResult())
    expect(bytes).toBeGreaterThan(0)
    expect(await executor.cleanupOrphanResults(new Set([HISTORY_ID]))).toBe(0)
    expect(await executor.readResult(HISTORY_ID)).not.toBeNull()
    expect(await executor.cleanupOrphanResults(new Set())).toBe(bytes)
    expect(await executor.readResult(HISTORY_ID)).toBeNull()
  })
})
