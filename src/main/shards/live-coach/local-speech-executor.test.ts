import { afterEach, describe, expect, it, vi } from 'vitest'

import { LocalSpeechExecutor } from './local-speech-executor'

function createContext() {
  return {
    settings: {
      speechVolume: 0.8,
      speechRate: 1,
      speechVoiceId: null,
      speechOutputDeviceId: null
    },
    state: { setSpeechState: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as any
}

function createEngine() {
  return {
    listVoices: vi.fn(() => [
      { id: 'en-voice', name: 'English', culture: 'en-US', gender: 'Female' },
      { id: 'zh-voice', name: 'Chinese', culture: 'zh-CN', gender: 'Female' }
    ]),
    listOutputDevices: vi.fn(() => [{ id: 'speaker', name: 'Speaker', isDefault: true }]),
    speak: vi.fn(() => 'sapi-1'),
    getOperationState: vi.fn(() => 'completed' as const),
    cancel: vi.fn(() => true),
    pause: vi.fn(() => true),
    resume: vi.fn(() => true),
    dispose: vi.fn()
  }
}

describe.skipIf(process.platform !== 'win32')('LocalSpeechExecutor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('selects a Chinese voice by default and waits for native completion', async () => {
    const context = createContext()
    const engine = createEngine()
    const executor = new LocalSpeechExecutor(context, () => engine)

    expect(executor.initialize()).toBe(true)
    await expect(
      executor.speak('测试播报', {
        outputDeviceId: 'speaker',
        volume: 0.5,
        rate: 1.2
      })
    ).resolves.toBe(true)

    expect(engine.speak).toHaveBeenCalledWith('测试播报', {
      voiceId: 'zh-voice',
      outputDeviceId: 'speaker',
      volume: 50,
      rate: 1
    })
    expect(context.state.setSpeechState).toHaveBeenLastCalledWith('idle')
  })

  it('cancels the active native operation and rejects its stale completion', async () => {
    vi.useFakeTimers()
    const context = createContext()
    const engine = createEngine()
    engine.getOperationState.mockImplementation(() => 'speaking' as any)
    const executor = new LocalSpeechExecutor(context, () => engine)

    const speech = executor.speak('需要立即停止的播报')
    await vi.advanceTimersByTimeAsync(1)
    executor.cancel()
    await vi.advanceTimersByTimeAsync(30)

    await expect(speech).resolves.toBe(false)
    expect(engine.cancel).toHaveBeenCalledWith('sapi-1')
    expect(executor.isSpeaking).toBe(false)
  })

  it('enumerates actual voices and output devices from the native engine', async () => {
    const engine = createEngine()
    const executor = new LocalSpeechExecutor(createContext(), () => engine)

    await expect(executor.listInstalledVoices()).resolves.toHaveLength(2)
    await expect(executor.listOutputDevices()).resolves.toEqual([
      { id: 'speaker', name: 'Speaker', isDefault: true }
    ])
  })

  it('keeps the public speech state unavailable after native initialization fails', async () => {
    const context = createContext()
    const executor = new LocalSpeechExecutor(context, () => {
      throw new Error('speech binary missing')
    })

    await expect(executor.speak('测试不可用回退')).resolves.toBe(false)

    expect(executor.isAvailable).toBe(false)
    expect(context.state.setSpeechState).toHaveBeenLastCalledWith('unavailable')
  })

  it('fails closed when SAPI has no Chinese voice', () => {
    const context = createContext()
    const engine = createEngine()
    engine.listVoices.mockReturnValue([
      { id: 'en-voice', name: 'English', culture: 'en-US', gender: 'Female' }
    ])
    const executor = new LocalSpeechExecutor(context, () => engine)

    expect(executor.initialize()).toBe(false)
    expect(engine.dispose).toHaveBeenCalledOnce()
    expect(context.state.setSpeechState).toHaveBeenLastCalledWith('unavailable')
  })
})
