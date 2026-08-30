import type {
  CoachCooldownRecord,
  CoachCuePublicDto,
  CoachPublicError,
  FogInference,
  ItemPurchaseGuidance
} from '@shared/types/live-coach'
import { describe, expect, it } from 'vitest'

import { buildOverlayFeed } from '.'

const NOW = 1_000_000
const SESSION_ID = 'session-1'

function cue(overrides: Partial<CoachCuePublicDto> = {}): CoachCuePublicDto {
  return {
    id: 'cue-1',
    sessionId: SESSION_ID,
    category: 'warning',
    priority: 80,
    observationText: '敌方打野正在靠近',
    impactText: null,
    options: [{ id: 'option-1', label: '先退到塔下', role: 'primary' }],
    spokenText: '先退到塔下，等待队友',
    createdAt: NOW - 1_000,
    expiresAt: NOW + 8_000,
    status: 'speaking',
    ...overrides
  }
}

function cooldown(overrides: Partial<CoachCooldownRecord> = {}): CoachCooldownRecord {
  return {
    id: 'cooldown-1',
    sessionId: SESSION_ID,
    kind: 'summoner-spell',
    label: '敌方闪现',
    ownerTeam: 'enemy',
    championId: 1,
    source: 'visible-screen',
    confidence: 0.9,
    observedAt: NOW - 2_000,
    earliestReadyAt: NOW + 40_000,
    latestReadyAt: NOW + 45_000,
    status: 'running',
    evidenceIds: [],
    ...overrides
  }
}

function fog(overrides: Partial<FogInference> = {}): FogInference {
  return {
    id: 'fog-1',
    sessionId: SESSION_ID,
    enemyTrackId: 'enemy-1',
    basisEvidenceIds: [],
    lastSeenAt: NOW - 2_000,
    predictedRegions: [{ regionId: 'top_river', probability: 0.72 }],
    candidateRoutes: [],
    arrivalWindow: null,
    intents: [],
    confidence: 0.72,
    createdAt: NOW - 1_000,
    expiresAt: NOW + 10_000,
    modelVersion: 'test',
    ...overrides
  }
}

function item(overrides: Partial<ItemPurchaseGuidance> = {}): ItemPurchaseGuidance {
  return {
    id: 'item-1',
    sessionId: SESSION_ID,
    patch: '1.0',
    championId: 1,
    mode: 'adaptive',
    currentGold: 800,
    inventoryItemIds: [],
    primaryPlan: {
      itemIds: [1001],
      totalCost: 1_100,
      remainingGold: 0,
      missingGold: 300,
      reasonCodes: [],
      conditions: ['回城补核心装备']
    },
    alternativePlans: [],
    evidenceIds: [],
    createdAt: NOW - 1_000,
    expiresAt: NOW + 10_000,
    ruleVersion: 'test',
    ...overrides
  }
}

function error(overrides: Partial<CoachPublicError> = {}): CoachPublicError {
  return {
    code: 'capture-stalled',
    stage: 'capture',
    recoverable: true,
    occurredAt: NOW - 1_000,
    ...overrides
  }
}

function buildInput(
  overrides: Partial<Parameters<typeof buildOverlayFeed>[0]> = {}
): Parameters<typeof buildOverlayFeed>[0] {
  return {
    now: NOW,
    sessionId: SESSION_ID,
    currentCue: null,
    recentCues: [],
    cooldowns: [],
    fogInferences: [],
    itemGuidance: null,
    lastError: null,
    ...overrides
  }
}

describe('buildOverlayFeed', () => {
  it('uses the primary action and keeps history out while a current cue is active', () => {
    const currentCue = cue()
    const rows = buildOverlayFeed(
      buildInput({ currentCue, recentCues: [currentCue, cue({ id: 'cue-old' })] })
    )

    expect(rows.filter((row) => row.kind === 'cue')).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'cue',
      id: 'cue:cue-1',
      message: '先退到塔下',
      current: true
    })
  })

  it('falls back to the highest-priority unexpired recent cue', () => {
    const rows = buildOverlayFeed(
      buildInput({
        recentCues: [
          cue({ id: 'newer', priority: 20, createdAt: NOW - 100 }),
          cue({ id: 'important', priority: 90, createdAt: NOW - 2_000 })
        ]
      })
    )

    expect(rows[0]).toMatchObject({
      kind: 'cue',
      id: 'cue:important',
      current: false
    })
  })

  it('filters expired and cross-session tactical data', () => {
    const rows = buildOverlayFeed(
      buildInput({
        currentCue: cue({ expiresAt: NOW - 1 }),
        recentCues: [cue({ id: 'other-cue', sessionId: 'other-session' })],
        cooldowns: [cooldown({ sessionId: 'other-session' })],
        fogInferences: [fog({ expiresAt: NOW - 1 })],
        itemGuidance: item({ sessionId: 'other-session' })
      })
    )

    expect(rows).toEqual([])
  })

  it('combines the two most useful cooldowns into one compact row', () => {
    const rows = buildOverlayFeed(
      buildInput({
        cooldowns: [
          cooldown({ id: 'ward', kind: 'ward', earliestReadyAt: NOW + 5_000 }),
          cooldown({
            id: 'dragon',
            kind: 'objective',
            label: '小龙',
            earliestReadyAt: NOW + 90_000
          }),
          cooldown({ id: 'flash', earliestReadyAt: NOW + 30_000 })
        ]
      })
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'cooldown:flash:ward',
      kind: 'cooldown'
    })
    expect(rows[0]?.kind === 'cooldown' && rows[0].cooldowns.map(({ id }) => id)).toEqual([
      'flash',
      'ward'
    ])
  })

  it('prioritizes an active error and caps the high-density feed', () => {
    const rows = buildOverlayFeed(
      buildInput({
        currentCue: cue(),
        cooldowns: [cooldown()],
        fogInferences: [fog()],
        itemGuidance: item(),
        lastError: error(),
        maxRows: 3
      })
    )

    expect(rows).toHaveLength(3)
    expect(rows[0].kind).toBe('error')
    expect(rows.map((row) => row.kind)).toEqual(['error', 'cue', 'cooldown'])
  })

  it('keeps an uncleared error visible and drops low-confidence fog guesses', () => {
    const rows = buildOverlayFeed(
      buildInput({
        lastError: error({ occurredAt: NOW - 30_001 }),
        fogInferences: [fog({ confidence: 0.54 })],
        itemGuidance: item()
      })
    )

    expect(rows.map((row) => row.kind)).toEqual(['error', 'item'])
  })
})
