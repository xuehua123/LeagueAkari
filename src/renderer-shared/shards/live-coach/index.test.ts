import { CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW } from '../window-manager/context'
import { LIVE_COACH_MAIN_NAMESPACE } from './context'
import { LiveCoachRenderer } from './index'

describe('LiveCoachRenderer privacy consent persistence', () => {
  function createRenderer(
    set: any = vi.fn(async () => undefined),
    call: any = vi.fn(async () => ({ success: true }))
  ) {
    return {
      renderer: new LiveCoachRenderer({} as any, { set } as any, { call } as any),
      set,
      call
    }
  }

  it('grants consent in a fail-closed boolean/version/boolean order', async () => {
    const { renderer, set } = createRenderer()

    await renderer.setOnboardingCompleted(true)

    expect(set.mock.calls).toEqual([
      [LIVE_COACH_MAIN_NAMESPACE, 'onboardingCompleted', false],
      [
        LIVE_COACH_MAIN_NAMESPACE,
        'privacyConsentVersion',
        CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
      ],
      [LIVE_COACH_MAIN_NAMESPACE, 'onboardingCompleted', true]
    ])
  })

  it('does not restore the affirmative boolean when the version write fails', async () => {
    const set = vi.fn(async (_namespace: string, key: string) => {
      if (key === 'privacyConsentVersion') throw new Error('storage unavailable')
    })
    const { renderer } = createRenderer(set)

    await expect(renderer.setOnboardingCompleted(true)).rejects.toThrow('storage unavailable')

    expect(set.mock.calls).toEqual([
      [LIVE_COACH_MAIN_NAMESPACE, 'onboardingCompleted', false],
      [
        LIVE_COACH_MAIN_NAMESPACE,
        'privacyConsentVersion',
        CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
      ]
    ])
  })

  it('delegates withdrawal to the durable main-process consent boundary', async () => {
    const { renderer, set, call } = createRenderer()

    await renderer.setOnboardingCompleted(false)

    expect(call).toHaveBeenCalledWith(LIVE_COACH_MAIN_NAMESPACE, 'withdrawPrivacyConsent')
    expect(set).not.toHaveBeenCalled()
  })

  it('surfaces durable withdrawal failures to the calling view', async () => {
    const call = vi.fn(async () => {
      throw new Error('storage unavailable')
    })
    const { renderer } = createRenderer(undefined, call)

    await expect(renderer.setOnboardingCompleted(false)).rejects.toThrow('storage unavailable')
  })
})

describe('LiveCoachRenderer replay history IPC', () => {
  it('uses id-based authoritative export and exposes history deletion and retry calls', async () => {
    const call = vi.fn(async () => undefined)
    const renderer = new LiveCoachRenderer({} as any, { set: vi.fn() } as any, { call } as any)

    await renderer.listReplayAnalyses()
    await renderer.getReplayAnalysis('analysis-1')
    await renderer.deleteReplayAnalysis('analysis-1')
    await renderer.clearReplayAnalyses()
    const sourceToken = 'A'.repeat(43)
    await renderer.retryReplayAnalysis({ analysisId: 'analysis-1', sourceToken })
    await renderer.revokeReplayFileGrants([sourceToken])
    await renderer.exportReplayAnalysis({ format: 'json', analysisId: 'analysis-1' })

    expect(call.mock.calls).toEqual([
      [LIVE_COACH_MAIN_NAMESPACE, 'listReplayAnalyses'],
      [LIVE_COACH_MAIN_NAMESPACE, 'getReplayAnalysis', 'analysis-1'],
      [LIVE_COACH_MAIN_NAMESPACE, 'deleteReplayAnalysis', 'analysis-1'],
      [LIVE_COACH_MAIN_NAMESPACE, 'clearReplayAnalyses'],
      [
        LIVE_COACH_MAIN_NAMESPACE,
        'retryReplayAnalysis',
        {
          analysisId: 'analysis-1',
          sourceToken
        }
      ],
      [LIVE_COACH_MAIN_NAMESPACE, 'revokeReplayFileGrants', { tokens: [sourceToken] }],
      [
        LIVE_COACH_MAIN_NAMESPACE,
        'exportReplayAnalysis',
        {
          format: 'json',
          analysisId: 'analysis-1'
        }
      ]
    ])
    expect(JSON.stringify(call.mock.calls)).not.toContain('content')
    expect(JSON.stringify(call.mock.calls)).not.toContain('D:\\\\volatile')
  })
})

