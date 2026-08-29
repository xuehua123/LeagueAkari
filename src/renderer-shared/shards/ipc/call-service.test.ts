import { afterEach, describe, expect, it, vi } from 'vitest'

import { AkariIpcRendererCallService } from './call-service'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AkariIpcRendererCallService', () => {
  it('never persists IPC arguments or raw error details when a development call fails', async () => {
    const sourceToken = 'A'.repeat(43)
    const logger = { warn: vi.fn() }
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      error: new Error(
        'Authorization=private-token at C:\\Users\\private\\replay.mp4\n    at ipc.js:1:1'
      )
    })
    vi.stubGlobal('window', { electron: { ipcRenderer: { invoke } } })
    const service = new AkariIpcRendererCallService({
      shared: { manager: { getInstance: vi.fn(() => logger) } }
    } as any)

    await expect(
      service.call('live-coach-main', 'prepareVideoReplay', {
        sourceToken,
        sidecarToken: 'B'.repeat(43)
      })
    ).rejects.toThrow('private-token')

    expect(logger.warn).toHaveBeenCalledWith('ipc call failed', {
      namespace: 'live-coach-main',
      fnName: 'prepareVideoReplay'
    })
    const persistedLog = JSON.stringify(logger.warn.mock.calls)
    expect(persistedLog).not.toContain(sourceToken)
    expect(persistedLog).not.toContain('private-token')
    expect(persistedLog).not.toContain('C:\\\\Users')
    expect(persistedLog).not.toContain('ipc.js')
  })
})
