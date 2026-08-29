import {
  type ReplayAnalysisStoredResult,
  type StartReplayAnalysisTaskInput
} from '@shared/types/live-coach'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReplayHistoryController } from './controller'
import { ReplayHistoryFileExecutor } from './file-executor'
import { createReplayAnalysisFingerprint } from './projection'

const ARTIFACT_SHA = 'a'.repeat(64)
const SIDECAR_SHA = 'b'.repeat(64)
const temporaryDirectories: string[] = []

function createDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-replay-history-controller-'))
  temporaryDirectories.push(directory)
  return directory
}

function createStartInput(): StartReplayAnalysisTaskInput {
  const fingerprintInput = {
    artifactSha256: ARTIFACT_SHA,
    sidecarSha256: SIDECAR_SHA,
    metadata: {
      patch: '16.17.1',
      mapId: 11,
      queueId: 420,
      selfTeam: 'blue' as const,
      selfChampionId: 266,
      minimapSide: 'right' as const,
      videoGameStartMs: 5_000,
      roster: [{ team: 'blue' as const, championId: 266 }]
    },
    roi: { x: 0.8, y: 0.7, width: 0.2, height: 0.3 },
    manifest: {
      pipelineVersion: '1',
      ruleCatalogVersion: '16.17.1',
      ffmpegVersion: '7.1',
      runtimeVersion: 'node-22',
      models: {}
    }
  }
  return {
    ...fingerprintInput,
    analysisFingerprint: createReplayAnalysisFingerprint(fingerprintInput),
    sourceKind: 'video',
    retryOf: null
  }
}