describe('LiveCoachRenderer overlay adjustment workflow', () => {
  it('enables, unlocks, and enters the trusted interaction mode in order', async () => {
    const set = vi.fn(async () => undefined)
    const call = vi.fn(async () => true)
    const renderer = new LiveCoachRenderer({} as any, { set } as any, { call } as any)

    await expect(renderer.beginOverlayAdjustment()).resolves.toBe(true)

    expect(set.mock.calls).toEqual([
      [MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'enabled', true],
      [LIVE_COACH_MAIN_NAMESPACE, 'overlayEnabled', true],
      [MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'locked', false],
      [LIVE_COACH_MAIN_NAMESPACE, 'overlayLocked', false]
    ])
    expect(call).toHaveBeenCalledWith(
      MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW,
      'setInteractionMode',
      true
    )
  })

  it('relocks when the overlay cannot enter interaction mode', async () => {
    const set = vi.fn(async () => undefined)
    const call = vi.fn(async () => false)
    const renderer = new LiveCoachRenderer({} as any, { set } as any, { call } as any)

    await expect(renderer.beginOverlayAdjustment()).resolves.toBe(false)

    expect(set.mock.calls.slice(-2)).toEqual([
      [MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'locked', true],
      [LIVE_COACH_MAIN_NAMESPACE, 'overlayLocked', true]
    ])
  })

  it('restores mouse passthrough when beginning adjustment throws', async () => {
    const failure = new Error('interaction failed')
    const set = vi.fn(async () => undefined)
    const call = vi.fn(async (_namespace: string, _name: string, interactive: boolean) => {
      if (interactive) throw failure
      return true
    })
    const renderer = new LiveCoachRenderer({} as any, { set } as any, { call } as any)

    await expect(renderer.beginOverlayAdjustment()).rejects.toBe(failure)

    expect(set.mock.calls.slice(-2)).toEqual([
      [MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'locked', true],
      [LIVE_COACH_MAIN_NAMESPACE, 'overlayLocked', true]
    ])
    expect(call.mock.calls).toEqual([
      [MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'setInteractionMode', true],
      [MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW, 'setInteractionMode', false]
    ])
  })

  it('persists the lock before restoring mouse passthrough', async () => {
    const operations: string[] = []
    const set = vi.fn(async (_namespace: string, key: string, value: boolean) => {
      operations.push(`set:${key}:${value}`)
    })
    const call = vi.fn(async (_namespace: string, name: string, interactive: boolean) => {
      operations.push(`ipc:${name}:${interactive}`)
    })
    const renderer = new LiveCoachRenderer({} as any, { set } as any, { call } as any)

    await renderer.finishOverlayAdjustment()

    expect(operations).toEqual([
      'set:locked:true',
      'set:overlayLocked:true',
      'ipc:setInteractionMode:false'
    ])
  })

  it('still restores mouse passthrough when persisting the final lock fails', async () => {
    const failure = new Error('lock persistence failed')
    const set = vi.fn(async (namespace: string, key: string, _value: boolean): Promise<void> => {
      if (namespace === MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW && key === 'locked') {
        throw failure
      }
    })
    const call = vi.fn(async () => undefined)
    const renderer = new LiveCoachRenderer({} as any, { set } as any, { call } as any)

    await expect(renderer.finishOverlayAdjustment()).rejects.toBe(failure)

    expect(call).toHaveBeenCalledWith(
      MAIN_SHARD_NAMESPACE_COACH_OVERLAY_WINDOW,
      'setInteractionMode',
      false
    )
  })
})
