import { describe, expect, it } from 'vitest'

import {
  createLiveCoachDiagnosticsReport,
  liveCoachDiagnosticsReportSchema
} from './diagnostics-report'
import { LiveCoachSettings, LiveCoachState } from './state'

describe('createLiveCoachDiagnosticsReport', () => {
  it('exports support data without user text, paths, identifiers, or error details', () => {
    const state = new LiveCoachState()
    const settings = new LiveCoachSettings()
    state.setSessionInfo({
      id: 'sensitive-session-id',
      state: 'active',
      mapId: 11,
      queueId: 420,
      patch: '16.16.1',
      startedAt: 100
    })
    state.setLastError({
      code: 'capture-stalled',
      stage: 'capture',
      recoverable: true,
      occurredAt: 200,
      details: 'C:\\Users\\private-user\\Videos\\match.mp4'
    })
    state.setCaptureState({
      queueDepth: 2,
      workerHeartbeatAt: 250,
      workerRestartCount: 1
    })
    state.setLiveDataState('healthy', 260, [
      {
        domain: 'events',
        state: 'healthy',
        lastSuccessAt: 260,
        lastErrorCode: null,
        consecutiveFailures: 0
      }
    ])
    settings.communicationTemplates = {
      ...settings.communicationTemplates,
      danger: 'private custom message'
    }
    settings.speechVoiceId = 'private-voice-id'

    const report = createLiveCoachDiagnosticsReport({
      appVersion: '1.5.1',
      platform: 'win32',
      arch: 'x64',
      generatedAt: 300,
      state,
      settings
    })
    const serialized = JSON.stringify(report)

    expect(report.session).toMatchObject({ hasSessionId: true, mapId: 11, queueId: 420 })
    expect(report.lastError).toEqual({
      code: 'capture-stalled',
      stage: 'capture',
      recoverable: true,
      occurredAt: 200
    })
    expect(report.capture).toMatchObject({
      queueDepth: 2,
      workerHeartbeatAt: 250,
      workerRestartCount: 1
    })
    expect(report.liveData.sourceHealth).toEqual([
      {
        domain: 'events',
        state: 'healthy',
        lastSuccessAt: 260,
        lastErrorCode: null,
        consecutiveFailures: 0
      }
    ])
    expect(serialized).not.toContain('sensitive-session-id')
    expect(serialized).not.toContain('private-user')
    expect(serialized).not.toContain('private custom message')
    expect(serialized).not.toContain('private-voice-id')
    expect(liveCoachDiagnosticsReportSchema.parse(report)).toEqual(report)
    expect(() =>
      liveCoachDiagnosticsReportSchema.parse({
        ...report,
        capture: {
          ...report.capture,
          rawFrame: 'private-frame-payload',
          videoPath: 'C:\\Users\\private-user\\Videos\\match.mp4'
        }
      })
    ).toThrow()
  })
})
