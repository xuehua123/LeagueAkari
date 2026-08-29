import { MinimapObservationBatch } from '@shared/types/live-coach'
import { describe, expect, it } from 'vitest'

import { FactFusionEngine } from './fact-fusion'

function createBatch(
  now: number,
  entities: MinimapObservationBatch['entities']
): MinimapObservationBatch {
  return {
    sessionId: 'session-1',
    patch: '16.16.1',
    calibrationVersion: '1.0.0',
    modelVersions: {},
    frame: { observedAt: now, receivedAt: now, sequence: now, ageMs: 0 },
    health: 'healthy',
    entities,
    events: []
  }
}

describe('FactFusionEngine evidence freshness', () => {
  it('keeps one-frame candidate tracks out of formal evidence and fog inference', () => {
    const fusion = new FactFusionEngine()
    const now = 1_700_000_000_000

    fusion.updateMinimapBatch(
      createBatch(now, [
        {
          trackId: 'enemy-candidate',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.5, y: 0.5 },
          regionId: 'mid_lane',
          confidence: 0.85,
          lifecycle: 'candidate',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ]),
      now
    )

    expect(fusion.getMinimapEntities(now)).toEqual([])
    expect(fusion.getMinimapEvidenceId('enemy-candidate', now)).toBeNull()

    fusion.updateMinimapBatch(createBatch(now + 4000, []), now + 4000)
    expect(fusion.getFogInferences(now + 4000)).toEqual([])
  })

  it('resolves the active player team from the player list when activePlayer omits it', () => {
    const fusion = new FactFusionEngine()
    const now = 1_700_000_000_000
    fusion.updateLiveGameSnapshot(
      {
        sessionId: 'session-1',
        patch: 'unknown',
        gameTimeSeconds: 60,
        activePlayer: {
          summonerName: '',
          riotId: 'Player#CN1',
          riotIdGameName: 'Player',
          riotIdTagLine: 'CN1',
          championName: 'Garen',
          level: 3,
          currentGold: 500,
          team: 'UNKNOWN',
          abilities: {}
        },
        players: [
          {
            summonerName: '',
            riotId: 'Player#CN1',
            riotIdGameName: 'Player',
            riotIdTagLine: 'CN1',
            championName: 'Garen',
            championId: 86,
            team: 'ORDER',
            position: 'TOP',
            items: []
          }
        ],
        events: [],
        sourceHealth: [],
        clock: { observedAt: now, receivedAt: now, sequence: 1 }
      } as any,
      now
    )

    expect(fusion.getActivePlayer()).toMatchObject({ riotId: 'Player#CN1', team: 'ORDER' })
  })

  it('does not expose expired minimap entities or their evidence IDs', () => {
    const fusion = new FactFusionEngine()
    const now = 1_700_000_000_000
    fusion.updateMinimapBatch(
      createBatch(now, [
        {
          trackId: 'enemy-1',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.5, y: 0.5 },
          regionId: 'mid_lane',
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 1000
        }
      ]),
      now
    )

    expect(fusion.getMinimapEntities(now + 999)).toHaveLength(1)
    expect(fusion.getMinimapEvidenceId('enemy-1', now + 999)).not.toBeNull()
    expect(fusion.getMinimapEntities(now + 1000)).toEqual([])
    expect(fusion.getMinimapEvidenceId('enemy-1', now + 1000)).toBeNull()
  })

  it('keeps one stable minimap evidence per confirmed track across frames', () => {
    const fusion = new FactFusionEngine()
    const now = 1_700_000_000_000
    const makeEntity = (observedAt: number, x: number) => ({
      trackId: 'enemy-stable',
      kind: 'enemy' as const,
      team: 'enemy' as const,
      championId: 238,
      point: { x, y: 0.5 },
      regionId: 'mid_lane',
      confidence: 0.95,
      lifecycle: 'confirmed' as const,
      firstObservedAt: now,
      lastObservedAt: observedAt,
      expiresAt: observedAt + 5000
    })

    fusion.updateMinimapBatch(createBatch(now, [makeEntity(now, 0.45)]), now)
    fusion.updateMinimapBatch(createBatch(now + 100, [makeEntity(now + 100, 0.5)]), now + 100)

    expect(fusion.getMinimapEvidenceId('enemy-stable', now + 100)).toBe('evi_minimap_enemy-stable')
    expect(
      fusion
        .getActiveEvidences(now + 100)
        .filter((evidence) => evidence.source === 'minimap' && evidence.kind === 'enemy-seen')
    ).toHaveLength(1)
    expect(fusion.getEvidence('evi_minimap_enemy-stable', now + 100)?.payload).toMatchObject({
      point: { x: 0.5, y: 0.5 }
    })
  })

  it('updates one stable fog evidence per last-seen episode instead of creating one per tick', () => {
    const fusion = new FactFusionEngine()
    const now = 1_700_000_000_000
    fusion.updateMinimapBatch(
      createBatch(now, [
        {
          trackId: 'enemy-1',
          kind: 'enemy',
          team: 'enemy',
          championId: 238,
          point: { x: 0.5, y: 0.5 },
          regionId: 'mid_lane',
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ]),
      now
    )

    for (let offset = 3000; offset <= 4000; offset += 100) {
      fusion.updateMinimapBatch(createBatch(now + offset, []), now + offset)
    }

    const fogEvidence = fusion
      .getActiveEvidences(now + 4000)
      .filter((evidence) => evidence.source === 'fog-inference')
    expect(fogEvidence).toHaveLength(1)
    expect(fogEvidence[0].id).toBe(`evi_fog_enemy-1_${now}`)
  })

  it('uses both horizontal and vertical movement when inferring a mid-lane roam direction', () => {
    const fusion = new FactFusionEngine()
    const now = 1_700_000_000_000
    const makeEnemy = (observedAt: number, x: number, y: number) => ({
      trackId: 'enemy-horizontal-roam',
      kind: 'enemy' as const,
      team: 'enemy' as const,
      championId: 238,
      point: { x, y },
      regionId: 'mid_lane',
      confidence: 0.95,
      lifecycle: 'confirmed' as const,
      firstObservedAt: now,
      lastObservedAt: observedAt,
      expiresAt: observedAt + 5000
    })

    fusion.updateMinimapBatch(createBatch(now, [makeEnemy(now, 0.45, 0.5)]), now)
    fusion.updateMinimapBatch(
      createBatch(now + 1000, [makeEnemy(now + 1000, 0.47, 0.5)]),
      now + 1000
    )
    fusion.updateMinimapBatch(createBatch(now + 4000, []), now + 4000)

    expect(fusion.getFogInferences(now + 4000)[0]?.predictedRegions[0]).toEqual({
      regionId: 'bot_river',
      probability: 0.65
    })
  })

  it('lets fog confidence fall below the alert threshold as last-seen data ages', () => {
    const fusion = new FactFusionEngine()
    const now = 1_700_000_000_000
    fusion.updateMinimapBatch(
      createBatch(now, [
        {
          trackId: 'enemy-aging',
          kind: 'enemy',
          team: 'enemy',
          championId: 238,
          point: { x: 0.5, y: 0.5 },
          regionId: 'mid_lane',
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ]),
      now
    )

    fusion.updateMinimapBatch(createBatch(now + 20_000, []), now + 20_000)

    expect(fusion.getFogInferences(now + 20_000)[0]?.confidence).toBeLessThan(0.65)
  })

  it('stops producing and clears fog predictions when the independent feature is disabled', () => {
    const fusion = new FactFusionEngine()
    const now = 1_700_000_000_000
    fusion.updateMinimapBatch(
      createBatch(now, [
        {
          trackId: 'enemy-disabled-fog',
          kind: 'enemy',
          team: 'enemy',
          championId: 238,
          point: { x: 0.5, y: 0.5 },
          regionId: 'mid_lane',
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ]),
      now
    )
    fusion.updateMinimapBatch(createBatch(now + 3000, []), now + 3000)
    expect(fusion.getFogInferences(now + 3000)).toHaveLength(1)

    fusion.configureFogInference(false)
    fusion.updateMinimapBatch(createBatch(now + 4000, []), now + 4000)

    expect(fusion.getFogInferences(now + 4000)).toEqual([])
    expect(
      fusion
        .getActiveEvidences(now + 4000)
        .filter((evidence) => evidence.source === 'fog-inference')
    ).toEqual([])
    expect(fusion.getMinimapEvidenceId('enemy-disabled-fog', now + 4000)).not.toBeNull()
  })

  it('invalidates minimap and fog state as soon as the observation source becomes unhealthy', () => {
    const invalidated: string[][] = []
    const fusion = new FactFusionEngine()
    fusion.onEvidenceInvalidated = (ids) => invalidated.push(ids)
    const now = 1_700_000_000_000

    fusion.updateMinimapBatch(
      createBatch(now, [
        {
          trackId: 'enemy-1',
          kind: 'enemy',
          team: 'enemy',
          championId: 238,
          point: { x: 0.5, y: 0.5 },
          regionId: 'mid_lane',
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ]),
      now
    )
    fusion.updateMinimapBatch(createBatch(now + 3000, []), now + 3000)
    expect(fusion.getFogInferences(now + 3000)).toHaveLength(1)

    fusion.updateMinimapBatch({ ...createBatch(now + 3100, []), health: 'degraded' }, now + 3100)

    expect(fusion.getFogInferences(now + 3100)).toEqual([])
    expect(fusion.getMinimapEntities(now + 3100)).toEqual([])
    expect(fusion.getMinimapEvidenceId('enemy-1', now + 3100)).toBeNull()
    expect(invalidated.flat()).toEqual(
      expect.arrayContaining(['evi_minimap_enemy-1', `evi_fog_enemy-1_${now}`])
    )
  })

  it('withdraws fog evidence and notifies the scheduler when the prediction horizon expires', () => {
    const invalidated: string[][] = []
    const fusion = new FactFusionEngine()
    fusion.onEvidenceInvalidated = (ids) => invalidated.push(ids)
    const now = 1_700_000_000_000

    fusion.updateMinimapBatch(
      createBatch(now, [
        {
          trackId: 'enemy-expiring',
          kind: 'enemy',
          team: 'enemy',
          championId: 238,
          point: { x: 0.5, y: 0.5 },
          regionId: 'mid_lane',
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ]),
      now
    )
    fusion.updateMinimapBatch(createBatch(now + 3000, []), now + 3000)
    expect(fusion.getFogInferences(now + 3000)).toHaveLength(1)

    fusion.updateMinimapBatch(createBatch(now + 30_001, []), now + 30_001)

    expect(fusion.getFogInferences(now + 30_001)).toEqual([])
    expect(fusion.getMinimapEvidenceId('enemy-expiring', now + 30_001)).toBeNull()
    expect(invalidated.flat()).toEqual(
      expect.arrayContaining([`evi_fog_enemy-expiring_${now}`, 'evi_minimap_enemy-expiring'])
    )
  })

  it('labels ally minimap evidence as ally-seen', () => {
    const fusion = new FactFusionEngine()
    const now = 1_700_000_000_000
    fusion.updateMinimapBatch(
      createBatch(now, [
        {
          trackId: 'ally-1',
          kind: 'ally',
          team: 'ally',
          championId: 103,
          point: { x: 0.4, y: 0.4 },
          regionId: 'mid_lane',
          confidence: 0.9,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ]),
      now
    )

    expect(fusion.getActiveEvidences(now)).toEqual([
      expect.objectContaining({ source: 'minimap', kind: 'ally-seen' })
    ])
  })

  it('uses the supplied virtual clock when pruning replay evidence', () => {
    const fusion = new FactFusionEngine()
    const replayNow = 1000
    for (let index = 0; index < 121; index++) {
      fusion.addEvidence({
        id: `evidence-${index}`,
        sessionId: 'replay',
        temporalScope: 'recorded',
        source: 'minimap-replay',
        kind: 'test',
        confidence: 1,
        patch: '16.16.1',
        clock: { observedAt: replayNow, receivedAt: replayNow, sequence: index },
        freshness: { expiresAt: replayNow + 1000, state: 'fresh' },
        payload: null
      })
    }

    expect(fusion.getActiveEvidences(replayNow + 999)).toHaveLength(121)
    expect(fusion.getActiveEvidences(replayNow + 1000)).toHaveLength(0)
  })
})
