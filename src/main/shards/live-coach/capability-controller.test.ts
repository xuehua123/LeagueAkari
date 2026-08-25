import { describe, expect, it, vi } from 'vitest'

import { LiveCoachCapabilityController } from './capability-controller'

describe('LiveCoachCapabilityController', () => {
  function createMockContext() {
    let currentFeatures: string[] = []
    let currentUnavailable: Record<string, string> = {}

    return {
      settings: {
        enabled: true
      },
      state: {
        capability: {
          enabledFeatureIds: currentFeatures,
          unavailableReasons: currentUnavailable
        },
        setCapability: vi.fn((features, unavail) => {
          currentFeatures = features
          currentUnavailable = unavail
        })
      }
    } as any
  }

  it('supports 16.x patches (e.g. 16.16.1) without reporting unsupported-patch', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    controller.evaluateCapabilities(11, 420, '16.16.1', { roiHealth: 'healthy' })

    expect(ctx.state.setCapability).toHaveBeenCalledWith(
      expect.arrayContaining([
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-advanced',
        'coach.analyze.fog-inference',
        'coach.guidance.item-purchase'
      ]),
      expect.not.objectContaining({ patch: 'unsupported-patch' })
    )
  })

  it('disables minimap & fog capabilities when roiHealth is unknown/occluded and restores them when healthy', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    // 1. 启动初期 roiHealth 为 unknown
    controller.evaluateCapabilities(11, 420, '16.16.1', { roiHealth: 'unknown' })
    expect(ctx.state.setCapability).toHaveBeenCalledWith(
      expect.not.arrayContaining(['coach.analyze.minimap-basic', 'coach.analyze.fog-inference']),
      expect.objectContaining({ 'coach.capture.screen': 'roi-occluded' })
    )

    // 2. 当 Worker 接收到真实帧并汇报 healthy 时，重新评估立即恢复全部能力
    controller.evaluateCapabilities(11, 420, '16.16.1', { roiHealth: 'healthy' })
    expect(ctx.state.setCapability).toHaveBeenCalledWith(
      expect.arrayContaining([
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-advanced',
        'coach.analyze.fog-inference',
        'coach.guidance.item-purchase'
      ]),
      expect.not.objectContaining({ 'coach.capture.screen': 'roi-occluded' })
    )
  })
})
