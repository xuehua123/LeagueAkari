import { CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { MinimapObserverIpcHandlers } from './ipc-handlers'

function registerHandlers(settings: {
  onboardingCompleted: boolean
  privacyConsentVersion: string | null
}) {
  const calls: Record<string, (...args: any[]) => any> = {}
  const supervisor = {
    probeCaptureSupport: vi.fn(() => ({ supported: true })),
    requestCalibrationPreview: vi.fn(async () => ({
      calibration: { confidence: 1 },
      fingerprint: { width: 1920, height: 1080 },
      sourceSize: { width: 1920, height: 1080 },
      thumbnailSize: { width: 1280, height: 720 }
    })),
    applyCalibration: vi.fn()
  }
  const calibration = {
    getEnvironmentFingerprint: vi.fn(() => ({ width: 1920, height: 1080 })),
    applyManualCalibration: vi.fn(),
    resetCalibration: vi.fn()
  }
  const context = {
    namespace: 'minimap-observer-main',
    liveCoach: { settings },
    ipc: {
      onCall: vi.fn((_namespace, name, handler) => {
        calls[name] = handler
      })
    }
  }

  new MinimapObserverIpcHandlers(context as any, calibration as any, supervisor as any).register()
  return { calls, supervisor }
}

describe('MinimapObserverIpcHandlers privacy boundary', () => {
  it('keeps non-frame support probing available while rejecting every preview without consent', async () => {
    const { calls, supervisor } = registerHandlers({
      onboardingCompleted: false,
      privacyConsentVersion: null
    })

    await expect(calls.probeSupport({} as any)).resolves.toEqual({ supported: true })
    await expect(calls.requestCalibrationPreview({} as any, false)).rejects.toMatchObject({
      code: 'consent-required'
    })
    await expect(calls.requestCalibrationPreview({} as any, true)).rejects.toMatchObject({
      code: 'consent-required'
    })
    expect(supervisor.requestCalibrationPreview).not.toHaveBeenCalled()
  })

  it('delegates a preview only after the current privacy notice is confirmed', async () => {
    const { calls, supervisor } = registerHandlers({
      onboardingCompleted: true,
      privacyConsentVersion: CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
    })

    await expect(calls.requestCalibrationPreview({} as any, false)).resolves.toMatchObject({
      calibration: { confidence: 1 },
      fingerprint: { width: 1920, height: 1080 }
    })
    expect(supervisor.requestCalibrationPreview).toHaveBeenCalledWith(false)
  })
})
