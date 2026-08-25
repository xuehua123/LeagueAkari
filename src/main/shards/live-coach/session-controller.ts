import { CoachSessionState } from '@shared/types/live-coach'
import { LiveGameSnapshot } from '@shared/types/live-game-data'
import { formatError } from '@shared/utils/errors'

import { LiveCoachCapabilityController } from './capability-controller'
import type { LiveCoachMainContext } from './context'
import { CueSchedulerController } from './cue-scheduler-controller'
import { FactFusionEngine } from './fact-fusion'
import { CoachRuleEngine } from './rule-engine'

export class LiveCoachSessionController {
  private readonly _fusion: FactFusionEngine
  private readonly _ruleEngine: CoachRuleEngine
  private _gameflowDisposer: (() => void) | null = null
  private _liveDataDisposer: (() => void) | null = null
  private _isPaused = false
  private _latestPatch: string | null = null

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _capabilityController: LiveCoachCapabilityController,
    private readonly _scheduler: CueSchedulerController
  ) {
    this._fusion = new FactFusionEngine()
    this._ruleEngine = new CoachRuleEngine()
  }

  public get fusion(): FactFusionEngine {
    return this._fusion
  }

  public init(): void {
    // 1. Subscribe to LiveGameDataMain
    this._liveDataDisposer = this._context.liveGameData.subscribe('game-stats', (snapshot) => {
      if (snapshot.patch) {
        this._latestPatch = snapshot.patch
      }
      this._onLiveGameSnapshot(snapshot)
    })

    // 2. Watch Gameflow state
    this._gameflowDisposer = this._context.mobxUtils.reaction(
      () => ({
        enabled: this._context.settings.enabled,
        phase: this._context.leagueClient.data.gameflow.phase,
        session: this._context.leagueClient.data.gameflow.session
      }),
      ({ enabled, phase, session }) => {
        if (!enabled) {
          this.setSessionState('disabled')
          this._scheduler.cancelAll('disabled')
          return
        }

        const mapId = session?.map?.id ?? null
        const queueId = session?.gameData?.queue?.id ?? null
        const patch = this._latestPatch || '14.15.1'

        this._capabilityController.evaluateCapabilities(mapId, queueId, patch)

        if (phase === 'InProgress') {
          // 严格检查：非召唤师峡谷（Map 11）或非 Windows 环境，阻断启动
          if (mapId !== null && mapId !== 11) {
            this._context.logger.info(
              `LiveCoach: mapId ${mapId} is not Summoner's Rift (11). Session blocked.`
            )
            this.setSessionState('degraded')
            this._scheduler.cancelAll('unsupported-map')
            return
          }

          if (process.platform !== 'win32') {
            this.setSessionState('degraded')
            return
          }

          const sessionId = session?.gameData?.gameId
            ? String(session.gameData.gameId)
            : `sess_${Date.now()}`
          this.startSession(sessionId, mapId, queueId, patch)
        } else if (phase === 'PreEndOfGame' || phase === 'EndOfGame') {
          this.endSession('game-ended')
        } else {
          if (
            this._context.state.session.state !== 'idle' &&
            this._context.state.session.state !== 'disabled'
          ) {
            this.setSessionState('idle')
          }
        }
      },
      { fireImmediately: true }
    )
  }

  public dispose(): void {
    if (this._gameflowDisposer) {
      this._gameflowDisposer()
      this._gameflowDisposer = null
    }
    if (this._liveDataDisposer) {
      this._liveDataDisposer()
      this._liveDataDisposer = null
    }
    this.endSession('disposed')
  }

  public setSessionState(state: CoachSessionState): void {
    this._context.state.setSessionState(state)
  }

  public startSession(
    sessionId: string,
    mapId: number | null,
    queueId: number | null,
    patch: string | null
  ): void {
    if (mapId !== null && mapId !== 11) {
      this.setSessionState('degraded')
      return
    }

    this._context.logger.info(
      `Starting coach session: ${sessionId} (Map: ${mapId}, Queue: ${queueId}, Patch: ${patch})`
    )
    this._fusion.reset()
    this._isPaused = false

    this._context.state.setSessionInfo({
      id: sessionId,
      state: 'active',
      mapId,
      queueId,
      patch,
      startedAt: Date.now()
    })
  }

  public endSession(reason: string): void {
    if (
      this._context.state.session.state === 'idle' ||
      this._context.state.session.state === 'disabled'
    ) {
      return
    }

    this._context.logger.info(
      `Ending coach session: ${this._context.state.session.id}, reason: ${reason}`
    )
    this._scheduler.cancelAll(reason)
    this._fusion.reset()
    this._context.state.reset()
  }

  public pause(reason: string): void {
    this._isPaused = true
    this._scheduler.cancelAll(reason)
    this.setSessionState('paused')
  }

  public resume(): void {
    this._isPaused = false
    this.setSessionState('active')
  }

  private _onLiveGameSnapshot(snapshot: LiveGameSnapshot): void {
    if (this._isPaused || this._context.state.session.state !== 'active') {
      return
    }

    try {
      this._fusion.updateLiveGameSnapshot(snapshot)

      const sessionId = this._context.state.session.id || snapshot.sessionId
      const patch = this._context.state.session.patch || snapshot.patch

      const cues = this._ruleEngine.evaluate({
        sessionId,
        patch,
        fusion: this._fusion,
        enabledCategories: this._context.settings.cueCategories
      })

      if (cues.length > 0) {
        this._scheduler.submitCues(cues)
      }
    } catch (err) {
      this._context.logger.warn(`Error during fact fusion & rule evaluation: ${formatError(err)}`)
    }
  }
}
