import { describe, expect, it } from 'vitest'

import { resolveLiveCoachGameflowContext } from './gameflow-context'

describe('resolveLiveCoachGameflowContext', () => {
  it("keeps an explicitly reported Summoner's Rift custom queue", () => {
    expect(
      resolveLiveCoachGameflowContext({
        map: { id: 11, gameMode: 'CLASSIC' },
        gameData: {
          isCustomGame: true,
          queue: { id: 0, isCustom: true, gameMode: 'CLASSIC', mapId: 11 }
        }
      } as any)
    ).toEqual({ mapId: 11, queueId: 0, gameMode: 'CLASSIC', isCustomGame: true })
  })

  it('recovers queue 0 from the custom-game flag while the queue object is incomplete', () => {
    expect(
      resolveLiveCoachGameflowContext({
        map: { id: 11, gameMode: 'CLASSIC' },
        gameData: { isCustomGame: true }
      } as any)
    ).toEqual({ mapId: 11, queueId: 0, gameMode: 'CLASSIC', isCustomGame: true })
  })

  it('recognizes Practice Tool and falls back to the queue map id', () => {
    expect(
      resolveLiveCoachGameflowContext({
        gameData: {
          isCustomGame: false,
          queue: { id: -1, isCustom: true, gameMode: 'PRACTICETOOL', mapId: 11 }
        }
      } as any)
    ).toEqual({ mapId: 11, queueId: 0, gameMode: 'PRACTICETOOL', isCustomGame: true })
  })

  it('does not mistake a tutorial for a supported custom game even when it reports queue 0', () => {
    expect(
      resolveLiveCoachGameflowContext({
        map: { id: 11, gameMode: 'TUTORIAL' },
        gameData: { isCustomGame: true, queue: { id: 0, isCustom: true } }
      } as any)
    ).toEqual({ mapId: 11, queueId: null, gameMode: 'TUTORIAL', isCustomGame: true })
  })

  it('leaves an unresolved unknown custom mode fail-closed', () => {
    expect(
      resolveLiveCoachGameflowContext({
        map: { id: 11 },
        gameData: { isCustomGame: true }
      } as any)
    ).toEqual({ mapId: 11, queueId: null, gameMode: null, isCustomGame: true })
  })

  it('rejects an explicit custom queue when no supported mode is reported', () => {
    expect(
      resolveLiveCoachGameflowContext({
        map: { id: 11 },
        gameData: { isCustomGame: true, queue: { id: 0, isCustom: true } }
      } as any)
    ).toEqual({ mapId: 11, queueId: null, gameMode: null, isCustomGame: true })
  })

  it('preserves a normal matchmaking queue', () => {
    expect(
      resolveLiveCoachGameflowContext({
        map: { id: 11, gameMode: 'CLASSIC' },
        gameData: {
          isCustomGame: false,
          queue: { id: 420, isCustom: false, gameMode: 'CLASSIC', mapId: 11 }
        }
      } as any)
    ).toEqual({ mapId: 11, queueId: 420, gameMode: 'CLASSIC', isCustomGame: false })
  })
})