function createResult(id: string, input: StartReplayAnalysisTaskInput): ReplayAnalysisStoredResult {
  return {
    schemaVersion: 1,
    historyId: id,
    analysisFingerprint: input.analysisFingerprint,
    generatedAt: '2026-08-29T00:00:10.000Z',
    summary: {
      sourceKind: input.sourceKind,
      artifactSha256: input.artifactSha256,
      sidecarSha256: input.sidecarSha256,
      metadata: input.metadata,
      durationSeconds: 60,
      frameCount: 300,
      analysisFps: 5,
      totalCues: 1,
      totalEvidences: 2
    },
    capabilityStatus: { available: ['minimap-basic'], disabled: [], missingFields: [] },
    timeline: [
      {
        gameTimeMs: 30_000,
        category: 'macro',
        observation: 'Move to river',
        spokenText: 'Move to river',
        options: ['Contest'],
        evidenceHashes: ['c'.repeat(64)]
      }
    ]
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('ReplayHistoryController', () => {
  it('persists completed history, reloads it and returns an exact duplicate', async () => {
    const directory = createDirectory()
    const input = createStartInput()
    const controller = new ReplayHistoryController({ rootDirectory: directory })
    await controller.init()
    const started = await controller.startTask(input)
    expect(started.duplicate).toBeNull()
    await controller.updateProgress(started.entry.id, { stage: 'analyzing', progress: 50 })
    await controller.completeTask(started.entry.id, createResult(started.entry.id, input))
    await controller.dispose()

    const restarted = new ReplayHistoryController({ rootDirectory: directory })
    await restarted.init()
    expect(restarted.list()).toHaveLength(1)
    expect(restarted.get(started.entry.id)?.status).toBe('completed')
    expect(await restarted.getResult(started.entry.id)).toEqual(
      createResult(started.entry.id, input)
    )
    const duplicate = await restarted.startTask(input)
    expect(duplicate.duplicate?.id).toBe(started.entry.id)
    expect(restarted.list()).toHaveLength(1)
  })

  it('turns active tasks into interrupted entries after restart', async () => {
    const directory = createDirectory()
    const controller = new ReplayHistoryController({ rootDirectory: directory })
    await controller.init()
    const started = await controller.startTask(createStartInput())
    await controller.updateProgress(started.entry.id, { stage: 'analyzing', progress: 42 })
    await controller.dispose()

    const restarted = new ReplayHistoryController({ rootDirectory: directory })
    await restarted.init()
    expect(restarted.get(started.entry.id)).toMatchObject({
      status: 'interrupted',
      stage: 'interrupted',
      progress: 42,
      failureCode: 'app-interrupted',
      resultId: null
    })
  })

  it('never leaves a completed index entry pointing to a missing result', async () => {
    const directory = createDirectory()
    const input = createStartInput()
    const controller = new ReplayHistoryController({ rootDirectory: directory })
    await controller.init()
    const started = await controller.startTask(input)
    await controller.completeTask(started.entry.id, createResult(started.entry.id, input))
    await controller.dispose()
    fs.rmSync(path.join(directory, 'results', `${started.entry.id}.json`), { force: true })

    const restarted = new ReplayHistoryController({ rootDirectory: directory })
    await restarted.init()
    expect(restarted.get(started.entry.id)).toMatchObject({
      status: 'failed',
      failureCode: 'stored-result-unavailable',
      resultId: null
    })
    expect(await restarted.getResult(started.entry.id)).toBeNull()
  })

  it('records failed and cancelled tasks and supports real delete and clear', async () => {
    const directory = createDirectory()
    let nextId = 1
    const controller = new ReplayHistoryController({
      rootDirectory: directory,
      idFactory: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`
    })
    await controller.init()
    const failed = await controller.startTask(createStartInput())
    await controller.failTask(failed.entry.id, { failureCode: 'decoder-failed' })
    expect(controller.get(failed.entry.id)?.status).toBe('failed')

    const retryBase = createStartInput()
    retryBase.manifest = { ...retryBase.manifest, pipelineVersion: '2' }
    const retryInput = {
      ...retryBase,
      analysisFingerprint: createReplayAnalysisFingerprint({
        artifactSha256: retryBase.artifactSha256,
        sidecarSha256: retryBase.sidecarSha256,
        metadata: retryBase.metadata,
        roi: retryBase.roi,
        manifest: retryBase.manifest
      }),
      retryOf: failed.entry.id
    }
    const cancelled = await controller.startTask(retryInput)
    await controller.cancelTask(cancelled.entry.id)
    expect(controller.get(cancelled.entry.id)?.status).toBe('cancelled')
    expect(await controller.delete(failed.entry.id)).toMatchObject({ deleted: true })
    expect(controller.get(failed.entry.id)).toBeNull()
    expect((await controller.clear()).deletedEntries).toBe(1)
    expect(controller.list()).toEqual([])

    const restarted = new ReplayHistoryController({ rootDirectory: directory })
    await restarted.init()
    expect(restarted.list()).toEqual([])
  })

  it('keeps an indexed result visible and retryable when result deletion fails', async () => {
    const directory = createDirectory()
    const input = createStartInput()
    const fileExecutor = new ReplayHistoryFileExecutor(directory)
    const controller = new ReplayHistoryController({ rootDirectory: directory, fileExecutor })
    await controller.init()
    const started = await controller.startTask(input)
    await controller.completeTask(started.entry.id, createResult(started.entry.id, input))
    vi.spyOn(fileExecutor, 'deleteResult').mockRejectedValueOnce(
      new Error('EPERM: result file is in use')
    )

    await expect(controller.delete(started.entry.id)).rejects.toThrow('EPERM')
    expect(controller.get(started.entry.id)).toMatchObject({
      id: started.entry.id,
      status: 'completed',
      resultId: started.entry.id
    })
    expect(await controller.getResult(started.entry.id)).toEqual(
      createResult(started.entry.id, input)
    )

    await expect(controller.delete(started.entry.id)).resolves.toMatchObject({ deleted: true })
    expect(controller.get(started.entry.id)).toBeNull()
  })

  it('serializes concurrent progress updates without losing index generations', async () => {
    const directory = createDirectory()
    const controller = new ReplayHistoryController({ rootDirectory: directory })
    await controller.init()
    const started = await controller.startTask(createStartInput())
    await Promise.all([
      controller.updateProgress(started.entry.id, { stage: 'extracting', progress: 20 }),
      controller.updateProgress(started.entry.id, { stage: 'analyzing', progress: 30 }),
      controller.updateProgress(started.entry.id, { stage: 'analyzing', progress: 40 })
    ])
    expect(controller.get(started.entry.id)?.progress).toBe(40)
  })

  it('fails closed when clearing active work and rejects regressive progress stages', async () => {
    const controller = new ReplayHistoryController({ rootDirectory: createDirectory() })
    await controller.init()
    const started = await controller.startTask(createStartInput())
    await controller.updateProgress(started.entry.id, { stage: 'analyzing', progress: 30 })

    await expect(
      controller.updateProgress(started.entry.id, { stage: 'probing', progress: 40 })
    ).rejects.toMatchObject({ code: 'invalid-state' })
    await expect(
      controller.updateProgress(started.entry.id, { stage: 'analyzing', progress: 29 })
    ).rejects.toMatchObject({ code: 'invalid-state' })
    await expect(controller.clear()).rejects.toMatchObject({ code: 'invalid-state' })
    expect(controller.get(started.entry.id)?.status).toBe('analyzing')

    await controller.cancelTask(started.entry.id)
    await expect(controller.clear()).resolves.toMatchObject({ deletedEntries: 1 })
  })
})
