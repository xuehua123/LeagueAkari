import { reaction, runInAction } from 'mobx'
import { describe, expect, it, vi } from 'vitest'

import { LiveCoachShortcutController } from './shortcut-controller'
import { LiveCoachSettings } from './state'

describe('LiveCoachShortcutController', () => {
  it('registers global controls and executes pause, mute, repeat, and overlay actions', () => {
    const settings = new LiveCoachSettings()
    settings.outputMode = ['subtitle', 'speech']
    const state = { session: { state: 'active' } }
    const callbacks = new Map<string, (details: { pressed: boolean }) => void>()
    const keyboard = {
      register: vi.fn(
        (
          targetId: string,
          _shortcut: string,
          _type: string,
          callback: (details: { pressed: boolean }) => void
        ) => callbacks.set(targetId, callback)
      ),
      unregisterByTargetId: vi.fn()
    }
    const settingService = {
      set: vi.fn((key: keyof LiveCoachSettings, value: unknown) => {
        runInAction(() => {
          ;(settings as any)[key] = value
        })
        return Promise.resolve()
      })
    }
    const sessionController = { pause: vi.fn(), resume: vi.fn() }
    const cueScheduler = {
      applyMuteState: vi.fn(),
      cancelSpeechPlayback: vi.fn(),
      applyCategorySettings: vi.fn(),
      applyCoachMode: vi.fn(),
      showLastCueAgain: vi.fn()
    }
    const overlayWindow = { setInteractionMode: vi.fn().mockResolvedValue(undefined) }
    const context = {
      settings,
      state,
      settingService,
      mobxUtils: { reaction },
      logger: { warn: vi.fn() }
    } as any
    const communicationController = { confirmLatest: vi.fn() }
    const controller = new LiveCoachShortcutController(
      context,
      sessionController as any,
      cueScheduler as any,
      keyboard as any,
      { coachOverlayWindow: overlayWindow } as any,
      communicationController as any
    )

    controller.init()
    runInAction(() => {
      settings.pauseShortcut = 'Control+P'
      settings.muteShortcut = 'Control+M'
      settings.repeatShortcut = 'Control+R'
      settings.overlayShortcut = 'Control+O'
      settings.communicationConfirmShortcut = 'Control+C'
    })

    callbacks.get(LiveCoachShortcutController.PAUSE_TARGET_ID)?.({ pressed: true })
    expect(sessionController.pause).toHaveBeenCalledWith('global-shortcut')

    runInAction(() => {
      state.session.state = 'shadow'
    })
    callbacks.get(LiveCoachShortcutController.PAUSE_TARGET_ID)?.({ pressed: true })
    expect(sessionController.pause).toHaveBeenCalledTimes(2)

    runInAction(() => {
      state.session.state = 'paused'
    })
    callbacks.get(LiveCoachShortcutController.PAUSE_TARGET_ID)?.({ pressed: true })
    expect(sessionController.resume).toHaveBeenCalledOnce()

    callbacks.get(LiveCoachShortcutController.MUTE_TARGET_ID)?.({ pressed: true })
    expect(cueScheduler.applyMuteState).toHaveBeenCalledWith(true)
    expect(settingService.set).toHaveBeenCalledWith('muted', true)

    runInAction(() => {
      settings.speechEnabled = false
    })
    expect(cueScheduler.cancelSpeechPlayback).toHaveBeenCalledOnce()

    runInAction(() => {
      settings.cueCategories = { ...settings.cueCategories, warning: false }
    })
    expect(cueScheduler.applyCategorySettings).toHaveBeenCalledWith(
      expect.objectContaining({ warning: false })
    )

    runInAction(() => {
      settings.coachMode = 'minimal'
    })
    expect(cueScheduler.applyCoachMode).toHaveBeenCalledWith('minimal')

    callbacks.get(LiveCoachShortcutController.REPEAT_TARGET_ID)?.({ pressed: true })
    expect(cueScheduler.showLastCueAgain).toHaveBeenCalledOnce()

    callbacks.get(LiveCoachShortcutController.OVERLAY_TARGET_ID)?.({ pressed: true })
    callbacks.get(LiveCoachShortcutController.OVERLAY_TARGET_ID)?.({ pressed: false })
    expect(overlayWindow.setInteractionMode).toHaveBeenCalledWith(true)
    expect(overlayWindow.setInteractionMode).toHaveBeenLastCalledWith(false)

    callbacks.get(LiveCoachShortcutController.COMMUNICATION_CONFIRM_TARGET_ID)?.({ pressed: true })
    expect(communicationController.confirmLatest).toHaveBeenCalledOnce()

    controller.dispose()
    expect(keyboard.unregisterByTargetId).toHaveBeenCalledWith(
      LiveCoachShortcutController.OVERLAY_TARGET_ID
    )
    expect(keyboard.unregisterByTargetId).toHaveBeenCalledWith(
      LiveCoachShortcutController.COMMUNICATION_CONFIRM_TARGET_ID
    )
  })
})
