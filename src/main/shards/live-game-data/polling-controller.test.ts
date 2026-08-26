import { describe, expect, it, vi } from 'vitest'

import { LiveGameDataPollingController } from './polling-controller'

describe('LiveGameDataPollingController', () => {
  function createMockContext() {
    let phase = 'None'
    let session: any = null
    const listeners: Array<() => void> = []

    const triggerReaction = () => {
      for (const listener of listeners) {
        listener()
      }
    }

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
          const check = async () => {
            const val = fn()
            if (JSON.stringify(val) !== JSON.stringify(lastVal)) {
              lastVal = val
              await effect(val)
            }
          }
          listeners.push(check)
          // fire immediately
          check()
          const disposer = () => {
            const idx = listeners.indexOf(check)
            if (idx !== -1) listeners.splice(idx, 1)
          }
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
        triggerReaction()
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

  it('protects against cross-session race condition when Game A request finishes after Game B starts', async () => {
    const ctx = createMockContext()
    let resolvePatchRequestA: any = null

    ctx.leagueClient.http.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatchRequestA = resolve
        })
    )

    const controller = new LiveGameDataPollingController(ctx)
    controller.init()

    // 1. 对局 A 启动 (InProgress, gameId: 10001)，发起异步补丁请求
    ctx.setGameflow('InProgress', { gameData: { gameId: 10001 } })
    // 2. 在对局 A 补丁请求尚未返回前，对局 A 结束并切换至对局 B (None / InProgress 20002)
    ctx.setGameflow('None', null)

    // 3. 对局 A 滞后的异步请求返回，断言：由于代数不一致，严禁启动对局 A 的轮询！
    if (resolvePatchRequestA) {
      resolvePatchRequestA({ data: '16.16.1' })
    }
    await new Promise((r) => setTimeout(r, 10))

    expect(ctx.logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Starting LiveGameData polling for session: 10001')
    )

    controller.dispose()
  })
})
