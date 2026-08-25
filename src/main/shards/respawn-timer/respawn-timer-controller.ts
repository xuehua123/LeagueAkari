import { riotId, summonerName } from '@shared/utils/name'
import { comparer, runInAction } from 'mobx'

import type { RespawnTimerMainContext } from './context'

export class RespawnTimerController {
  private _liveDataDisposer: (() => void) | null = null

  constructor(private context: RespawnTimerMainContext) {}

  init() {
    this._watchGameflowPhase()
  }

  dispose() {
    this._stopSubscription()
  }

  applyEnabledSettingSideEffect(enabled: boolean) {
    if (!enabled) {
      this._stopSubscription()
    } else {
      this._startSubscription()
    }
  }

  private _watchGameflowPhase() {
    const { leagueClient, mobxUtils, settings, state } = this.context

    mobxUtils.reaction(
      () => ({
        phase: leagueClient.data.gameflow.phase,
        enabled: settings.enabled
      }),
      ({ phase, enabled }) => {
        if (phase === 'InProgress' && enabled) {
          this._startSubscription()
        } else {
          runInAction(() => {
            state.info = {
              isDead: false,
              timeLeft: 0,
              totalTime: 0
            }
          })
          this._stopSubscription()
        }
      },
      { equals: comparer.shallow, fireImmediately: true }
    )
  }

  private _startSubscription() {
    if (this._liveDataDisposer) {
      return
    }

    const { leagueClient, logger, liveGameData, state } = this.context
    logger.info('Respawn timer subscribed to unified LiveGameData')

    this._liveDataDisposer = liveGameData.subscribe('players', (snapshot) => {
      if (!leagueClient.data.summoner.me) {
        return
      }

      const myRiotId = riotId(leagueClient.data.summoner.me)
      const myInternalName = leagueClient.data.summoner.me.internalName

      const self = snapshot.players.find((p) => {
        if (p.riotId) {
          return p.riotId === myRiotId
        }
        if (p.summonerName) {
          return summonerName(p.summonerName) === myRiotId || p.summonerName === myInternalName
        }
        return false
      })

      if (self) {
        if (!state.info.isDead && self.isDead) {
          runInAction(() => (state.info.totalTime = self.respawnTimer))
        }

        runInAction(() => {
          state.info = {
            isDead: self.isDead,
            timeLeft: self.respawnTimer,
            totalTime: state.info.totalTime
          }
        })
      }
    })
  }

  private _stopSubscription() {
    if (this._liveDataDisposer) {
      this._liveDataDisposer()
      this._liveDataDisposer = null
      this.context.logger.info('Respawn timer unsubscribed from LiveGameData')
    }
  }
}
