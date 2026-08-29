import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  MinimapEntityObservation,
  WorkerToMainMessage
} from '../../../shared/types/live-coach'
import {
  handleMainMessage,
  processNextReplayFrame,
  runDetectionTick,
  setWorkerMessageSinkForTesting
} from './index'

const workerMocks = vi.hoisted(() => ({
  processFrame: vi.fn(),
  deriveEvents: vi.fn()
}))

vi.mock('./champion-onnx-classifier', () => ({
  ChampionOnnxClassifier: { load: vi.fn() }
}))

vi.mock('./minimap-cv', () => ({
  processMinimapFrameWithState: workerMocks.processFrame,
  deriveMinimapEvents: workerMocks.deriveEvents
}))

const liveSessionId = 'live-session'
const replaySessionId = 'replay-session'

function createEntity(observedAt: number): MinimapEntityObservation {
  return {
    trackId: 'enemy-1',
    kind: 'enemy',
    team: 'enemy',
    championId: 103,
    point: { x: 0.5, y: 0.5 },
    regionId: 'mid_lane',
    confidence: 0.95,
    lifecycle: 'confirmed',
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    expiresAt: observedAt + 5_000
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function observationBatches(messages: WorkerToMainMessage[]) {
  return messages.filter(
    (message): message is Extract<WorkerToMainMessage, { type: 'observation-batch' }> =>
      message.type === 'observation-batch'
  )
}

describe('Minimap Observer worker live frame boundaries', () => {
  let messages: WorkerToMainMessage[]

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    messages = []
    setWorkerMessageSinkForTesting((message) => messages.push(message))
    workerMocks.processFrame.mockReset().mockResolvedValue({
      health: 'healthy',
      entities: [createEntity(100)]
    })
    workerMocks.deriveEvents.mockReset().mockReturnValue([
      {
        eventId: 'event-1',
        kind: 'enemy-region-changed',
        timestamp: 100,
        payload: {}
      }
    ])

    await handleMainMessage({
      type: 'start',
      sessionId: liveSessionId,
      patch: '16.16.1',
      targetHwnd: null,
      targetPid: null,
      backend: 'desktopCapturer',
      captureConfig: {
        fps: 15,
        roi: { x: 0, y: 0, width: 1, height: 1 }
      },
      detectors: []
    })
    messages = []
  })

  afterEach(async () => {
    await handleMainMessage({
      type: 'stop',
      sessionId: liveSessionId,
      reason: 'test-cleanup'
    })
    await handleMainMessage({
      type: 'replay-stop',
      sessionId: replaySessionId,
      reason: 'test-cleanup'
    })
    setWorkerMessageSinkForTesting(null)
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('reports the measured capture source separately from the cropped ROI frame', async () => {
    vi.setSystemTime(900)
    await handleMainMessage({
      type: 'frame-buffer',
      buffer: new Uint8Array(4),
      pixelFormat: 'bgra',
      width: 1,
      height: 1,
      sourceWidth: 1920,
      sourceHeight: 1080,
      observedAt: 900,
      sequence: 1
    })

    vi.setSystemTime(1_000)
    await runDetectionTick()

    const status = messages.find(
      (message): message is Extract<WorkerToMainMessage, { type: 'status' }> =>
        message.type === 'status'
    )
    expect(status).toMatchObject({
      resolution: { width: 1, height: 1 },
      sourceResolution: { width: 1920, height: 1080 },
      hdr: null
    })
  })

  it('drops a stale source once and reports zero processed FPS for it', async () => {
    vi.setSystemTime(100)
    await handleMainMessage({
      type: 'frame-buffer',
      buffer: new Uint8Array(4),
      pixelFormat: 'bgra',
      width: 1,
      height: 1,
      observedAt: 100,
      sequence: 1
    })

    vi.setSystemTime(1_100)
    await runDetectionTick()

    const batch = observationBatches(messages).at(-1)?.batch
    const metrics = messages.find(
      (message): message is Extract<WorkerToMainMessage, { type: 'metrics' }> =>
        message.type === 'metrics'
    )
    expect(batch).toEqual(expect.objectContaining({ health: 'unknown', entities: [], events: [] }))
    expect(batch?.frame).toEqual(expect.objectContaining({ ageMs: 1_000, receivedAt: 1_100 }))
    expect(metrics).toEqual(expect.objectContaining({ dropCount: 1, frameAgeMs: 1_000 }))
    expect(workerMocks.processFrame).not.toHaveBeenCalled()
  })

  it.each([
    ['duplicate', 2],
    ['out-of-order', 1]
  ])('rejects a %s source without inflating FPS or double-counting drops', async (_, sequence) => {
    vi.setSystemTime(100)
    await handleMainMessage({
      type: 'frame-buffer',
      buffer: new Uint8Array([1, 0, 0, 255]),
      pixelFormat: 'bgra',
      width: 1,
      height: 1,
      observedAt: 100,
      sequence: 2
    })
    await runDetectionTick()

    vi.setSystemTime(200)
    await handleMainMessage({
      type: 'frame-buffer',
      buffer: new Uint8Array([2, 0, 0, 255]),
      pixelFormat: 'bgra',
      width: 1,
      height: 1,
      observedAt: 200,
      sequence
    })
    await runDetectionTick()
    const rejectedBatch = observationBatches(messages).at(-1)?.batch
    expect(rejectedBatch).toEqual(
      expect.objectContaining({ health: 'unknown', entities: [], events: [] })
    )

    vi.setSystemTime(1_100)
    await handleMainMessage({
      type: 'frame-buffer',
      buffer: new Uint8Array([3, 0, 0, 255]),
      pixelFormat: 'bgra',
      width: 1,
      height: 1,
      observedAt: 1_100,
      sequence: 3
    })
    await runDetectionTick()

    const metrics = messages.find(
      (message): message is Extract<WorkerToMainMessage, { type: 'metrics' }> =>
        message.type === 'metrics'
    )
    const status = messages.find(
      (message): message is Extract<WorkerToMainMessage, { type: 'status' }> =>
        message.type === 'status'
    )
    expect(workerMocks.processFrame).toHaveBeenCalledTimes(2)
    expect(metrics).toEqual(expect.objectContaining({ dropCount: 1 }))
    expect(status).toEqual(expect.objectContaining({ fps: 2 }))
  })

  it('reports zero FPS when a measurement window contains only duplicate or missing sources', async () => {
    vi.setSystemTime(1_000)
    await handleMainMessage({
      type: 'frame-buffer',
      buffer: new Uint8Array([1, 0, 0, 255]),
      pixelFormat: 'bgra',
      width: 1,
      height: 1,
      observedAt: 1_000,
      sequence: 1
    })
    await runDetectionTick()
    messages = []

    vi.setSystemTime(1_100)
    await handleMainMessage({
      type: 'frame-buffer',
      buffer: new Uint8Array([1, 0, 0, 255]),
      pixelFormat: 'bgra',
      width: 1,
      height: 1,
      observedAt: 1_100,
      sequence: 1
    })
    await runDetectionTick()
    vi.setSystemTime(2_000)
    await runDetectionTick()

    const status = messages.find(
      (message): message is Extract<WorkerToMainMessage, { type: 'status' }> =>
        message.type === 'status'
    )
    const metrics = messages.find(
      (message): message is Extract<WorkerToMainMessage, { type: 'metrics' }> =>
        message.type === 'metrics'
    )
    expect(status).toEqual(expect.objectContaining({ fps: 0 }))
    expect(metrics).toEqual(expect.objectContaining({ dropCount: 1 }))
    expect(workerMocks.processFrame).toHaveBeenCalledOnce()
  })

  it('keeps a deferred inference bound to its original source snapshot', async () => {
    const oldBuffer = new Uint8Array([1, 0, 0, 255])
    const newBuffer = new Uint8Array(16).fill(2)
    const deferred = createDeferred<{
      health: 'healthy'
      entities: MinimapEntityObservation[]
    }>()
    workerMocks.processFrame
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce({ health: 'healthy', entities: [createEntity(450)] })

    vi.setSystemTime(100)
    await handleMainMessage({
      type: 'frame-buffer',
      buffer: oldBuffer,
      pixelFormat: 'bgra',
      width: 1,
      height: 1,
      observedAt: 100,
      sequence: 1
    })
    const oldTick = runDetectionTick()

    vi.setSystemTime(450)
    await handleMainMessage({
      type: 'frame-buffer',
      buffer: newBuffer,
      pixelFormat: 'rgba',
      width: 2,
      height: 2,
      observedAt: 450,
      sequence: 2
    })
    vi.setSystemTime(500)
    deferred.resolve({ health: 'healthy', entities: [createEntity(100)] })
    await oldTick

    const oldBatch = observationBatches(messages).at(-1)?.batch
    expect(oldBatch?.frame).toEqual(expect.objectContaining({ observedAt: 100, ageMs: 400 }))
    expect(oldBatch).toEqual(
      expect.objectContaining({ health: 'unknown', entities: [], events: [] })
    )
    expect(workerMocks.processFrame.mock.calls[0]?.slice(0, 5)).toEqual([
      oldBuffer,
      1,
      1,
      100,
      'bgra'
    ])

    await runDetectionTick()

    const newBatch = observationBatches(messages).at(-1)?.batch
    expect(newBatch?.frame).toEqual(expect.objectContaining({ observedAt: 450, ageMs: 50 }))
    expect(newBatch?.health).toBe('healthy')
    expect(workerMocks.processFrame.mock.calls[1]?.slice(0, 5)).toEqual([
      newBuffer,
      2,
      2,
      450,
      'rgba'
    ])
  })

  it('does not apply the live 300ms freshness gate to offline replay frames', async () => {
    const deferred = createDeferred<{
      health: 'healthy'
      entities: MinimapEntityObservation[]
    }>()
    workerMocks.processFrame.mockReturnValueOnce(deferred.promise)
    await handleMainMessage({
      type: 'replay-start',
      sessionId: replaySessionId,
      patch: '16.16.1',
      championCandidates: [],
      allyChampionCandidates: [],
      enemyChampionCandidates: [],
      selfChampionId: null
    })

    vi.setSystemTime(100)
    await handleMainMessage({
      type: 'replay-frame',
      requestId: 'replay-request',
      sessionId: replaySessionId,
      buffer: new Uint8Array(4),
      pixelFormat: 'bgra',
      width: 1,
      height: 1,
      observedAt: 100,
      sequence: 1
    })
    const replayProcessing = processNextReplayFrame()
    vi.setSystemTime(1_000)
    deferred.resolve({ health: 'healthy', entities: [createEntity(100)] })
    await replayProcessing

    const result = messages.find(
      (message): message is Extract<WorkerToMainMessage, { type: 'replay-frame-result' }> =>
        message.type === 'replay-frame-result' && message.requestId === 'replay-request'
    )
    expect(result).toEqual(
      expect.objectContaining({
        dropped: false,
        batch: expect.objectContaining({
          health: 'healthy',
          frame: expect.objectContaining({ observedAt: 100, ageMs: 0 })
        })
      })
    )
  })
})
