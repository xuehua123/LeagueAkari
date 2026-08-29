import { describe, expect, it } from 'vitest'

import {
  getReplayCapabilityStatus,
  importVideoReplayRequestSchema,
  replaySelectedFileGrantSchema
} from './replay'

describe('replay local-file grant IPC contracts', () => {
  it('accepts only bounded opaque descriptors without renderer-visible paths', () => {
    const token = 'A'.repeat(43)
    expect(
      replaySelectedFileGrantSchema.parse({
        token,
        displayName: 'match.mp4',
        purpose: 'video',
        expiresAt: Date.now() + 60_000
      })
    ).toMatchObject({ token, displayName: 'match.mp4', purpose: 'video' })

    expect(() =>
      replaySelectedFileGrantSchema.parse({
        token: 'short',
        displayName: 'C:\\private\\match.mp4',
        purpose: 'video',
        expiresAt: Number.MAX_SAFE_INTEGER + 1
      })
    ).toThrow()
  })

  it('rejects path-shaped and extra IPC fields at the import boundary', () => {
    const token = 'B'.repeat(43)
    expect(importVideoReplayRequestSchema.parse({ sourceToken: token })).toEqual({
      sourceToken: token
    })
    expect(() =>
      importVideoReplayRequestSchema.parse({
        sourceToken: token,
        videoPath: 'C:\\private\\match.mp4'
      })
    ).toThrow()
  })
})

describe('getReplayCapabilityStatus', () => {
  it('returns stable locale-neutral reason codes for missing replay context', () => {
    const status = getReplayCapabilityStatus(
      {
        patch: null,
        mapId: null,
        queueId: null,
        selfTeam: null,
        selfChampionId: null,
        minimapSide: null,
        videoGameStartMs: null,
        roster: null
      },
      false
    )

    expect(status.missingFields).toEqual([
      'patch',
      'mapId',
      'selfTeam',
      'selfChampionId',
      'roster',
      'videoGameStartMs'
    ])
    expect(status.disabled.map((item) => item.reason)).toEqual([
      'requires-summoners-rift-and-team',
      'requires-patch-team-roster-and-validated-model',
      'requires-self-champion-team-roster-and-position',
      'requires-structured-sidecar'
    ])
  })

  it('disables untimed sidecar events until an explicit game-time mapping exists', () => {
    const metadata = {
      patch: '16.16.1',
      mapId: 11,
      queueId: 420,
      selfTeam: 'blue' as const,
      selfChampionId: 86,
      minimapSide: 'right' as const,
      videoGameStartMs: null,
      roster: [{ team: 'blue' as const, championId: 86 }]
    }

    expect(getReplayCapabilityStatus(metadata, true).disabled).toContainEqual({
      capability: 'sidecar-dependent-rules',
      reason: 'requires-sidecar-time-alignment'
    })
    expect(getReplayCapabilityStatus(metadata, true, true).available).toContain('sidecar-events')
    expect(
      getReplayCapabilityStatus({ ...metadata, videoGameStartMs: 12_000 }, true).available
    ).toContain('sidecar-events')
  })
})
