import { CoachReplaySession } from '@shared/types/live-coach'
import { describe, expect, it } from 'vitest'

import { CoachReplaySimulator } from './replay-simulator'

describe('CoachReplaySimulator', () => {
  it('correctly replays a chronological session fixture and generates cues', () => {
    const simulator = new CoachReplaySimulator()
    const now = Date.now()

    const mockSession: CoachReplaySession = {
      metadata: {
        sessionId: 'test_replay_001',
        patch: '14.15.1',
        recordedAt: now,
        durationSeconds: 120,
        mapId: 11,
        queueId: 420
      },
      frames: [
        {
          timestamp: 1000,
          liveData: {
            sessionId: 'test_replay_001',
            patch: '14.15.1',
            gameTimeSeconds: 120,
            activePlayer: {
              summonerName: 'AkariPlayer',
              riotId: 'AkariPlayer#CN1',
              riotIdGameName: 'AkariPlayer',
              riotIdTagLine: 'CN1',
              championName: 'Ahri',
              level: 3,
              currentGold: 450,
              team: 'ORDER',
              abilities: {},
              runes: {}
            },
            players: [],
            events: [],
            sourceHealth: [],
            clock: {
              observedAt: now,
              receivedAt: now,
              sequence: 1
            }
          }
        },
        {
          timestamp: 2000,
          minimap: {
            sessionId: 'test_replay_001',
            patch: '14.15.1',
            calibrationVersion: '1.0.0',
            modelVersions: {},
            frame: {
              observedAt: 2000,
              receivedAt: 2000,
              sequence: 1,
              ageMs: 25
            },
            health: 'healthy',
            entities: [
              {
                trackId: 'enemy_1',
                kind: 'enemy',
                team: 'enemy',
                championId: null,
                point: { x: 0.5, y: 0.5 },
                regionId: null,
                confidence: 0.95,
                lifecycle: 'confirmed',
                firstObservedAt: now - 5000,
                lastObservedAt: now,
                expiresAt: now + 5000
              },
              {
                trackId: 'enemy_2',
                kind: 'enemy',
                team: 'enemy',
                championId: null,
                point: { x: 0.51, y: 0.51 },
                regionId: null,
                confidence: 0.92,
                lifecycle: 'confirmed',
                firstObservedAt: now - 5000,
                lastObservedAt: now,
                expiresAt: now + 5000
              },
              {
                trackId: 'enemy_3',
                kind: 'enemy',
                team: 'enemy',
                championId: null,
                point: { x: 0.52, y: 0.49 },
                regionId: null,
                confidence: 0.9,
                lifecycle: 'confirmed',
                firstObservedAt: now - 5000,
                lastObservedAt: now,
                expiresAt: now + 5000
              }
            ],
            events: []
          }
        }
      ]
    }

    const result = simulator.simulateSynchronous(mockSession)
    expect(result.totalCues).toBeGreaterThan(0)
    expect(result.cues[0].category).toBe('warning')
    expect(result.cues[0].spokenText).toContain('注意')
  })
})
