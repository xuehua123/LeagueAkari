import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { ReplayCvWorkerExecutor } from './replay-cv-worker-executor'

class FakeUtilityProcess extends EventEmitter {
  readonly messages: unknown[] = []
  killed = false
  throwOnMessageType: string | null = null

  postMessage(message: any): void {
    if (message?.type === this.throwOnMessageType) throw new Error(`post failed: ${message.type}`)
    this.messages.push(message)
  }

  kill(): boolean {
    this.killed = true
    return true
  }
}

function createContext() {
  return {
    logger: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    }
  } as any
}

function startOptions() {
  return {
    sessionId: 'replay_session',
    patch: '16.16.1',
    identityModel: null,
    championCandidates: [],
    allyChampionCandidates: [],
    enemyChampionCandidates: [],
    selfChampionId: null
  }
}

function frame(sequence: number) {
  return {
    buffer: new Uint8Array(16),
    pixelFormat: 'rgba' as const,
    width: 2,
    height: 2,
    observedAt: 1_700_000_000_000 + sequence * 200,
    sequence
  }
}

function batch(sequence: number) {
  const observedAt = 1_700_000_000_000 + sequence * 200
  return {
    sessionId: 'replay_session',
    patch: '16.16.1',
    calibrationVersion: '1.0.0',
    modelVersions: { ccl: '1.2.0' },
    frame: { observedAt, receivedAt: observedAt, sequence, ageMs: 0 },
    health: 'healthy' as const,
    entities: [],
    events: []
  }
}

async function createStartedExecutor() {
  const worker = new FakeUtilityProcess()
  const context = createContext()
  const executor = new ReplayCvWorkerExecutor(
    context,
    () => worker as any,
    () => 'minimap-observer-worker.js'
  )
  const starting = executor.start(startOptions())
  expect(worker.messages[0]).toMatchObject({ type: 'initialize' })
  worker.emit('message', {
    type: 'ready',
    protocolVersion: '1.0.0',
    runtimeVersions: { ccl: '1.2.0' },
    supportedBackends: []
  })
  await starting
  expect(worker.messages[1]).toMatchObject({
    type: 'replay-start',
    sessionId: 'replay_session'
  })
  return { worker, executor, context }
}

describe('ReplayCvWorkerExecutor', () => {
  it('returns only validated structured observations for the matching request', async () => {
    const { worker, executor } = await createStartedExecutor()
    const pending = executor.processFrame(frame(1))
    const request = worker.messages.at(-1) as any

    worker.emit('message', {
      type: 'replay-frame-result',
      requestId: request.requestId,
      sessionId: 'replay_session',
      sequence: 1,
      dropped: false,
      inferenceLatencyMs: 2,
      batch: batch(1)
    })

    await expect(pending).resolves.toEqual(batch(1))
    executor.stop('test-finished')
    expect(worker.killed).toBe(true)
  })

  it('bounds outstanding requests to three and rejects the oldest with latest-wins semantics', async () => {
    const { executor } = await createStartedExecutor()
    const first = executor.processFrame(frame(1))
    const firstRejected = expect(first).rejects.toThrow('已被更新的帧替代')
    const second = executor.processFrame(frame(2))
    const third = executor.processFrame(frame(3))
    const fourth = executor.processFrame(frame(4))

    await firstRejected
    executor.stop('test-cancel')
    await expect(second).rejects.toThrow('已停止')
    await expect(third).rejects.toThrow('已停止')
    await expect(fourth).rejects.toThrow('已停止')
  })

  it('rejects in-flight work and kills the utility process on cancellation', async () => {
    const { worker, executor } = await createStartedExecutor()
    const pending = executor.processFrame(frame(1))

    executor.stop('user-cancelled')

    await expect(pending).rejects.toThrow('user-cancelled')
    expect(worker.messages).toContainEqual({
      type: 'replay-stop',
      sessionId: 'replay_session',
      reason: 'user-cancelled'
    })
    expect(worker.killed).toBe(true)
  })

  it('kills the worker when initialize delivery fails instead of leaking the process', async () => {
    const worker = new FakeUtilityProcess()
    worker.throwOnMessageType = 'initialize'
    const executor = new ReplayCvWorkerExecutor(
      createContext(),
      () => worker as any,
      () => 'minimap-observer-worker.js'
    )

    await expect(executor.start(startOptions())).rejects.toThrow('post failed: initialize')
    expect(worker.killed).toBe(true)
  })

  it('rejects a frame immediately when message delivery fails', async () => {
    const { worker, executor } = await createStartedExecutor()
    worker.throwOnMessageType = 'replay-frame'

    await expect(executor.processFrame(frame(1))).rejects.toThrow('post failed: replay-frame')
    executor.stop('test-finished')
  })

  it('logs and propagates only stable fields when the worker returns sensitive details', async () => {
    const { worker, executor, context } = await createStartedExecutor()
    const pending = executor.processFrame(frame(1))

    worker.emit('message', {
      type: 'error',
      code: 'LC_ERR_REPLAY_CV_INFERENCE_FAIL',
      stage: 'C:\\Users\\private\\model.onnx',
      details:
        'Authorization=private-token, https://example.test/private, C:\\Users\\private\\model.onnx, /home/private/model.onnx\n at worker.js:1:1',
      recoverable: false
    })

    await expect(pending).rejects.toThrow('录像 CV Worker 错误 [internal-error/replay-inference]')
    expect(context.logger.warn).toHaveBeenCalledWith(
      'Replay CV worker reported internal-error at replay-inference; recoverable=false'
    )
    const logged = JSON.stringify(context.logger.warn.mock.calls)
    expect(logged).not.toContain('private-token')
    expect(logged).not.toContain('example.test')
    expect(logged).not.toContain('C:\\\\Users')
    expect(logged).not.toContain('/home/private')

    executor.stop('test-finished')
  })
})
