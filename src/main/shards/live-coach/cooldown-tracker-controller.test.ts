import { describe, expect, it, vi } from 'vitest'

import { CooldownTrackerController } from './cooldown-tracker-controller'

function createContext() {
  let cooldowns: unknown[] = []
  return {
    state: {
      session: {
        id: 'session-cooldown',
        state: 'active',
        patch: '16.16.1'
      },
      setCooldowns: vi.fn((value) => {
        cooldowns = value
      })
    },
    getCooldowns: () => cooldowns
  } as any
}

describe('CooldownTrackerController', () => {
  it('records user-confirmed cooldowns with source, uncertainty and evidence', () => {
    const context = createContext()
    const controller = new CooldownTrackerController(context)
    const onEvidence = vi.fn()
    controller.onEvidence = onEvidence
    const now = 1_700_010_000_000

    const record = controller.recordUserCooldown(
      {
        kind: 'summoner-spell',
        label: '敌方闪现',
        ownerTeam: 'enemy',
        championId: 103,
        durationSeconds: 300,
        uncertaintySeconds: 5
      },
      now
    )

    expect(record.source).toBe('user-recorded')
    expect(record.earliestReadyAt).toBe(now + 295_000)
    expect(record.latestReadyAt).toBe(now + 305_000)
    expect(record.confidence).toBeLessThan(1)
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'user-input',
        kind: 'cooldown-timing',
        payload: expect.objectContaining({ id: record.id })
      })
    )
    expect(context.state.setCooldowns).toHaveBeenCalled()
  })

  it('creates one exact official objective timer per unique event', () => {
    const context = createContext()
    const controller = new CooldownTrackerController(context)
    const onEvidence = vi.fn()
    controller.onEvidence = onEvidence
    const now = 1_700_020_000_000
    const snapshot = {
      sessionId: 'session-cooldown',
      patch: '16.16.1',
      gameTimeSeconds: 650,
      activePlayer: null,
      players: [],
      events: [
        {
          eventId: 12,
          eventTime: 600,
          eventName: 'DragonKill',
          payload: { DragonType: 'Infernal' }
        }
      ],
      sourceHealth: [],
      clock: { observedAt: now, receivedAt: now, sequence: 3 }
    }

    controller.syncFromSnapshot(snapshot, now)
    controller.syncFromSnapshot(snapshot, now + 1000)

    const records = controller.list(now)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'objective',
      label: '巨龙',
      source: 'official-api',
      confidence: 1,
      earliestReadyAt: now + 250_000,
      latestReadyAt: now + 250_000
    })
    expect(onEvidence).toHaveBeenCalledTimes(1)
  })

  it('marks elapsed records ready, supports cancellation and clears on reset', () => {
    const context = createContext()
    const controller = new CooldownTrackerController(context)
    const now = 1_700_030_000_000
    const record = controller.recordUserCooldown(
      {
        kind: 'ward',
        label: '河道眼位',
        ownerTeam: 'enemy',
        durationSeconds: 2
      },
      now
    )

    expect(controller.list(now + 2500)[0]?.status).toBe('ready')
    expect(controller.cancel(record.id, now + 3000)).toBe(true)
    expect(controller.list(now + 3000)).toHaveLength(0)

    controller.recordUserCooldown(
      {
        kind: 'ability',
        label: '关键控制',
        ownerTeam: 'enemy',
        durationSeconds: 8
      },
      now + 4000
    )
    controller.reset()
    expect(controller.list(now + 4000)).toHaveLength(0)
  })

  it('does not invent respawn timers for one-shot Herald or Elder events', () => {
    const context = createContext()
    const controller = new CooldownTrackerController(context)
    const now = 1_700_040_000_000
    const baseSnapshot = {
      sessionId: 'session-cooldown',
      patch: '16.16.1',
      gameTimeSeconds: 1_000,
      activePlayer: null,
      players: [],
      sourceHealth: [],
      clock: { observedAt: now, receivedAt: now, sequence: 4 }
    }

    controller.syncFromSnapshot(
      {
        ...baseSnapshot,
        events: [
          { eventId: 20, eventTime: 900, eventName: 'HeraldKill', payload: {} },
          {
            eventId: 21,
            eventTime: 950,
            eventName: 'DragonKill',
            payload: { DragonType: 'Elder' }
          }
        ]
      },
      now
    )

    expect(controller.list(now)).toEqual([])
  })
})
