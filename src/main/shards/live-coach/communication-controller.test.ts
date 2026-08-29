import type { CoachCuePublicDto } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { CommunicationController } from './communication-controller'
import { LiveCoachSettings, LiveCoachState } from './state'

function createCue(overrides: Partial<CoachCuePublicDto> = {}): CoachCuePublicDto {
  return {
    id: 'cue-1',
    sessionId: 'session-1',
    category: 'information',
    priority: 60,
    observationText: '敌人可能游走',
    impactText: '提醒队友',
    options: [
      { id: 'opt_ping_danger', label: '危险', role: 'primary' },
      { id: 'opt_ping_missing', label: '失踪', role: 'alternative' }
    ],
    spokenText: '建议报点',
    createdAt: 90_000,
    expiresAt: 120_000,
    status: 'spoken',
    ...overrides
  }
}

function createHarness(cue: CoachCuePublicDto | null = createCue()) {
  const settings = new LiveCoachSettings()
  const state = new LiveCoachState()
  state.setSessionInfo({ id: 'session-1', state: 'active' })
  state.setCapability(['coach.communication.ping', 'coach.communication.chat'], {})
  state.setCue(cue)
  const writeClipboard = vi.fn()
  const logger = { warn: vi.fn() }
  const controller = new CommunicationController({ settings, state, logger } as any, writeClipboard)
  return { controller, logger, settings, state, writeClipboard }
}

describe('CommunicationController', () => {
  it('copies an explicitly confirmed communication template and records the audit', () => {
    const { controller, state, writeClipboard } = createHarness()

    const result = controller.confirmCueOption('cue-1', 'opt_ping_danger', 100_000)

    expect(result).toMatchObject({
      action: 'copied',
      channel: 'ping',
      kind: 'danger',
      message: '危险，请后退',
      reason: 'approved-in-game-send-interface-unavailable'
    })
    expect(writeClipboard).toHaveBeenCalledWith('危险，请后退')
    expect(state.communicationHistory).toEqual([result])
  })

  it('rate-limits repeated confirmation without writing to the clipboard again', () => {
    const { controller, writeClipboard } = createHarness()

    controller.confirmCueOption('cue-1', 'opt_ping_danger', 100_000)
    const result = controller.confirmCueOption('cue-1', 'opt_ping_missing', 105_000)

    expect(result).toMatchObject({ action: 'blocked', reason: 'rate-limited' })
    expect(writeClipboard).toHaveBeenCalledTimes(1)
  })

  it('does not treat ordinary tactical options as communication actions', () => {
    const cue = createCue({ options: [{ id: 'opt_enemy_deaths_objective', label: '争夺资源' }] })
    const { controller, writeClipboard } = createHarness(cue)

    const result = controller.confirmCueOption(cue.id, cue.options[0].id, 100_000)

    expect(result).toMatchObject({
      action: 'blocked',
      reason: 'option-is-not-communication-suggestion'
    })
    expect(writeClipboard).not.toHaveBeenCalled()
  })

  it('skips expired cues when confirming the latest available suggestion', () => {
    const { controller, state, writeClipboard } = createHarness(
      createCue({ id: 'expired', expiresAt: 99_000, status: 'expired' })
    )
    state.recentCues = [createCue({ id: 'valid', expiresAt: 120_000 })]

    const result = controller.confirmLatest(100_000)

    expect(result).toMatchObject({ cueId: 'valid', action: 'copied' })
    expect(writeClipboard).toHaveBeenCalledOnce()
  })

  it('blocks confirmation when its feature capability is unavailable', () => {
    const { controller, state, writeClipboard } = createHarness()
    state.setCapability([], { 'coach.communication.ping': 'capability-disabled' })

    const result = controller.confirmCueOption('cue-1', 'opt_ping_danger', 100_000)

    expect(result).toMatchObject({
      action: 'blocked',
      reason: 'communication-capability-unavailable'
    })
    expect(writeClipboard).not.toHaveBeenCalled()
  })

  it('blocks a communication category that the user disabled', () => {
    const { controller, settings, writeClipboard } = createHarness()
    settings.setCommunicationCategories({
      ...settings.communicationCategories,
      danger: false
    })

    const result = controller.confirmCueOption('cue-1', 'opt_ping_danger', 100_000)

    expect(result).toMatchObject({
      action: 'blocked',
      reason: 'communication-category-disabled'
    })
    expect(writeClipboard).not.toHaveBeenCalled()
  })
})
