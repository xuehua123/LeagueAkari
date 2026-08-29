import {
  CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION,
  type LiveCoachCapabilityPayload
} from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { LiveCoachCapabilityController } from './capability-controller'
import { INTERNAL_LIVE_COACH_CAPABILITY_POLICY } from './internal-capability-policy'

describe('LiveCoachCapabilityController', () => {
  function createMockContext() {
    const capability = {
      enabledFeatureIds: [] as string[],
      unavailableReasons: {} as Record<string, string>
    }

    return {
      settings: {
        enabled: true,
        onboardingCompleted: true,
        privacyConsentVersion: CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
      },
      state: {
        capability,
        setCapability: vi.fn((features, unavail) => {
          capability.enabledFeatureIds = features
          capability.unavailableReasons = unavail
        })
      }
    } as any
  }

  it('supports exact registered catalog patch 16.17.1 and marks unregistered or unknown patches as unsupported-patch', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    // 1. 权威 16.17.1 补丁：全部能力正常开放
    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })
    expect(ctx.state.setCapability).toHaveBeenCalledWith(
      expect.arrayContaining([
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-advanced',
        'coach.analyze.fog-inference',
        'coach.guidance.item-purchase',
        'coach.guidance.micro',
        'coach.track.cooldowns',
        'coach.communication.chat'
      ]),
      expect.not.objectContaining({ patch: 'unsupported-patch' })
    )

    expect(ctx.state.capability.enabledFeatureIds).not.toContain('coach.analyze.minimap-identity')
    expect(ctx.state.capability.unavailableReasons).toMatchObject({
      'coach.analyze.minimap-identity': 'capability-disabled'
    })

    // 2. 未包含在注册表的旧补丁 16.16.1：关闭版本依赖能力，但保留版本无关的视觉观察
    controller.evaluateCapabilities(11, 420, '16.16.1', { roiHealth: 'healthy' })
    expect(ctx.state.setCapability).toHaveBeenCalledWith(
      expect.arrayContaining(['coach.analyze.minimap-basic', 'coach.analyze.minimap-advanced']),
      expect.objectContaining({
        patch: 'unsupported-patch',
        'coach.analyze.fog-inference': 'unsupported-patch',
        'coach.guidance.item-purchase': 'unsupported-patch',
        'coach.guidance.micro': 'unsupported-patch',
        'coach.track.cooldowns': 'unsupported-patch'
      })
    )
    expect(ctx.state.setCapability).toHaveBeenCalledWith(
      expect.not.arrayContaining(['coach.analyze.fog-inference', 'coach.guidance.item-purchase']),
      expect.anything()
    )

    // 3. unknown 补丁版本：明确报告 unsupported-patch
    controller.evaluateCapabilities(11, 420, 'unknown', { roiHealth: 'healthy' })
    expect(ctx.state.setCapability).toHaveBeenCalledWith(
      expect.not.arrayContaining(['coach.guidance.item-purchase']),
      expect.objectContaining({ patch: 'unsupported-patch' })
    )
  })

  it('disables minimap & fog capabilities when roiHealth is unknown/occluded while keeping capture enabled for recovery', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    // 1. 启动初期 roiHealth 为 unknown，允许采集以促成健康恢复，但禁用分析能力
    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'unknown' })
    expect(ctx.state.setCapability).toHaveBeenCalledWith(
      expect.arrayContaining(['coach.capture.screen']),
      expect.objectContaining({
        'coach.analyze.minimap-basic': 'roi-occluded',
        'coach.analyze.fog-inference': 'roi-occluded'
      })
    )

    // 2. 当 Worker 接收到真实帧并汇报 healthy 时，重新评估立即恢复全部能力
    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })
    expect(ctx.state.setCapability).toHaveBeenCalledWith(
      expect.arrayContaining([
        'coach.capture.screen',
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-advanced',
        'coach.analyze.fog-inference',
        'coach.guidance.item-purchase'
      ]),
      expect.not.objectContaining({
        'coach.analyze.minimap-basic': 'roi-occluded',
        'coach.analyze.fog-inference': 'roi-occluded'
      })
    )
  })

  it('immediately recalculates capabilities when setGates is called in public build channel', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    controller.setBuildChannel('public')
    controller.setCapabilitySnapshot(INTERNAL_LIVE_COACH_CAPABILITY_POLICY, 'valid')
    const gateADisabled = vi.fn()
    const gateBDisabled = vi.fn()
    controller.onGateADisabled = gateADisabled
    controller.onGateBDisabled = gateBDisabled
    // 初始状态评估
    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })

    // 1. 关闭 Gate A (实时采集与分析能力禁用)，Gate B 开启
    controller.setGates(false, true)
    expect(gateADisabled).toHaveBeenCalledOnce()
    expect(gateBDisabled).not.toHaveBeenCalled()

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining([
        'coach.capture.screen',
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-advanced',
        'coach.analyze.minimap-identity',
        'coach.analyze.fog-inference',
        'coach.guidance.micro',
        'coach.track.cooldowns',
        'coach.communication.chat'
      ]),
      expect.objectContaining({
        'coach.capture.screen': 'capability-disabled',
        'coach.analyze.minimap-basic': 'capability-disabled',
        'coach.analyze.fog-inference': 'capability-disabled'
      })
    )

    // 2. 关闭 Gate B (实时输出能力禁用)，Gate A 开启
    controller.setGates(true, false)
    expect(gateADisabled).toHaveBeenCalledOnce()
    expect(gateBDisabled).toHaveBeenCalledOnce()

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining([
        'coach.output.subtitle',
        'coach.output.sound',
        'coach.output.tts'
      ]),
      expect.objectContaining({
        'coach.output.subtitle': 'capability-disabled',
        'coach.output.tts': 'capability-disabled'
      })
    )
  })

  it('separates individual capability removal from whole Gate A/Gate B shutdown', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)
    controller.setTtsAvailable(true)
    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })

    const gateADisabled = vi.fn()
    const gateBDisabled = vi.fn()
    const capabilitiesDisabled = vi.fn()
    controller.onGateADisabled = gateADisabled
    controller.onGateBDisabled = gateBDisabled
    controller.onCapabilitiesDisabled = capabilitiesDisabled

    controller.evaluateCapabilities(11, 420, '16.18.1', { roiHealth: 'healthy' })
    expect(gateADisabled).not.toHaveBeenCalled()
    expect(capabilitiesDisabled).toHaveBeenCalledWith(
      expect.arrayContaining([
        'coach.analyze.fog-inference',
        'coach.guidance.item-purchase',
        'coach.guidance.micro'
      ])
    )
    expect(ctx.state.capability.enabledFeatureIds).toContain('coach.capture.screen')

    controller.setTtsAvailable(false)
    expect(gateBDisabled).not.toHaveBeenCalled()
    expect(ctx.state.capability.enabledFeatureIds).toContain('coach.output.subtitle')
  })

  it('fails closed when an in-game Summoner Rift queue is still unknown', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    controller.evaluateCapabilities(11, null, '16.17.1', { roiHealth: 'healthy' })

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining([
        'coach.capture.screen',
        'coach.analyze.minimap-basic',
        'coach.analyze.fog-inference',
        'coach.guidance.item-purchase',
        'coach.guidance.micro',
        'coach.track.cooldowns',
        'coach.communication.chat'
      ]),
      expect.objectContaining({
        queue: 'unsupported-queue',
        'coach.capture.screen': 'unsupported-queue'
      })
    )
  })

  it('fails closed for a known but unauthorized Summoner Rift queue', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    controller.evaluateCapabilities(11, 450, '16.17.1', { roiHealth: 'healthy' })

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining([
        'coach.capture.screen',
        'coach.analyze.minimap-basic',
        'coach.guidance.item-purchase',
        'coach.communication.chat'
      ]),
      expect.objectContaining({
        'coach.capture.screen': 'unsupported-queue',
        'coach.guidance.item-purchase': 'unsupported-queue'
      })
    )
  })

  it('requires a valid signed snapshot in public builds and applies per-rule constraints', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)
    controller.setBuildChannel('public')
    controller.setGates(true, true)

    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })
    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining(['coach.capture.screen', 'coach.output.subtitle']),
      expect.objectContaining({ 'coach.capture.screen': 'capability-disabled' })
    )

    controller.setCapabilitySnapshot(
      {
        ...INTERNAL_LIVE_COACH_CAPABILITY_POLICY,
        generation: 12,
        rules: [
          {
            id: 'coach.capture.screen',
            version: '1',
            enabled: true,
            supportedPlatforms: ['win32'],
            supportedRegions: ['HN1'],
            supportedMaps: [11],
            supportedQueues: [420]
          },
          {
            id: 'coach.output.subtitle',
            version: '1',
            enabled: true,
            supportedPlatforms: ['win32'],
            supportedRegions: ['HN1'],
            supportedMaps: [11],
            supportedQueues: [420]
          }
        ]
      },
      'valid'
    )
    controller.setRuntimeRegion('HN1')
    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.arrayContaining(['coach.capture.screen', 'coach.output.subtitle']),
      expect.objectContaining({ 'coach.guidance.item-purchase': 'capability-disabled' })
    )

    const gateADisabled = vi.fn()
    const gateBDisabled = vi.fn()
    controller.onGateADisabled = gateADisabled
    controller.onGateBDisabled = gateBDisabled
    controller.setRuntimeRegion('NA1')
    expect(gateADisabled).toHaveBeenCalledOnce()
    expect(gateBDisabled).toHaveBeenCalledOnce()

    controller.setRuntimeRegion('HN1')
    controller.evaluateCapabilities(11, 440, '16.17.1', { roiHealth: 'healthy' })
    expect(gateADisabled).toHaveBeenCalledTimes(2)
    expect(gateBDisabled).toHaveBeenCalledTimes(2)
    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining(['coach.capture.screen', 'coach.output.subtitle']),
      expect.objectContaining({ 'coach.capture.screen': 'unsupported-queue' })
    )
  })

  it('honors kill switch, region and exact model version/hash fail-closed', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)
    controller.setBuildChannel('public')
    controller.setGates(true, true)
    controller.setRuntimeRegion('HN1')
    const policy: LiveCoachCapabilityPayload = {
      ...INTERNAL_LIVE_COACH_CAPABILITY_POLICY,
      generation: 13,
      models: {
        'champion-icon-onnx': {
          version: '16.17.1-template.1',
          sha256: 'a'.repeat(64),
          url: 'https://example.invalid/model.json'
        }
      },
      rules: [
        {
          id: 'coach.analyze.minimap-identity',
          version: '1',
          enabled: true,
          supportedPlatforms: ['win32'],
          supportedRegions: ['HN1'],
          supportedMaps: [11],
          supportedQueues: [420],
          minPatch: '16.17.1',
          maxPatch: '16.17.1',
          requiredModels: ['champion-icon-onnx']
        }
      ]
    }

    controller.setIdentityModelLoaded(true, {
      version: '16.17.1-template.1',
      sha256: 'b'.repeat(64)
    })
    controller.setCapabilitySnapshot(policy, 'valid')
    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })
    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining(['coach.analyze.minimap-identity']),
      expect.objectContaining({ 'coach.analyze.minimap-identity': 'capability-disabled' })
    )

    controller.setIdentityModelLoaded(true, {
      version: '16.17.1-template.1',
      sha256: 'a'.repeat(64)
    })
    controller.setRuntimeRegion('NA1')
    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining(['coach.analyze.minimap-identity']),
      expect.objectContaining({ 'coach.analyze.minimap-identity': 'unsupported-region' })
    )

    controller.setRuntimeRegion('HN1')
    controller.setCapabilitySnapshot({ ...policy, killSwitch: true }, 'valid')
    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining(['coach.analyze.minimap-identity']),
      expect.objectContaining({ 'coach.analyze.minimap-identity': 'capability-disabled' })
    )
  })

  it('disables all live-data-dependent phase-one guidance when the 2999 source is degraded', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    controller.evaluateCapabilities(11, 420, '16.17.1', {
      roiHealth: 'healthy',
      liveDataHealth: 'degraded'
    })

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining([
        'live-game-data',
        'coach.guidance.item-purchase',
        'coach.guidance.micro',
        'coach.track.cooldowns'
      ]),
      expect.objectContaining({
        'live-game-data': 'live-data-unavailable',
        'coach.guidance.item-purchase': 'live-data-unavailable',
        'coach.guidance.micro': 'live-data-unavailable',
        'coach.track.cooldowns': 'live-data-unavailable'
      })
    )
  })

  it('keeps item and micro guidance available when only the independent events domain degrades', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    controller.evaluateCapabilities(11, 420, '16.17.1', {
      roiHealth: 'healthy',
      liveDataHealth: 'degraded',
      liveDataDomains: {
        'game-stats': 'healthy',
        players: 'healthy',
        events: 'degraded',
        'active-player': 'healthy'
      }
    })

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.arrayContaining(['coach.guidance.item-purchase', 'coach.guidance.micro']),
      expect.objectContaining({
        'live-game-data': 'live-data-unavailable',
        'coach.track.cooldowns': 'live-data-unavailable'
      })
    )
    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining(['coach.track.cooldowns']),
      expect.not.objectContaining({
        'coach.guidance.item-purchase': 'live-data-unavailable',
        'coach.guidance.micro': 'live-data-unavailable'
      })
    )
  })

  it('reflects independent user feature switches in the capability snapshot', () => {
    const ctx = createMockContext()
    Object.assign(ctx.settings, {
      fogInferenceEnabled: false,
      itemGuidanceEnabled: false,
      cooldownTrackingEnabled: false,
      communicationAssistEnabled: false
    })
    const controller = new LiveCoachCapabilityController(ctx)

    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining([
        'coach.analyze.fog-inference',
        'coach.guidance.item-purchase',
        'coach.track.cooldowns',
        'coach.communication.ping',
        'coach.communication.chat'
      ]),
      expect.objectContaining({
        'coach.analyze.fog-inference': 'capability-disabled',
        'coach.guidance.item-purchase': 'capability-disabled',
        'coach.track.cooldowns': 'capability-disabled',
        'coach.communication.ping': 'capability-disabled',
        'coach.communication.chat': 'capability-disabled'
      })
    )
  })

  it('keeps desktopCapturer for diagnostics but never enables realtime minimap analysis from it', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    controller.evaluateCapabilities(11, 420, '16.17.1', {
      roiHealth: 'healthy',
      backend: 'desktopCapturer'
    })

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.arrayContaining(['coach.capture.screen']),
      expect.objectContaining({
        'coach.analyze.minimap-basic': 'capability-disabled',
        'coach.analyze.minimap-advanced': 'capability-disabled',
        'coach.analyze.fog-inference': 'capability-disabled'
      })
    )
    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.not.arrayContaining([
        'coach.analyze.minimap-basic',
        'coach.analyze.minimap-advanced',
        'coach.analyze.fog-inference'
      ]),
      expect.anything()
    )
  })

  it('keeps offline review available when the realtime coach master switch is off', () => {
    const ctx = createMockContext()
    const controller = new LiveCoachCapabilityController(ctx)

    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })
    ctx.settings.enabled = false
    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      expect.arrayContaining(['coach.offline-review']),
      expect.objectContaining({
        all: 'capability-disabled',
        'coach.capture.screen': 'capability-disabled',
        'live-game-data': 'capability-disabled'
      })
    )
    expect(ctx.state.capability.enabledFeatureIds).not.toContain('coach.output.subtitle')
  })

  it('uses consent-required as the final fail-closed reason for every coach capability', () => {
    const ctx = createMockContext()
    ctx.settings.onboardingCompleted = false
    const controller = new LiveCoachCapabilityController(ctx)

    controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })

    expect(ctx.state.setCapability).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        all: 'consent-required',
        'coach.offline-review': 'consent-required',
        'coach.capture.screen': 'consent-required',
        'coach.output.subtitle': 'consent-required',
        'live-game-data': 'consent-required'
      })
    )
  })

  it.each([undefined, null, '0.9.0', '2.0.0', 'not-a-version'])(
    'does not accept boolean=true with non-current consent version %j',
    (privacyConsentVersion) => {
      const ctx = createMockContext()
      ctx.settings.privacyConsentVersion = privacyConsentVersion
      const controller = new LiveCoachCapabilityController(ctx)

      controller.evaluateCapabilities(11, 420, '16.17.1', { roiHealth: 'healthy' })

      expect(ctx.state.capability.enabledFeatureIds).toEqual([])
      expect(ctx.state.capability.unavailableReasons).toMatchObject({
        all: 'consent-required',
        'coach.offline-review': 'consent-required',
        'coach.capture.screen': 'consent-required'
      })
    }
  )
})
