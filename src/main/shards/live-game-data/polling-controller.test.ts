import { describe, expect, it, vi } from 'vitest'

import { LiveGameDataPollingController } from './polling-controller'

describe('LiveGameDataPollingController', () => {
  function createMockContext() {
    let phase = 'None'
    let session: any = null
    const reactionDisposers: Array<() => void> = []

    return {
      leagueClient: {
        data: {
          gameflow: {
            get phase() {
              return phase
            },
            get session() {
              return session
            }
          }
        },
        http: {
          request: vi.fn().mockResolvedValue({ data: '16.16.1.123' })
        }
      },
      mobxUtils: {
        reaction: vi.fn((fn, effect) => {
          let lastVal: any = undefined
          const check = () => {
            const val = fn()
            if (JSON.stringify(val) !== JSON.stringify(lastVal)) {
              lastVal = val
              effect(val)
            }
          }
          check()
          const disposer = () => {}
          reactionDisposers.push(disposer)
          return disposer
        })
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      state: {
        setIsPolling: vi.fn(),
        setSnapshot: vi.fn(),
        reset: vi.fn(),
        snapshot: null
      },
      setGameflow(newPhase: string, newSession: any = null) {
        phase = newPhase
        session = newSession
      }
    } as any
  }

  it('updates patch from unknown to 16.16.1 in the same active session without resetting polling', () => {
    const ctx = createMockContext()
    const controller = new LiveGameDataPollingController(ctx)

    // 1. 启动 unknown 补丁的 session_1
    controller.startPolling('session_1', 'unknown')
    expect(ctx.state.setIsPolling).toHaveBeenCalledWith(true)

    // 2. 相同 session_1 获取到有效 16.16.1 版本，更新 _currentPatch
    controller.startPolling('session_1', '16.16.1')
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'Updated LiveGameData polling patch to 16.16.1 for session: session_1'
      )
    )

    controller.dispose()
  })

  it('protects against race conditions when disposed while async request is pending', async () => {
    const ctx = createMockContext()
    let resolveRequest: any = null
    ctx.leagueClient.http.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )

    const controller = new LiveGameDataPollingController(ctx)
    controller.init()

    // 触发 InProgress
    ctx.setGameflow('InProgress', { gameData: { gameId: 12345 } })

    // 在异步请求完成前 dispose 控制器
    controller.dispose()

    // 随后请求返回
    if (resolveRequest) {
      resolveRequest({ data: '16.16.1' })
    }

    // 验证：由于 generation 改变，不会重新启动轮询
    expect(ctx.state.setIsPolling).not.toHaveBeenCalled()
  })
})
