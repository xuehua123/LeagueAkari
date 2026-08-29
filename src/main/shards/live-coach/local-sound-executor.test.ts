import { describe, expect, it, vi } from 'vitest'

import { LocalSoundExecutor } from './local-sound-executor'

describe('LocalSoundExecutor Earcon Sound Test', () => {
  function createMockContext() {
    return {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    } as any
  }

  it('reports availability only after the native earcon module is initialized', () => {
    const ctx = createMockContext()
    const native = { load: vi.fn(), playEarcon: vi.fn().mockResolvedValue(true) }
    const executor = new LocalSoundExecutor(ctx, () => native)

    expect(executor.isAvailable()).toBe(false)
    expect(executor.initialize()).toBe(process.platform === 'win32')
    expect(executor.isAvailable()).toBe(process.platform === 'win32')
  })

  it('plays different sound categories without crashing', async () => {
    const ctx = createMockContext()
    const playEarcon = vi.fn().mockResolvedValue(true)
    const executor = new LocalSoundExecutor(ctx, () => ({ load: vi.fn(), playEarcon }))

    const warningResult = await executor.playSound('warning', 0.8)
    expect(typeof warningResult).toBe('boolean')

    const oppResult = await executor.playSound('opportunity', 0.5)
    expect(typeof oppResult).toBe('boolean')
    if (process.platform === 'win32') {
      expect(playEarcon).toHaveBeenNthCalledWith(1, 'warning', 0.8)
      expect(playEarcon).toHaveBeenNthCalledWith(2, 'opportunity', 0.5)
    }
  })
})
