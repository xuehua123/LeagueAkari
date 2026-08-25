import { describe, expect, it } from 'vitest'

import { FactFusionEngine } from './fact-fusion'
import { CoachRuleEngine } from './rule-engine'

describe('CoachRuleEngine & Spatial Clustering', () => {
  it('correctly triggers enemy grouping only when enemies are spatially clustered', () => {
    const fusion = new FactFusionEngine()
    const engine = new CoachRuleEngine()
    const now = Date.now()

    // 1. 三个敌人分散在全图（距离 > 0.18），不应触发聚集
    fusion.updateMinimapBatch({
      sessionId: 'sess_1',
      patch: '14.15.1',
      calibrationVersion: '1.0.0',
      modelVersions: {},
      frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 20 },
      health: 'healthy',
      entities: [
        {
          trackId: 'e1',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.1, y: 0.1 }, // 上路
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        },
        {
          trackId: 'e2',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.5, y: 0.5 }, // 中路
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        },
        {
          trackId: 'e3',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.9, y: 0.9 }, // 下路
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ],
      events: []
    })

    let cues = engine.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true }
    })
    expect(cues.find((c) => c.ruleId === 'rule_minimap_enemy_grouping')).toBeUndefined()

    // 2. 三个敌人在局部聚集（距离 < 0.18），应该触发聚集预警并包含正确的 Evidence ID
    fusion.updateMinimapBatch({
      sessionId: 'sess_1',
      patch: '14.15.1',
      calibrationVersion: '1.0.0',
      modelVersions: {},
      frame: { observedAt: now + 100, receivedAt: now + 100, sequence: 2, ageMs: 20 },
      health: 'healthy',
      entities: [
        {
          trackId: 'e1',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.5, y: 0.5 },
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        },
        {
          trackId: 'e2',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.53, y: 0.52 },
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        },
        {
          trackId: 'e3',
          kind: 'enemy',
          team: 'enemy',
          championId: null,
          point: { x: 0.51, y: 0.49 },
          regionId: null,
          confidence: 0.95,
          lifecycle: 'confirmed',
          firstObservedAt: now,
          lastObservedAt: now,
          expiresAt: now + 5000
        }
      ],
      events: []
    })

    cues = engine.evaluate({
      sessionId: 'sess_1',
      patch: '14.15.1',
      fusion,
      enabledCategories: { warning: true, information: true, opportunity: true }
    })
    const groupingCue = cues.find((c) => c.ruleId === 'rule_minimap_enemy_grouping')
    expect(groupingCue).toBeDefined()
    expect(groupingCue?.evidenceIds.length).toBe(3)
    // 验证 Evidence 链可以被准确检索到
    for (const eviId of groupingCue!.evidenceIds) {
      expect(fusion.getEvidence(eviId)).toBeDefined()
    }
  })
})
