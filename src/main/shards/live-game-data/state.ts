import { LiveGameSnapshot } from '@shared/types/live-game-data'
import { makeAutoObservable } from 'mobx'

import { createInitialSnapshot } from './normalization'

export class LiveGameDataState {
  public snapshot: LiveGameSnapshot = createInitialSnapshot()
  public isPolling: boolean = false
  public lastPollDurationMs: number = 0

  constructor() {
    makeAutoObservable(this)
  }

  setSnapshot(snapshot: LiveGameSnapshot) {
    this.snapshot = snapshot
  }

  setIsPolling(polling: boolean) {
    this.isPolling = polling
  }

  setLastPollDurationMs(duration: number) {
    this.lastPollDurationMs = duration
  }

  reset(sessionId: string = '') {
    this.snapshot = createInitialSnapshot(sessionId)
    this.isPolling = false
    this.lastPollDurationMs = 0
  }
}
