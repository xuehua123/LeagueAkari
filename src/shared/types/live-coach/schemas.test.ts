import { describe, expect, it } from 'vitest'

import {
  coachCapabilityIdSchema,
  coachCuePublicDtoSchema,
  coachCueSchema,
  coachEvidenceSchema,
  fogInferenceSchema,
  itemPurchaseGuidanceSchema,
  liveCoachCapabilityPayloadSchema,
  liveCoachPublicStateSchema,
  mainToWorkerMessageSchema,
  workerToMainMessageSchema
} from './index'

describe('live-coach schemas', () => {
  it('validates every frame envelope before the utility worker consumes its bytes', () => {
    expect(
      mainToWorkerMessageSchema.safeParse({
        type: 'frame-buffer',
        buffer: new Uint8Array(16),
        pixelFormat: 'bgra',
        width: 2,
        height: 2,
        observedAt: 1000,
        sequence: 1
      }).success
    ).toBe(true)
    expect(
      mainToWorkerMessageSchema.safeParse({
        type: 'frame-buffer',
        buffer: 'not-binary',
        pixelFormat: 'unknown',
        width: -1,
        height: 2,
        observedAt: 1000,
        sequence: 1
      }).success
    ).toBe(false)
  })

  it('validates coachEvidenceSchema correctly', () => {
    const validEvidence = {
      id: 'evi_001',
      sessionId: 'sess_123',
      temporalScope: 'current',
      source: 'minimap',
      kind: 'enemy-seen',
      confidence: 0.95,
      patch: '14.15.1',
      clock: {
        observedAt: 1700000000000,
        receivedAt: 1700000000050,
        sequence: 1
      },
      freshness: {
        expiresAt: 1700000005000,
        state: 'fresh'
      },
      payload: { championId: 103, regionId: 'top-river' }
    }

    const parsed = coachEvidenceSchema.safeParse(validEvidence)
    expect(parsed.success).toBe(true)
  })

  it('validates coachCueSchema correctly and enforces max 2 options', () => {
    const validCue = {
      id: 'cue_001',
      sessionId: 'sess_123',
      ruleId: 'rule_gank_risk',
      ruleVersion: '1.0.0',
      category: 'warning',
      priority: 80,
      observationText: '敌方打野出现在上半区河道',
      impactText: '上路可能被越塔',
      options: [
        { id: 'opt_back', label: '后撤至塔下防守', condition: null, evidenceIds: ['evi_001'] },
        { id: 'opt_ping', label: '提醒中单推线', condition: null, evidenceIds: ['evi_001'] }
      ],
      spokenText: '上半区出现敌方打野，注意撤退或交换下半区资源。',
      evidenceIds: ['evi_001'],
      createdAt: 1700000000000,
      expiresAt: 1700000004000,
      status: 'pending',
      cancellationReason: null
    }

    const parsed = coachCueSchema.safeParse(validCue)
    expect(parsed.success).toBe(true)

    // Verify >2 options fail validation
    const invalidCue = {
      ...validCue,
      options: [
        { id: '1', label: '1', condition: null, evidenceIds: [] },
        { id: '2', label: '2', condition: null, evidenceIds: [] },
        { id: '3', label: '3', condition: null, evidenceIds: [] }
      ]
    }
    const invalidParsed = coachCueSchema.safeParse(invalidCue)
    expect(invalidParsed.success).toBe(false)
  })

  it('validates worker-to-main protocol discriminated unions', () => {
    const readyMessage = {
      type: 'ready',
      protocolVersion: '1.0.0',
      runtimeVersions: { onnx: '1.18.0' },
      supportedBackends: ['wgc', 'dda']
    }
    expect(workerToMainMessageSchema.safeParse(readyMessage).success).toBe(true)

    const heartbeatMessage = {
      type: 'heartbeat',
      sequence: 42,
      captureState: 'active',
      queueDepth: 0,
      memoryBytes: 52428800
    }
    expect(workerToMainMessageSchema.safeParse(heartbeatMessage).success).toBe(true)
  })

  it('validates liveCoachCapabilityPayloadSchema', () => {
    const validPayload = {
      schemaVersion: 1,
      generation: 1,
      issuedAt: '2026-08-25T00:00:00Z',
      expiresAt: '2026-08-26T00:00:00Z',
      killSwitch: false,
      rules: [{ id: 'r1', version: '1.0', enabled: true }],
      models: {
        'minimap-v1': {
          version: '1.0.0',
          sha256: 'a'.repeat(64),
          url: 'https://example.com/m.onnx'
        }
      }
    }
    expect(liveCoachCapabilityPayloadSchema.safeParse(validPayload).success).toBe(true)
  })

  it('validates liveCoachPublicStateSchema', () => {
    const validState = {
      session: {
        id: 'sess_1',
        state: 'active',
        pauseReason: null,
        mapId: 11,
        queueId: 420,
        patch: '14.15.1',
        startedAt: 1700000000000
      },
      capability: {
        enabledFeatureIds: ['f1'],
        unavailable: {}
      },
      capture: {
        state: 'running',
        backend: 'wgc',
        fps: 30,
        frameAgeMs: 50,
        roiState: 'healthy',
        resolution: { width: 1920, height: 1080 },
        confidence: 0.95,
        lastObservationAt: 1700000000000,
        modelVersions: { minimap: '1.0.0' },
        captureLatencyMs: 12,
        inferenceLatencyMs: 20,
        dropCount: 0,
        queueDepth: 0,
        workerHeartbeatAt: 1700000000000,
        workerRestartCount: 0
      },
      liveData: {
        state: 'healthy',
        lastSuccessAt: 1700000000000,
        sourceHealth: [
          {
            domain: 'game-stats',
            state: 'healthy',
            lastSuccessAt: 1700000000000,
            lastErrorCode: null,
            consecutiveFailures: 0
          }
        ]
      },
      cue: null,
      recentCues: [],
      sessionCueStats: {
        total: 0,
        information: 0,
        warning: 0,
        opportunity: 0,
        system: 0,
        review: 0
      },
      lastSessionSummary: null,
      fogInferences: [],
      itemGuidance: null,
      cooldowns: [],
      communicationHistory: [],
      speech: {
        state: 'idle',
        cueId: null
      },
      conversation: {
        conversationId: null,
        state: 'idle',
        userTranscript: null,
        aiResponse: null
      },
      lastError: null
    }
    expect(liveCoachPublicStateSchema.safeParse(validState).success).toBe(true)
    expect(
      liveCoachPublicStateSchema.safeParse({
        ...validState,
        lastError: {
          code: 'worker-invented-code',
          stage: 'capture',
          recoverable: true,
          occurredAt: 1700000000000
        }
      }).success
    ).toBe(false)
  })

  it('validates fogInferenceSchema and itemPurchaseGuidanceSchema with strict constraints', () => {
    const validFog = {
      id: 'fog_001',
      sessionId: 'sess_1',
      enemyTrackId: 'enemy_1',
      basisEvidenceIds: ['evi_1'],
      lastSeenAt: 1700000000000,
      predictedRegions: [{ regionId: 'bot_river', probability: 0.8 }],
      candidateRoutes: [{ regionIds: ['mid', 'bot_river'], probability: 0.8 }],
      arrivalWindow: {
        earliestAt: 1700000005000,
        latestAt: 1700000015000
      },
      intents: [{ kind: 'roam' as const, probability: 0.85 }],
      confidence: 0.9,
      createdAt: 1700000000000,
      expiresAt: 1700000020000,
      modelVersion: '1.2.0'
    }
    expect(fogInferenceSchema.safeParse(validFog).success).toBe(true)

    // Verify arrivalWindow earliestAt > latestAt fails validation
    const invalidWindowFog = {
      ...validFog,
      arrivalWindow: {
        earliestAt: 1700000020000,
        latestAt: 1700000010000
      }
    }
    expect(fogInferenceSchema.safeParse(invalidWindowFog).success).toBe(false)

    // Verify negative gold fails validation
    const invalidGuidance = {
      id: 'item_1',
      sessionId: 'sess_1',
      patch: '14.15.1',
      championId: 86,
      currentGold: -50,
      inventoryItemIds: [],
      primaryPlan: {
        itemIds: [3071],
        totalCost: 3000,
        remainingGold: 0,
        missingGold: 3000,
        reasonCodes: [],
        conditions: []
      },
      alternativePlans: [],
      evidenceIds: ['evi_gold'],
      createdAt: 1700000000000,
      expiresAt: 1700000020000,
      ruleVersion: '1.0.0'
    }
    expect(itemPurchaseGuidanceSchema.safeParse(invalidGuidance).success).toBe(false)

    // Verify CoachCuePublicDto enforces max 2 options
    const invalidPublicDto = {
      id: 'cue_p_1',
      sessionId: 'sess_1',
      category: 'warning',
      priority: 50,
      observationText: 'obs',
      impactText: null,
      options: [
        { id: '1', label: '1', role: 'primary' },
        { id: '2', label: '2', role: 'alternative' },
        { id: '3', label: '3' }
      ],
      spokenText: 'text',
      createdAt: 1700000000000,
      expiresAt: 1700000005000,
      status: 'speaking'
    }
    expect(coachCuePublicDtoSchema.safeParse(invalidPublicDto).success).toBe(false)
  })

  it('validates coachCapabilityIdSchema includes coach.analyze.minimap-identity', () => {
    expect(coachCapabilityIdSchema.safeParse('coach.analyze.minimap-identity').success).toBe(true)
    expect(coachCapabilityIdSchema.options).toContain('coach.analyze.minimap-identity')
  })
})
