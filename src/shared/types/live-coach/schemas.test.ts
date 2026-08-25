import { describe, expect, it } from 'vitest'

import {
  coachCueSchema,
  coachEvidenceSchema,
  liveCoachCapabilityPayloadSchema,
  liveCoachPublicStateSchema,
  workerToMainMessageSchema
} from './index'

describe('live-coach schemas', () => {
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
          sha256: 'abc123def456',
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
        roiState: 'healthy'
      },
      liveData: {
        state: 'healthy',
        lastSuccessAt: 1700000000000
      },
      cue: null,
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
  })
})
