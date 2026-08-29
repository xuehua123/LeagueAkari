import { CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

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
