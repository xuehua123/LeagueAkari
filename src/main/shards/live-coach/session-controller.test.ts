import { CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { LiveCoachSessionController } from './session-controller'

describe('LiveCoachSessionController Lifecycle & Exit Cleanup Test', () => {
  function createMockContext() {
    let sessionState = 'idle'
    let pauseReason: string | null = null
    let sessionId = ''
    let patch = ''
    let phase = 'None'
    let session: any = null
    let enabled = true
    let onboardingCompleted = true
    let privacyConsentVersion: string | null = CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
    let autoStartEnabled = true
    const listeners: Array<() => void> = []

    const triggerReaction = () => {
      for (const listener of listeners) {
        listener()
      }
    }

    return {
      settings: {
        get enabled() {
          return enabled
        },
        get onboardingCompleted() {
          return onboardingCompleted
        },
        get privacyConsentVersion() {
          return privacyConsentVersion
        },
        get autoStartEnabled() {
          return autoStartEnabled
        },
        setEnabled(value: boolean) {
          enabled = value
        },
        shadowModeEnabled: false,
        cueCategories: { warning: true, opportunity: true, suggestion: true, information: true }
      },
      state: {
        session: {
          get id() {
            return sessionId
          },
          get state() {
            return sessionState
          },
          get pauseReason() {
            return pauseReason
          },
          get patch() {
            return patch
          }
        },
        capture: {
          roiState: 'healthy'
        },
        liveData: {
          state: 'healthy'
        },
        capability: {
          enabledFeatureIds: [
            'coach.capture.screen',
            'coach.analyze.minimap-basic',
            'coach.analyze.minimap-advanced',
            'coach.analyze.fog-inference'
          ]
        },
        setSessionInfo: vi.fn((data) => {
          if ('id' in data) sessionId = data.id
          if ('state' in data) sessionState = data.state
          if ('pauseReason' in data) pauseReason = data.pauseReason
          if ('patch' in data) patch = data.patch
        }),
        setSessionState: vi.fn((state) => {
          sessionState = state
          if (state !== 'paused') pauseReason = null
        }),
        setCaptureState: vi.fn(),
        setLiveDataState: vi.fn(),
        setFogInferences: vi.fn(),
        setItemGuidance: vi.fn(),
        clearSessionArtifacts: vi.fn(),
        completeSessionSummary: vi.fn(),
        reset: vi.fn((finalState = 'idle') => {
          sessionId = ''
          sessionState = finalState
          pauseReason = null
          patch = ''
        })
      },
      leagueClient: {
        data: {
          gameflow: {
            get phase() {
              return phase
            },
            get session() {
              return session
            }
          }
        }
      },
      liveGameData: {
        data: {
          rawSnapshot: null
        },
        subscribe: vi.fn(() => () => {})
      },
      settingService: {
        set: vi.fn(async (key: string, value: unknown) => {
          if (key === 'enabled') enabled = Boolean(value)
        })
      },
      mobxUtils: {
        reaction: vi.fn((fn, effect) => {
          let lastVal: any = undefined
          const check = () => {
            const val = fn()
            if (JSON.stringify(val) !== JSON.stringify(lastVal)) {
              lastVal = val
              effect(val)
            }
          }
          listeners.push(check)
          check()
          return () => {
            const idx = listeners.indexOf(check)
            if (idx !== -1) listeners.splice(idx, 1)
          }
        })
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      setGameflow(newPhase: string, newSession: any) {
        phase = newPhase
        session = newSession
        triggerReaction()
      },
      setEnabled(value: boolean) {
        enabled = value
        triggerReaction()
      },
      setOnboardingCompleted(value: boolean) {
        onboardingCompleted = value
        triggerReaction()
      },
      setPrivacyConsentVersion(value: string | null) {
        privacyConsentVersion = value
        triggerReaction()
      },
      setAutoStartEnabled(value: boolean) {
        autoStartEnabled = value
        triggerReaction()
      }
    } as any
  }

  it('correctly manages pause and resume state transitions', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)

    // 启动会话
    controller.startSession('sess_001', 11, 420, '16.16.1')
    expect(ctx.state.setSessionInfo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess_001', state: 'active' })
    )

    // 暂停会话
    controller.pause('user-pause')
    expect(ctx.state.setSessionInfo).toHaveBeenLastCalledWith({
      state: 'paused',
      pauseReason: 'user-pause'
    })
    expect(ctx.state.session.pauseReason).toBe('user-pause')
    expect(scheduler.reset).toHaveBeenCalled()
    expect(ctx.state.setFogInferences).toHaveBeenCalledWith([])
    expect(ctx.state.setItemGuidance).toHaveBeenCalledWith(null)

    // 恢复会话
    controller.resume()
    expect(ctx.state.setSessionInfo).toHaveBeenLastCalledWith({
      state: 'active',
      pauseReason: null
    })
    expect(ctx.state.session.pauseReason).toBeNull()

    controller.dispose()
  })

  it('runs analysis in shadow state and restores shadow after a pause', () => {
    const ctx = createMockContext()
    ctx.settings.shadowModeEnabled = true
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)

    controller.startSession('shadow-session', 11, 420, '16.16.1')
    expect(ctx.state.session.state).toBe('shadow')

    controller.pause('user-pause')
    expect(ctx.state.session.state).toBe('paused')
    controller.resume()
    expect(ctx.state.session.state).toBe('shadow')

    controller.applyShadowMode(false)
    expect(ctx.state.session.state).toBe('active')
    expect(scheduler.reset).toHaveBeenCalledWith(true)
  })

  it('does not enter an active session while the realtime capture capability is closed', () => {
    const ctx = createMockContext()
    ctx.state.capability.enabledFeatureIds = ['coach.offline-review']
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: false } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)

    controller.startSession('blocked-session', 11, 420, '16.16.1')

    expect(ctx.state.setSessionInfo).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'blocked-session', state: 'active' })
    )
    expect(ctx.state.reset).toHaveBeenCalledWith('degraded')
  })

  it('rejects a direct/manual session start when privacy consent has not been completed', () => {
    const ctx = createMockContext()
    ctx.setOnboardingCompleted(false)
    const capabilityController = {
      evaluateCapabilities: vi.fn(),
      refreshCapabilities: vi.fn(),
      isGateAEnabled: true
    } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)

    controller.startSession('manual-without-consent', 11, 420, '16.17.1')

    expect(capabilityController.refreshCapabilities).toHaveBeenCalledOnce()
    expect(ctx.state.setSessionInfo).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'manual-without-consent', state: 'active' })
    )
    expect(ctx.state.reset).toHaveBeenCalledWith('disabled', true)
  })

  it('rejects a direct/manual start from a legacy boolean-only consent setting', () => {
    const ctx = createMockContext()
    ctx.setPrivacyConsentVersion(null)
    const capabilityController = {
      evaluateCapabilities: vi.fn(),
      refreshCapabilities: vi.fn(),
      isGateAEnabled: true
    } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)

    controller.startSession('legacy-consent', 11, 420, '16.17.1')

    expect(capabilityController.refreshCapabilities).toHaveBeenCalledOnce()
    expect(ctx.state.setSessionInfo).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'legacy-consent', state: 'active' })
    )
    expect(ctx.state.reset).toHaveBeenCalledWith('disabled', true)
  })

  it('does not auto-start from stale enabled=true before privacy consent', () => {
    const ctx = createMockContext()
    ctx.setOnboardingCompleted(false)
    const capabilityController = {
      evaluateCapabilities: vi.fn(),
      refreshCapabilities: vi.fn(),
      isGateAEnabled: true
    } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)

    controller.init()
    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { gameId: 9001, queue: { id: 420 } }
    })

    expect(ctx.state.session.id).toBe('')
    expect(ctx.state.session.state).toBe('disabled')
    expect(ctx.settings.enabled).toBe(false)
    expect(ctx.settingService.set).toHaveBeenCalledWith('enabled', false)
    expect(capabilityController.evaluateCapabilities).toHaveBeenCalled()
    controller.dispose()
  })

  it('withdrawal ends an active session and persists enabled=false immediately', () => {
    const ctx = createMockContext()
    const capabilityController = {
      evaluateCapabilities: vi.fn(),
      refreshCapabilities: vi.fn(),
      isGateAEnabled: true
    } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()
    controller.startSession('active-before-withdrawal', 11, 420, '16.17.1')

    ctx.setOnboardingCompleted(false)

    expect(ctx.state.completeSessionSummary).toHaveBeenCalledWith('consent-required')
    expect(ctx.state.session.id).toBe('')
    expect(ctx.state.session.state).toBe('disabled')
    expect(ctx.settings.enabled).toBe(false)
    expect(ctx.settingService.set).toHaveBeenCalledWith('enabled', false)
    controller.dispose()
  })

  it('a notice-version change immediately ends an active session and disables the feature', () => {
    const ctx = createMockContext()
    const capabilityController = {
      evaluateCapabilities: vi.fn(),
      refreshCapabilities: vi.fn(),
      isGateAEnabled: true
    } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()
    controller.startSession('active-before-version-change', 11, 420, '16.17.1')

    ctx.setPrivacyConsentVersion('2.0.0')

    expect(ctx.state.completeSessionSummary).toHaveBeenCalledWith('consent-required')
    expect(ctx.state.session.id).toBe('')
    expect(ctx.state.session.state).toBe('disabled')
    expect(ctx.settings.enabled).toBe(false)
    expect(ctx.settingService.set).toHaveBeenCalledWith('enabled', false)
    controller.dispose()
  })

  it('cleans up only the feature whose capability was withdrawn', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = {
      reset: vi.fn(),
      submitCues: vi.fn(),
      cancelCuesByRuleIds: vi.fn()
    } as any
    const cooldownTracker = { reset: vi.fn() } as any
    const controller = new LiveCoachSessionController(
      ctx,
      capabilityController,
      scheduler,
      cooldownTracker
    )

    controller.handleCapabilitiesDisabled(['coach.guidance.item-purchase'])

    expect(ctx.state.setItemGuidance).toHaveBeenCalledWith(null)
    expect(ctx.state.setFogInferences).not.toHaveBeenCalled()
    expect(cooldownTracker.reset).not.toHaveBeenCalled()
    expect(scheduler.reset).not.toHaveBeenCalled()
    expect(scheduler.cancelCuesByRuleIds).toHaveBeenCalledWith(
      ['rule_item_purchase_guidance'],
      'capability-disabled'
    )
  })

  it('unconditionally calls endSession and clears all cues/evidence on exiting InProgress to None/WaitingForStats', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any

    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()

    // 1. 进入对局 InProgress
    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { gameId: 88888, queue: { id: 420 } }
    })
    expect(ctx.state.setSessionInfo).toHaveBeenCalledWith(
      expect.objectContaining({ id: '88888', state: 'active' })
    )

    // 2. 离开对局回到大厅 (None)
    scheduler.reset.mockClear()
    ctx.setGameflow('None', null)

    // 断言：调用 endSession 触发 reset，清空调度器与状态
    expect(scheduler.reset).toHaveBeenCalled()
    expect(ctx.state.reset).toHaveBeenCalled()

    // 3. 再次进入下一局，确保是全新干净会话
    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { gameId: 99999, queue: { id: 420 } }
    })
    expect(ctx.state.setSessionInfo).toHaveBeenCalledWith(
      expect.objectContaining({ id: '99999', state: 'active' })
    )

    controller.dispose()
  })

  it('does not reset evidence or rule state when the same gameflow session object is refreshed', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()

    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { gameId: 88888, queue: { id: 420 } }
    })
    const fusionReset = vi.spyOn(controller.fusion, 'reset')
    scheduler.reset.mockClear()

    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { gameId: 88888, queue: { id: 420 }, refreshed: true }
    })

    expect(fusionReset).not.toHaveBeenCalled()
    expect(scheduler.reset).not.toHaveBeenCalled()
    expect(ctx.state.setSessionInfo).toHaveBeenLastCalledWith({
      mapId: 11,
      queueId: 420,
      patch: 'unknown'
    })
    controller.dispose()
  })

  it('supports manual-only mode without stopping an already running manual session', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    ctx.setAutoStartEnabled(false)
    controller.init()

    const gameflowSession = {
      map: { id: 11 },
      gameData: { gameId: 88888, queue: { id: 420 } }
    }
    ctx.setGameflow('InProgress', gameflowSession)
    expect(ctx.state.session.state).toBe('idle')

    controller.startSession('88888', 11, 420, '16.16.1')
    expect(ctx.state.session.state).toBe('active')
    ctx.setGameflow('InProgress', {
      ...gameflowSession,
      gameData: { ...gameflowSession.gameData, refreshed: true }
    })
    expect(ctx.state.session.state).toBe('active')
    controller.dispose()
  })

  it('fully clears an active session before entering the disabled state', async () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.startSession('sess-disable', 11, 420, '16.16.1')

    ctx.setEnabled(false)
    controller.init()
    ctx.setGameflow('Lobby', null)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(ctx.state.reset).toHaveBeenCalledWith('disabled', true)
    expect(scheduler.reset).toHaveBeenCalled()
    expect(capabilityController.evaluateCapabilities).toHaveBeenCalled()
    expect(ctx.state.session.state).toBe('disabled')
    controller.dispose()
  })

  it('clears the previous session before entering degraded state on an unsupported map', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.startSession('summoners-rift', 11, 420, '16.16.1')
    const fusionReset = vi.spyOn(controller.fusion, 'reset')
    scheduler.reset.mockClear()

    controller.startSession('aram', 12, 450, '16.16.1')

    expect(scheduler.reset).toHaveBeenCalledOnce()
    expect(fusionReset).toHaveBeenCalledOnce()
    expect(ctx.state.reset).toHaveBeenCalledWith('degraded')
    expect(ctx.state.session.state).toBe('degraded')
    controller.dispose()
  })

  it('ignores pause and resume commands when no matching active session exists', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)

    controller.pause('no-session')
    controller.resume()

    expect(ctx.state.setSessionState).not.toHaveBeenCalled()
    expect(scheduler.reset).not.toHaveBeenCalled()
    expect(ctx.state.session.state).toBe('idle')
    controller.dispose()
  })

  it('invalidates stale live-data evidence as soon as the 2999 source degrades', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = {
      reset: vi.fn(),
      submitCues: vi.fn(),
      cancelCuesByEvidenceIds: vi.fn()
    } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.startSession('session-1', 11, 420, '16.16.1')
    const now = Date.now()
    controller.fusion.addEvidence({
      id: 'live-evidence',
      sessionId: 'session-1',
      temporalScope: 'current',
      source: 'live-client-data',
      kind: 'player-economy-inventory',
      confidence: 1,
      patch: '16.16.1',
      clock: { observedAt: now, receivedAt: now, sequence: 1 },
      freshness: { expiresAt: now + 30000, state: 'fresh' },
      payload: null
    })
    controller.fusion.addEvidence({
      id: 'minimap-evidence',
      sessionId: 'session-1',
      temporalScope: 'current',
      source: 'minimap',
      kind: 'enemy-seen',
      confidence: 1,
      patch: '16.16.1',
      clock: { observedAt: now, receivedAt: now, sequence: 1 },
      freshness: { expiresAt: now + 30000, state: 'fresh' },
      payload: null
    })

    ;(controller as any)._onLiveGameSnapshot({
      sessionId: 'session-1',
      patch: '16.16.1',
      gameTimeSeconds: 300,
      activePlayer: null,
      players: [],
      events: [],
      sourceHealth: [
        {
          domain: 'game-stats',
          state: 'degraded',
          lastSuccessAt: now - 3000,
          lastErrorCode: 'ECONNREFUSED',
          consecutiveFailures: 1
        }
      ],
      clock: { observedAt: now - 3000, receivedAt: now, sequence: 2 }
    })

    expect(ctx.state.setLiveDataState).toHaveBeenCalledWith('degraded', now - 3000, [
      expect.objectContaining({
        domain: 'game-stats',
        state: 'degraded',
        consecutiveFailures: 1
      })
    ])
    expect(controller.fusion.getEvidence('live-evidence')).toBeNull()
    expect(controller.fusion.getEvidence('minimap-evidence')).not.toBeNull()
    controller.dispose()
  })

  it('does not enter an active session until both map and queue are resolved', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()

    ctx.setGameflow('InProgress', { gameData: { gameId: 1 } })
    expect(ctx.state.session.state).toBe('degraded')

    ctx.setGameflow('InProgress', { map: { id: 11 }, gameData: { gameId: 1 } })
    expect(ctx.state.session.state).toBe('degraded')

    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { gameId: 1, queue: { id: 420 } }
    })
    expect(ctx.state.session.state).toBe('active')
    controller.dispose()
  })

  it("auto-starts a Summoner's Rift custom game before LCU finishes resolving its queue", () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()

    ctx.setGameflow('InProgress', {
      map: { id: 11, gameMode: 'CLASSIC' },
      gameData: { gameId: 234567, isCustomGame: true }
    })

    expect(ctx.state.session.state).toBe('active')
    expect(ctx.state.setSessionInfo).toHaveBeenCalledWith(
      expect.objectContaining({ id: '234567', mapId: 11, queueId: 0, state: 'active' })
    )
    expect(capabilityController.evaluateCapabilities).toHaveBeenCalledWith(
      11,
      0,
      'unknown',
      expect.any(Object)
    )
    controller.dispose()
  })

  it('does not auto-start a tutorial that happens to report the custom queue id', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()

    ctx.setGameflow('InProgress', {
      map: { id: 11, gameMode: 'TUTORIAL' },
      gameData: {
        gameId: 345678,
        isCustomGame: true,
        queue: { id: 0, isCustom: true }
      }
    })

    expect(ctx.state.session.state).toBe('degraded')
    expect(ctx.state.session.id).toBe('')
    expect(capabilityController.evaluateCapabilities).toHaveBeenLastCalledWith(
      11,
      null,
      'unknown',
      expect.any(Object)
    )
    controller.dispose()
  })

  it('uses the shared provisional id until LCU exposes the official game id', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()

    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { queue: { id: 420 } }
    })

    expect(ctx.state.session.id).toBe('pending-game')

    const provisionalStartedAt = ctx.state.setSessionInfo.mock.calls.at(-1)?.[0].startedAt
    ctx.state.clearSessionArtifacts.mockClear()
    scheduler.reset.mockClear()

    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { gameId: 123456, queue: { id: 420 } }
    })

    expect(ctx.state.session.id).toBe('123456')
    expect(ctx.state.session.state).toBe('active')
    expect(ctx.state.clearSessionArtifacts).toHaveBeenCalledOnce()
    expect(scheduler.reset).toHaveBeenCalledWith(true)
    const promotedSessionInfo = ctx.state.setSessionInfo.mock.calls.at(-1)?.[0]
    expect(promotedSessionInfo).toEqual({
      id: '123456',
      mapId: 11,
      queueId: 420,
      patch: 'unknown'
    })
    expect(promotedSessionInfo).not.toHaveProperty('startedAt')
    expect(provisionalStartedAt).toEqual(expect.any(Number))
    controller.dispose()
  })

  it('promotes a manually started provisional session when automatic start is disabled', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()
    ctx.setAutoStartEnabled(false)

    controller.startSession('pending-game', 11, 420, '16.16.1')
    ctx.state.completeSessionSummary.mockClear()

    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { gameId: 987654, queue: { id: 420 } }
    })

    expect(ctx.state.session.id).toBe('987654')
    expect(ctx.state.session.state).toBe('active')
    expect(ctx.state.completeSessionSummary).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('resumes an environment-paused provisional session while promoting its official id', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()
    const provisionalGameflowSession = {
      map: { id: 11 },
      gameData: { queue: { id: 420 } }
    }

    ctx.setGameflow('InProgress', provisionalGameflowSession)
    expect(ctx.state.session.id).toBe('pending-game')
    ctx.setGameflow('Reconnect', provisionalGameflowSession)
    expect(ctx.state.session.pauseReason).toBe('environment-abnormal')

    ctx.setGameflow('InProgress', {
      map: { id: 11 },
      gameData: { gameId: 112233, queue: { id: 420 } }
    })

    expect(ctx.state.session.id).toBe('112233')
    expect(ctx.state.session.state).toBe('active')
    expect(ctx.state.session.pauseReason).toBeNull()
    controller.dispose()
  })

  it('pauses during reconnect and resumes the same game without ending the session', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()
    const gameflowSession = {
      map: { id: 11 },
      gameData: { gameId: 246810, queue: { id: 420 } }
    }

    ctx.setGameflow('InProgress', gameflowSession)
    expect(ctx.state.session.id).toBe('246810')
    expect(ctx.state.session.state).toBe('active')
    ctx.state.completeSessionSummary.mockClear()

    ctx.setGameflow('Reconnect', gameflowSession)
    expect(ctx.state.session.state).toBe('paused')
    expect(ctx.state.session.pauseReason).toBe('environment-abnormal')
    expect(ctx.state.completeSessionSummary).not.toHaveBeenCalled()

    ctx.setGameflow('InProgress', gameflowSession)
    expect(ctx.state.session.id).toBe('246810')
    expect(ctx.state.session.state).toBe('active')
    expect(ctx.state.session.pauseReason).toBeNull()
    expect(ctx.state.completeSessionSummary).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('does not auto-resume a user-paused session after reconnect', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.init()
    const gameflowSession = {
      map: { id: 11 },
      gameData: { gameId: 135790, queue: { id: 420 } }
    }

    ctx.setGameflow('InProgress', gameflowSession)
    controller.pause('user-pause')
    ctx.setGameflow('Reconnect', gameflowSession)
    ctx.setGameflow('InProgress', gameflowSession)

    expect(ctx.state.session.state).toBe('paused')
    expect(ctx.state.session.pauseReason).toBe('user-pause')
    controller.dispose()
  })

  it('rejects late minimap and live-data payloads from a previous session', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = {
      reset: vi.fn(),
      submitCues: vi.fn(),
      cancelCuesByEvidenceIds: vi.fn()
    } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)
    controller.startSession('current-session', 11, 420, '16.16.1')
    const minimapSpy = vi.spyOn(controller.fusion, 'updateMinimapBatch')
    const liveDataSpy = vi.spyOn(controller.fusion, 'updateLiveGameSnapshot')
    const now = Date.now()

    controller.handleMinimapBatch({
      sessionId: 'old-session',
      patch: '16.16.1',
      calibrationVersion: '1.0.0',
      modelVersions: {},
      frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 0 },
      health: 'healthy',
      entities: [],
      events: []
    })
    ;(controller as any)._onLiveGameSnapshot({
      sessionId: 'old-session',
      patch: '16.16.1',
      gameTimeSeconds: 100,
      activePlayer: null,
      players: [],
      events: [],
      sourceHealth: [],
      clock: { observedAt: now, receivedAt: now, sequence: 1 }
    })

    expect(minimapSpy).not.toHaveBeenCalled()
    expect(liveDataSpy).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('does not carry a supported patch catalog into the next game', () => {
    const ctx = createMockContext()
    const capabilityController = { evaluateCapabilities: vi.fn(), isGateAEnabled: true } as any
    const scheduler = { reset: vi.fn(), submitCues: vi.fn() } as any
    const controller = new LiveCoachSessionController(ctx, capabilityController, scheduler)

    controller.latestPatch = '16.16.1'
    controller.startSession('finished-session', 11, 420, '16.16.1')
    controller.endSession('gameflow-phase-WaitingForStats')

    expect(controller.latestPatch).toBeNull()
  })
})
