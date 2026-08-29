import { describe, expect, it } from 'vitest'

import { FactFusionEngine } from './fact-fusion'
import { RuleHighPriorityMinimapChange } from './map-change-guidance-controller'

describe('RuleHighPriorityMinimapChange', () => {
  it('turns a fresh derived grouping event into one evidence-backed cue', () => {
    const now = 1_700_000_000_000
    const fusion = new FactFusionEngine()
    fusion.updateMinimapBatch(
      {
        sessionId: 'session-map-change',
        patch: '16.16.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 0 },
        health: 'healthy',
        entities: [],
        events: [
          {
            eventId: 'group-bot-river-1',
            kind: 'enemy-grouping-started',
            timestamp: now,
            payload: { regionId: 'bot_river', count: 3 }
          }
        ]
      },
      now
    )
    const rule = new RuleHighPriorityMinimapChange()
    const context = {
      sessionId: 'session-map-change',
      patch: '16.16.1',
      fusion,
      enabledCategories: { warning: true },
      enabledCapabilities: new Set(['coach.analyze.minimap-advanced']),
      currentTime: now
    }

    const cue = rule.evaluate(context)

    expect(cue).toMatchObject({
      id: 'cue_map_change_group-bot-river-1',
      priority: 78,
      observationText: expect.stringContaining('下半河道')
    })
    expect(cue?.spokenText).not.toContain('bot_river')
    expect(cue?.evidenceIds).toEqual(['evi_minimap_event_group-bot-river-1'])
    expect(rule.evaluate(context)).toBeNull()
  })

  it('does not emit when the advanced minimap capability is unavailable', () => {
    const fusion = new FactFusionEngine()
    const rule = new RuleHighPriorityMinimapChange()

    expect(
      rule.evaluate({
        sessionId: 'session-map-change',
        patch: '16.16.1',
        fusion,
        enabledCategories: { warning: true },
        enabledCapabilities: new Set(),
        currentTime: 1000
      })
    ).toBeNull()
  })
})
