import { describe, expect, it } from 'vitest'

import type { EnvironmentMatrixInput } from './environment-matrix'
import {
  buildEnvironmentChecks,
  createEmptyEnvironmentProbeCache,
  listUnprobeableUnreadyChecks,
  resolveErrorHelpTopic,
  selectProbeGroupsForUnreadyChecks,
  summarizeEnvironmentChecks
} from './environment-matrix'

function createSupportedInput(): EnvironmentMatrixInput {
  return {
    platform: 'win32',
    isElevated: true,
    nativeInputStatus: 'available',
    nativeInputRequiresElevation: true,
    session: { mapId: 11, queueId: 420, patch: '16.17.1' },
    capability: {
      enabledFeatureIds: ['coach.capture.screen'],
      unavailable: {}
    },
    capture: {
      state: 'running',
      backend: 'wgc',
      resolution: { width: 1920, height: 1080 },
      roiState: 'healthy',
      confidence: 0.94
    },
    liveData: {
      state: 'healthy',
      lastSuccessAt: 100
    },
    settings: {
      speechVoiceId: 'voice-1',
      speechOutputDeviceId: 'device-1',
      shortcuts: ['Ctrl+1', 'Ctrl+2', null]
    },
    probes: {
      checkedAt: 100,
      capture: {
        state: 'success',
        value: {
          supported: true,
          realtimeSupported: true,
          platform: 'win32',
          backends: ['wgc', 'desktopCapturer'],
          nativeBackends: ['wgc'],
          fallbackAvailable: true,
          hdrSupported: false,
          permissionGranted: true
        }
      },
      preview: {
        state: 'success',
        value: {
          calibration: { confidence: 0.94 },
          fingerprint: {
            displayId: 'primary',
            width: 1920,
            height: 1080,
            dpiScale: 1.25,
            hdr: false,
            windowMode: 'windowed',
            backend: 'wgc',
            minimapSide: 'right'
          },
          sourceSize: { width: 1920, height: 1080 },
          thumbnailSize: { width: 1280, height: 720 }
        }
      },
      voices: {
        state: 'success',
        value: [{ id: 'voice-1', name: 'Local voice' }]
      },
      audio: {
        state: 'success',
        value: {
          outputDevices: [{ id: 'device-1', name: 'Speakers', isDefault: true }]
        }
      }
    }
  }
}

