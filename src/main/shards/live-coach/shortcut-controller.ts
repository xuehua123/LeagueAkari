import type { KeyboardShortcutsMain } from '../keyboard-shortcuts'
import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import type { WindowManagerMain } from '../window-manager'
import type { CommunicationController } from './communication-controller'
import type { LiveCoachMainContext } from './context'
import type { CueSchedulerController } from './cue-scheduler-controller'
import type { LiveCoachSessionController } from './session-controller'

type ShortcutSettingKey =
  | 'pauseShortcut'
  | 'muteShortcut'
  | 'repeatShortcut'
  | 'overlayShortcut'
  | 'communicationConfirmShortcut'

export class LiveCoachShortcutController {
  static readonly PAUSE_TARGET_ID = 'live-coach-main/pause'
  static readonly MUTE_TARGET_ID = 'live-coach-main/mute'
  static readonly REPEAT_TARGET_ID = 'live-coach-main/repeat'
  static readonly OVERLAY_TARGET_ID = 'window-manager-main/coach-overlay-window/interaction'
  static readonly COMMUNICATION_CONFIRM_TARGET_ID = 'live-coach-main/communication-confirm'

  private readonly _disposers: Array<() => void> = []

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _sessionController: LiveCoachSessionController,
    private readonly _cueScheduler: CueSchedulerController,
    private readonly _keyboardShortcuts: KeyboardShortcutsMain,
    private readonly _windowManager: WindowManagerMain,
    private readonly _communicationController?: CommunicationController
  ) {}

  public init(): void {
    this._disposers.push(
      this._context.mobxUtils.reaction(
        () => this._context.settings.muted,
        (muted) => this._cueScheduler.applyMuteState(muted),
        { fireImmediately: true }
      )
    )
    this._disposers.push(
      this._context.mobxUtils.reaction(
        () =>
          this._context.settings.speechEnabled &&
          this._context.settings.outputMode.includes('speech'),
        (speechOutputEnabled) => {
          if (!speechOutputEnabled) {
            this._cueScheduler.cancelSpeechPlayback()
          }
        }
      )
    )
    this._disposers.push(
      this._context.mobxUtils.reaction(
        () => this._context.settings.cueCategories,
        (categories) => this._cueScheduler.applyCategorySettings(categories)
      )
    )
    this._disposers.push(
      this._context.mobxUtils.reaction(
        () => this._context.settings.coachMode,
        (mode) => this._cueScheduler.applyCoachMode(mode)
      )
    )
    this._disposers.push(
      this._context.mobxUtils.reaction(
        () => ({
          density: this._context.settings.cueDensity,
          interval: this._context.settings.minimumCueIntervalSeconds
        }),
        () => this._cueScheduler.applyPacingSettings?.()
      )
    )

    this._watchShortcut('pauseShortcut', LiveCoachShortcutController.PAUSE_TARGET_ID, () =>
      this._togglePause()
    )
    this._watchShortcut('muteShortcut', LiveCoachShortcutController.MUTE_TARGET_ID, () =>
      this._toggleMute()
    )
    this._watchShortcut('repeatShortcut', LiveCoachShortcutController.REPEAT_TARGET_ID, () =>
      this._cueScheduler.showLastCueAgain()
    )
    this._watchShortcut(
      'overlayShortcut',
      LiveCoachShortcutController.OVERLAY_TARGET_ID,
      (pressed) => void this._windowManager.coachOverlayWindow.setInteractionMode(pressed),
      'stateful'
    )
    if (this._communicationController) {
      this._watchShortcut(
        'communicationConfirmShortcut',
        LiveCoachShortcutController.COMMUNICATION_CONFIRM_TARGET_ID,
        () => this._communicationController?.confirmLatest()
      )
    }
  }

  public dispose(): void {
    for (const dispose of this._disposers.splice(0)) {
      dispose()
    }
    this._keyboardShortcuts.unregisterByTargetId(LiveCoachShortcutController.PAUSE_TARGET_ID)
    this._keyboardShortcuts.unregisterByTargetId(LiveCoachShortcutController.MUTE_TARGET_ID)
    this._keyboardShortcuts.unregisterByTargetId(LiveCoachShortcutController.REPEAT_TARGET_ID)
    this._keyboardShortcuts.unregisterByTargetId(LiveCoachShortcutController.OVERLAY_TARGET_ID)
    this._keyboardShortcuts.unregisterByTargetId(
      LiveCoachShortcutController.COMMUNICATION_CONFIRM_TARGET_ID
    )
    void this._windowManager.coachOverlayWindow.setInteractionMode(false)
  }

  private _watchShortcut(
    settingKey: ShortcutSettingKey,
    targetId: string,
    callback: (pressed: boolean) => void,
    type: 'normal' | 'stateful' = 'normal'
  ): void {
    this._disposers.push(
      this._context.mobxUtils.reaction(
        () => this._context.settings[settingKey],
        (shortcut) => {
          if (settingKey === 'overlayShortcut') {
            void this._windowManager.coachOverlayWindow.setInteractionMode(false)
          }
          this._keyboardShortcuts.unregisterByTargetId(targetId)
          if (!shortcut) {
            return
          }

          try {
            this._keyboardShortcuts.register(targetId, shortcut, type, (details) =>
              callback(details.pressed)
            )
          } catch (error) {
            this._context.logger.warn(
              formatSanitizedErrorLog(`Failed to register ${settingKey}`, error)
            )
            void this._context.settingService.set(settingKey, null)
          }
        },
        { fireImmediately: true }
      )
    )
  }

  private _togglePause(): void {
    if (
      this._context.state.session.state === 'active' ||
      this._context.state.session.state === 'shadow'
    ) {
      this._sessionController.pause('global-shortcut')
    } else if (this._context.state.session.state === 'paused') {
      this._sessionController.resume()
    }
  }

  private _toggleMute(): void {
    const muted = !this._context.settings.muted
    void this._context.settingService.set('muted', muted)
  }
}
