import { describe, expect, it } from 'vitest'

import { buildLiveCoachAcceptanceReport } from './acceptance-report'
import { createLiveCoachLocalDataExport, liveCoachLocalDataExportSchema } from './local-data-export'
import { LiveCoachSettings, LiveCoachState } from './state'

describe('createLiveCoachLocalDataExport', () => {
  it('includes every locally deleted coach-data group through a privacy-safe allowlist', () => {
    const state = createPopulatedState()
    const settings = new LiveCoachSettings()
    settings.manualCalibration = {
      schemaVersion: 1,
      id: 'calibration-1',
      fingerprintHash: 'fingerprint-hash',
      roi: { x: 0.7, y: 0.7, width: 0.2, height: 0.2 },
      transform: 'blue-normal',
      source: 'manual',
      confidence: 1,
      createdAt: 20
    }
    const acceptance = buildLiveCoachAcceptanceReport({
      sessions: [],
      offlineRecords: [],
      feedback: [],
      generatedAt: 222
    })
    const feedback = [
      {
        id: 'feedback-1',
        cueId: 'cue-1',
        sessionId: 'session-1',
        ruleId: 'rule-1',
        ruleVersion: '1',
        evidenceIds: ['evidence-1'],
        type: 'useful' as const,
        comment: 'user-owned export text',
        status: 'active' as const,
        createdAt: 30,
        withdrawnAt: null
      }
    ]
    const document = createLiveCoachLocalDataExport({
      appVersion: '1.5.1',
      exportedAt: 333,
      state,
      settings,
      feedback,
      acceptance,
      replayHistory: [],
      replayResults: []
    })

    expect(document).toMatchObject({
      schemaVersion: 3,
      type: 'league-akari-live-coach-export',
      appVersion: '1.5.1',
      exportedAt: 333,
      session: { id: 'session-1' },
      cue: { id: 'cue-1' },
      recentCues: [{ id: 'cue-1' }],
      sessionCueStats: { total: 1 },
      lastSessionSummary: { sessionId: 'session-0' },
      fogInferences: [{ id: 'fog-1' }],
      itemGuidance: { id: 'item-guidance-1' },
      cooldowns: [{ id: 'cooldown-1' }],
      communicationHistory: [{ id: 'communication-1' }],
      conversation: { conversationId: 'conversation-1' },
      lastError: { code: 'capture-stalled' },
      feedback,
      manualCalibration: { id: 'calibration-1' },
      acceptance: {
        generatedAt: 222,
        privacy: {
          rawFramesIncluded: false,
          gameVideoIncluded: false,
          microphoneAudioIncluded: false,
          fullPathsIncluded: false
        }
      },
      replayHistory: [],
      replayResults: []
    })
    expect(document.privacy).toMatchObject({
      rawFramesIncluded: false,
      microphoneAudioIncluded: false,
      gameVideoIncluded: false,
      fullPathsIncluded: false,
      tokensIncluded: false,
      diagnosticErrorDetailsIncluded: false
    })
    expect(JSON.stringify(document)).not.toContain('C:\\\\Users\\\\private\\\\match.mp4')
  })

  it('rejects undeclared raw media and path fields at nested output boundaries', () => {
    const document = createLiveCoachLocalDataExport({
      appVersion: '1.5.1',
      exportedAt: 333,
      state: createPopulatedState(),
      settings: new LiveCoachSettings(),
      feedback: [],
      acceptance: buildLiveCoachAcceptanceReport({
        sessions: [],
        offlineRecords: [],
        feedback: [],
        generatedAt: 222
      }),
      replayHistory: [],
      replayResults: []
    })

    expect(() =>
      liveCoachLocalDataExportSchema.parse({
        ...document,
        rawFrames: ['private-frame-payload']
      })
    ).toThrow()
    expect(() =>
      liveCoachLocalDataExportSchema.parse({
        ...document,
        cue: { ...document.cue!, videoPath: 'C:\\Users\\private\\match.mp4' }
      })
    ).toThrow()
  })
})

function createPopulatedState(): LiveCoachState {
  const state = new LiveCoachState()
  state.setSessionInfo({
    id: 'session-1',
    state: 'active',
    mapId: 11,
    queueId: 420,
    patch: '16.17.1',
    startedAt: 1
  })
  const cue = {
    id: 'cue-1',
    sessionId: 'session-1',
    category: 'warning' as const,
    priority: 80,
    observationText: 'River pressure',
    impactText: null,
    options: [{ id: 'retreat', label: 'Retreat', role: 'primary' as const }],
    spokenText: 'Back away',
    createdAt: 2,
    expiresAt: 10,
    status: 'spoken' as const,
    cancellationReason: null
  }
  state.setCue(cue)
  state.addRecentCue(cue)
  state.lastSessionSummary = {
    sessionId: 'session-0',
    mapId: 11,
    queueId: 420,
    patch: '16.17.1',
    startedAt: 1,
    endedAt: 11,
    durationSeconds: 10,
    endReason: 'completed',
    totalCues: 1,
    cueCounts: { information: 0, warning: 1, opportunity: 0, system: 0, review: 0 }
  }
  state.setFogInferences([
    {
      id: 'fog-1',
      sessionId: 'session-1',
      enemyTrackId: 'enemy-1',
      basisEvidenceIds: ['evidence-1'],
      lastSeenAt: 1,
      predictedRegions: [{ regionId: 'river', probability: 0.8 }],
      candidateRoutes: [{ regionIds: ['river', 'mid'], probability: 0.8 }],
      arrivalWindow: { earliestAt: 5, latestAt: 10 },
      intents: [{ kind: 'roam', probability: 0.8 }],
      confidence: 0.8,
      createdAt: 2,
      expiresAt: 12,
      modelVersion: '1'
    }
  ])
  state.setItemGuidance({
    id: 'item-guidance-1',
    sessionId: 'session-1',
    patch: '16.17.1',
    championId: 266,
    mode: 'adaptive',
    currentGold: 1_000,
    inventoryItemIds: [1055],
    primaryPlan: {
      itemIds: [3071],
      totalCost: 3_300,
      remainingGold: 0,
      missingGold: 2_300,
      reasonCodes: ['damage'],
      conditions: []
    },
    alternativePlans: [],
    evidenceIds: ['evidence-1'],
    createdAt: 2,
    expiresAt: 12,
    ruleVersion: '1'
  })
  state.setCooldowns([
    {
      id: 'cooldown-1',
      sessionId: 'session-1',
      kind: 'ultimate',
      label: 'Ultimate',
      ownerTeam: 'enemy',
      championId: 1,
      source: 'visible-screen',
      confidence: 0.9,
      observedAt: 2,
      earliestReadyAt: 50,
      latestReadyAt: 60,
      status: 'running',
      evidenceIds: ['evidence-1']
    }
  ])
  state.addCommunicationAudit({
    id: 'communication-1',
    sessionId: 'session-1',
    cueId: 'cue-1',
    optionId: 'retreat',
    kind: 'retreat',
    action: 'copied',
    channel: 'chat',
    message: 'Back away',
    reason: null,
    createdAt: 2
  })
  state.conversation = {
    conversationId: 'conversation-1',
    state: 'completed',
    userTranscript: 'What now?',
    aiResponse: 'Retreat'
  }
  state.setLastError({
    code: 'capture-stalled',
    stage: 'capture',
    recoverable: true,
    occurredAt: 3,
    details: 'C:\\Users\\private\\match.mp4'
  })
  return state
}