describe('environment diagnostics matrix', () => {
  it('keeps the overall result unknown when the renderer has no region identity to verify', () => {
    const checks = buildEnvironmentChecks(createSupportedInput())

    expect(checks.find((check) => check.id === 'capture')?.status).toBe('available')
    expect(checks.find((check) => check.id === 'resolution')?.status).toBe('available')
    expect(checks.find((check) => check.id === 'dpi')?.status).toBe('available')
    expect(checks.find((check) => check.id === 'hdr')).toMatchObject({
      status: 'available',
      reasonKey: 'sdrSupported'
    })
    expect(checks.find((check) => check.id === 'roi')?.status).toBe('available')
    expect(checks.find((check) => check.id === 'liveData')?.status).toBe('available')
    expect(checks.find((check) => check.id === 'region')).toMatchObject({
      status: 'unknown',
      reasonKey: 'regionNotExposed'
    })
    expect(summarizeEnvironmentChecks(checks)).toBe('unknown')
  })

  it('keeps independent blockers unavailable while accepting adaptive resolution and DPI', () => {
    const input = createSupportedInput()
    input.isElevated = false
    input.nativeInputStatus = 'requires-elevation'
    input.session = { mapId: 12, queueId: 450, patch: '16.18.1' }
    input.capability.unavailable = {
      'coach.capture.screen': 'unsupported-patch',
      'coach.output.subtitle': 'unsupported-region',
      'coach.analyze.minimap-basic': 'unsupported-queue'
    }
    input.probes.preview = {
      state: 'success',
      value: {
        calibration: { confidence: 0 },
        fingerprint: {
          displayId: 'primary',
          width: 3840,
          height: 2160,
          dpiScale: 2,
          hdr: true,
          windowMode: 'exclusive-fullscreen',
          backend: 'wgc',
          minimapSide: 'right'
        },
        sourceSize: { width: 3840, height: 2160 },
        thumbnailSize: { width: 1280, height: 720 }
      }
    }
    input.probes.voices = { state: 'success', value: [] }
    input.probes.audio = { state: 'success', value: { outputDevices: [] } }

    const statusById = Object.fromEntries(
      buildEnvironmentChecks(input).map((check) => [check.id, check.status])
    )

    expect(statusById).toMatchObject({
      resolution: 'available',
      dpi: 'available',
      hdr: 'unavailable',
      windowMode: 'unavailable',
      roi: 'unavailable',
      queue: 'unavailable',
      region: 'unavailable',
      patch: 'unavailable',
      voice: 'unavailable',
      audioOutput: 'unavailable',
      nativeShortcuts: 'unavailable'
    })
  })

  it.each([
    ['4:3', 1024, 768, 1],
    ['5:4', 1280, 1024, 1.25],
    ['720p', 1280, 720, 1.5],
    ['1366×768', 1366, 768, 1.75],
    ['16:10', 1920, 1200, 2],
    ['21:9', 3440, 1440, 1.5],
    ['4K', 3840, 2160, 2],
    ['32:9', 5120, 1440, 2],
    ['portrait capture', 320, 2160, 2]
  ])('accepts adaptive %s resolution and Windows scaling', (_, width, height, dpiScale) => {
    const input = createSupportedInput()
    input.capture.resolution = { width, height }
    if (input.probes.preview.state === 'success') {
      input.probes.preview.value.fingerprint = {
        ...input.probes.preview.value.fingerprint,
        width,
        height,
        dpiScale
      }
    }

    const statusById = Object.fromEntries(
      buildEnvironmentChecks(input).map((check) => [check.id, check.status])
    )

    expect(statusById).toMatchObject({ resolution: 'available', dpi: 'available' })
  })

  it('keeps native capture permission unknown until a real backend is actively running', () => {
    const input = createSupportedInput()
    input.capture.state = 'idle'
    input.capture.backend = null
    if (input.probes.capture.state === 'success') {
      input.probes.capture.value.permissionGranted = null
    }

    expect(buildEnvironmentChecks(input).find((check) => check.id === 'capture')).toMatchObject({
      status: 'unknown',
      reasonKey: 'capturePermissionUnknown',
      fixKey: 'verifyCaptureInGame'
    })
  })

  it('does not treat a preview thumbnail as target resolution or invent DPI/HDR truth', () => {
    const input = createSupportedInput()
    input.capture.resolution = null
    input.probes.preview = {
      state: 'success',
      value: {
        calibration: { confidence: 0.9 },
        fingerprint: {
          displayId: null,
          width: null,
          height: null,
          dpiScale: null,
          hdr: null,
          windowMode: 'unknown',
          backend: 'desktopCapturer',
          minimapSide: 'right'
        },
        sourceSize: null,
        thumbnailSize: { width: 1280, height: 720 }
      }
    }

    const statusById = Object.fromEntries(
      buildEnvironmentChecks(input).map((check) => [check.id, check.status])
    )

    expect(statusById).toMatchObject({
      resolution: 'unknown',
      dpi: 'unknown',
      hdr: 'unknown',
      windowMode: 'unknown'
    })
  })

  it('retries only callable groups and reports store-only checks separately', () => {
    const input = createSupportedInput()
    input.probes = createEmptyEnvironmentProbeCache()
    input.session = { mapId: null, queueId: null, patch: null }
    input.capture = {
      state: 'idle',
      backend: null,
      resolution: null,
      roiState: 'unknown',
      confidence: null
    }

    const checks = buildEnvironmentChecks(input)

    expect(new Set(selectProbeGroupsForUnreadyChecks(checks))).toEqual(
      new Set(['capture', 'preview', 'voices', 'audio'])
    )
    expect(listUnprobeableUnreadyChecks(checks)).toEqual(
      expect.arrayContaining(['map', 'queue', 'region', 'patch'])
    )
  })

  it('reports native shortcuts as partial until at least one shortcut is configured', () => {
    const input = createSupportedInput()
    input.settings.shortcuts = [null, null, null]

    expect(
      buildEnvironmentChecks(input).find((check) => check.id === 'nativeShortcuts')
    ).toMatchObject({
      status: 'partial',
      fixKey: 'configureShortcuts',
      valueParams: { count: 0 }
    })
  })

  it('maps actionable error families to focused help and preserves the safe fallback', () => {
    expect(resolveErrorHelpTopic('capture-stalled')).toBe('capture')
    expect(resolveErrorHelpTopic('capture-permission-denied')).toBe('permission')
    expect(resolveErrorHelpTopic('calibration-required')).toBe('calibration')
    expect(resolveErrorHelpTopic('unsupported-patch')).toBe('patch')
    expect(resolveErrorHelpTopic('unsupported-platform')).toBe('platform')
    expect(resolveErrorHelpTopic('speech-unavailable')).toBe('no-sound')
    expect(resolveErrorHelpTopic('consent-required')).toBe('consent')
    expect(resolveErrorHelpTopic('unknown-future-code')).toBe('automatic-pause')
  })
})
