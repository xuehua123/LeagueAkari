import { LiveGameDomain, LiveGameSnapshot } from '@shared/types/live-game-data'
import { formatError } from '@shared/utils/errors'

import type { LiveGameDataMainContext } from './context'
import { LiveClientDataLoader } from './live-client-data-loader'
import { createInitialSnapshot } from './normalization'

export type LiveGameDataSubscriber = (snapshot: LiveGameSnapshot) => void

export class LiveGameDataPollingController {
  private readonly _loader: LiveClientDataLoader
  private readonly _subscribers: Map<LiveGameDomain, Set<LiveGameDataSubscriber>> = new Map([
    ['game-stats', new Set()],
    ['players', new Set()],
    ['events', new Set()],
    ['active-player', new Set()]
  ])

  private _timer: NodeJS.Timeout | null = null
  private _isPollingActive = false
  private _currentSessionId = ''
  private _currentPatch = ''
  private _gameflowDisposer: (() => void) | null = null

  constructor(private readonly _context: LiveGameDataMainContext) {
    this._loader = new LiveClientDataLoader()
  }

  public init(): void {
    let currentPollingToken = 0

    // Watch gameflow phase changes
    this._gameflowDisposer = this._context.mobxUtils.reaction(
      () => ({
        phase: this._context.leagueClient.data.gameflow.phase,
        session: this._context.leagueClient.data.gameflow.session
      }),
      async ({ phase, session }) => {
        const token = ++currentPollingToken

        if (phase === 'InProgress') {
          const sessionId = session?.gameData?.gameId
            ? String(session.gameData.gameId)
            : `sess_${Date.now()}`

          let patch = ''
          const rawVersion =
            (session?.gameData as any)?.gameVersion || (session?.gameData as any)?.patch

          if (rawVersion) {
            const parts = String(rawVersion).split('.')
            if (parts.length >= 2) {
              patch = `${parts[0]}.${parts[1]}.1`
            }
          }

          if (!patch) {
            try {
              // 使用已有正确 LCU 端点 /lol-patch/v1/game-version
              const res = await this._context.leagueClient.http.request<
                string | { version?: string; gameVersion?: string }
              >({
                url: '/lol-patch/v1/game-version',
                method: 'GET'
              })
              const versionStr =
                typeof res.data === 'string'
                  ? res.data
                  : res.data?.version || res.data?.gameVersion || ''
              if (versionStr) {
                const parts = versionStr.split('.')
                if (parts.length >= 2) {
                  patch = `${parts[0]}.${parts[1]}.1`
                }
              }
            } catch {
              // ignore
            }
          }

          // 竞态保护：如果异步请求返回时 phase 已经改变或离开了当前对局，直接丢弃，严禁重新启动轮询
          if (
            token !== currentPollingToken ||
            this._context.leagueClient.data.gameflow.phase !== 'InProgress'
          ) {
            return
          }

          // 如果仍未获取到有效 patch，设为 'unknown'（严禁伪造版本导致错误出装）
          if (!patch) {
            patch = 'unknown'
          }

          this.startPolling(sessionId, patch)
        } else {
          this.stopPolling()
        }
      },
      { fireImmediately: true }
    )
  }

  public dispose(): void {
    this.stopPolling()
    if (this._gameflowDisposer) {
      this._gameflowDisposer()
      this._gameflowDisposer = null
    }
    for (const set of this._subscribers.values()) {
      set.clear()
    }
  }

  public startPolling(sessionId: string, patch: string = ''): void {
    if (this._isPollingActive && this._currentSessionId === sessionId) {
      return
    }

    if (this._isPollingActive) {
      this.stopPolling()
    }

    this._currentSessionId = sessionId
    this._currentPatch = patch
    this._isPollingActive = true
    this._loader.resetHealth()
    this._context.state.setIsPolling(true)

    this._context.logger.info(`Starting LiveGameData polling for session: ${sessionId}`)

    this._scheduleNextPoll(0)
  }

  public stopPolling(): void {
    if (!this._isPollingActive) {
      return
    }

    this._isPollingActive = false
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }

    this._context.state.reset(this._currentSessionId)
    this._loader.resetHealth()

    this._context.logger.info(`Stopped LiveGameData polling for session: ${this._currentSessionId}`)

    // Broadcast reset snapshot to all subscribers
    const resetSnapshot = createInitialSnapshot(this._currentSessionId)
    this._notifyAllSubscribers(resetSnapshot)

    this._currentSessionId = ''
  }

  private _scheduleNextPoll(delayMs: number): void {
    if (!this._isPollingActive) {
      return
    }

    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }

    this._timer = setTimeout(async () => {
      if (!this._isPollingActive) {
        return
      }

      try {
        const snapshot = await this._loader.fetchSnapshot(
          this._currentSessionId,
          this._currentPatch
        )

        if (snapshot) {
          this._context.state.setSnapshot(snapshot)
          this._notifyAllSubscribers(snapshot)
          this._scheduleNextPoll(1000)
        } else {
          // Poll failed or empty, backoff 3s
          this._scheduleNextPoll(3000)
        }
      } catch (err) {
        this._context.logger.warn(`Error during LiveGameData poll tick: ${formatError(err)}`)
        this._scheduleNextPoll(3000)
      }
    }, delayMs)
  }

  public subscribe(domain: LiveGameDomain, listener: LiveGameDataSubscriber): () => void {
    const set = this._subscribers.get(domain)
    if (!set) {
      return () => {}
    }

    set.add(listener)

    // Immediate replay of current snapshot
    try {
      listener(this._context.state.snapshot)
    } catch (err) {
      this._context.logger.warn(
        `Error during initial replay to subscriber for domain ${domain}: ${formatError(err)}`
      )
    }

    return () => {
      set.delete(listener)
    }
  }

  private _notifyAllSubscribers(snapshot: LiveGameSnapshot): void {
    for (const [domain, set] of this._subscribers.entries()) {
      for (const listener of set) {
        try {
          listener(snapshot)
        } catch (err) {
          this._context.logger.warn(
            `Error in LiveGameData subscriber for domain ${domain}: ${formatError(err)}`
          )
        }
      }
    }
  }
}
