import { CoachReplaySession } from '@shared/types/live-coach'

import { CueSchedulerController } from './cue-scheduler-controller'
import { FactFusionEngine } from './fact-fusion'
import { CoachRuleEngine } from './rule-engine'

export interface ReplaySimulationOptions {
  speed?: number
  simulateSpeech?: boolean
  onCueGenerated?: (cue: any) => void
}

export class CoachReplaySimulator {
  private readonly _fusion: FactFusionEngine
  private readonly _ruleEngine: CoachRuleEngine
  private _timer: NodeJS.Timeout | null = null

  constructor(private readonly _scheduler?: CueSchedulerController) {
    this._fusion = new FactFusionEngine()
    this._ruleEngine = new CoachRuleEngine()
  }

  public get fusion(): FactFusionEngine {
    return this._fusion
  }

  public simulateSynchronous(session: CoachReplaySession): { totalCues: number; cues: any[] } {
    this._fusion.reset()
    const allCues: any[] = []

    for (const frame of session.frames) {
      if (frame.liveData) {
        this._fusion.updateLiveGameSnapshot(frame.liveData)
      }
      if (frame.minimap) {
        this._fusion.updateMinimapBatch(frame.minimap)
      }

      const cues = this._ruleEngine.evaluate({
        sessionId: session.metadata.sessionId,
        patch: session.metadata.patch,
        fusion: this._fusion,
        enabledCategories: {
          information: true,
          warning: true,
          opportunity: true,
          system: true,
          review: true
        }
      })

      if (cues.length > 0) {
        allCues.push(...cues)
        if (this._scheduler) {
          this._scheduler.submitCues(cues)
        }
      }
    }

    return {
      totalCues: allCues.length,
      cues: allCues
    }
  }

  public stop(): void {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    this._fusion.reset()
  }
}
