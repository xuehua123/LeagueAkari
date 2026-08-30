import { is } from '@electron-toolkit/utils'
import { GameClientMain } from '@main/shards/game-client'
import { AkariIpcError } from '@main/shards/ipc'
import icon from '@resources/LA_ICON.ico?asset'
import { comparer } from 'mobx'
import { z } from 'zod'

import { BaseAkariWindow } from '../base-akari-window'
import type { WindowManagerMainContext } from '../context'
import { CoachOverlayWindowSettings, CoachOverlayWindowState } from './state'

export class AkariCoachOverlayWindow extends BaseAkariWindow<
  CoachOverlayWindowState,
  CoachOverlayWindowSettings
> {
  static readonly NAMESPACE_SUFFIX = 'coach-overlay-window'
  static readonly HTML_ENTRY = 'coach-overlay-window.html'
  static readonly TITLE = 'Coach Overlay'
  static readonly BASE_WIDTH = 420
  static readonly BASE_HEIGHT = 168
  static readonly MIN_WIDTH = 320
  static readonly MIN_HEIGHT = 80
  static readonly INTERACTION_SHORTCUT_TARGET_ID =
    'window-manager-main/coach-overlay-window/interaction'

  private _interactionRequestGeneration = 0

  constructor(_context: WindowManagerMainContext) {
    const state = new CoachOverlayWindowState()
    const settings = new CoachOverlayWindowSettings()

    super(_context, AkariCoachOverlayWindow.NAMESPACE_SUFFIX, state, settings, {
      baseWidth: AkariCoachOverlayWindow.BASE_WIDTH,
      baseHeight: AkariCoachOverlayWindow.BASE_HEIGHT,
      minWidth: AkariCoachOverlayWindow.MIN_WIDTH,
      minHeight: AkariCoachOverlayWindow.MIN_HEIGHT,
      htmlEntry: AkariCoachOverlayWindow.HTML_ENTRY,
      rememberPosition: true,
      rememberSize: true,
      repositionWindowIfInvisible: true,
      settingSchema: {
        pinned: {
          default: settings.pinned,
          schema: z.boolean(),
          transform: () => true
        },
        enabled: { default: settings.enabled, schema: z.boolean() },
        opacity: {
          default: settings.opacity,
          schema: z.number().min(0.2).max(1)
        },
        showShortcut: {
          default: settings.showShortcut,
          schema: z.string().nullable()
        },
        locked: { default: settings.locked, schema: z.boolean() }
      },
      browserWindowOptions: {
        title: AkariCoachOverlayWindow.TITLE,
        icon,
        frame: false,
        transparent: true,
        resizable: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: false,
        hasShadow: false,
        show: false,
        backgroundColor: '#00000000'
      }
    })
  }

  private _applyOverlayWindowBehavior() {
    if (!this._window || this._window.isDestroyed()) {
      return
    }

    this._window.setSkipTaskbar(true)
    this._window.setAlwaysOnTop(true, 'screen-saver', 1)
    const canMoveOrResize = this.state.interactive && !this.settings.locked
    this._window.setFocusable(this.state.interactive)
    this._window.setMovable(canMoveOrResize)
    this._window.setResizable(canMoveOrResize)
    this._window.setIgnoreMouseEvents(!this.state.interactive, { forward: true })
  }

  public async setInteractionMode(
    interactive: boolean,
    allowWhenGameNotForeground: boolean = false
  ): Promise<boolean> {
    const requestGeneration = ++this._interactionRequestGeneration
    if (!interactive) {
      this.state.setInteractive(false)
      this._applyOverlayWindowBehavior()
      return true
    }

    const canInteract =
      allowWhenGameNotForeground || is.dev || (await GameClientMain.isGameClientForeground())
    if (requestGeneration !== this._interactionRequestGeneration || !canInteract) {
      return false
    }

    if (!this._window || this._window.isDestroyed()) {
      this.createWindow()
    }
    if (!this._window || this._window.isDestroyed()) {
      return false
    }

    if (!this.state.show) {
      this.show()
    }
    this.state.setInteractive(true)
    this._applyOverlayWindowBehavior()
    this._window?.focus()
    return true
  }

  public override async onInit(): Promise<void> {
    await super.onInit()

    this._ipc.onCall(this._namespace, 'setInteractionMode', (event, interactive: unknown) => {
      if (typeof interactive !== 'boolean') {
        throw new AkariIpcError(
          'interactive must be a boolean',
          'CoachOverlayInteractionModeInvalid'
        )
      }

      const isMainWindowSender = event.sender === this._windowManager.mainWindow.window?.webContents
      const isCoachOverlaySender = event.sender === this._window?.webContents
      const isAllowedSender = isMainWindowSender || (!interactive && isCoachOverlaySender)
      if (!isAllowedSender) {
        throw new AkariIpcError(
          'sender cannot change coach overlay interaction mode',
          'CoachOverlayInteractionModeSenderNotAllowed'
        )
      }

      // Renderer-triggered adjustment starts while League Akari itself is foreground, so this
      // trusted UI path must not reuse the in-game shortcut's foreground requirement.
      return this.setInteractionMode(interactive, true)
    })

    // 1. 监听全局初始化完成和开关，自动创建/销毁窗口
    this._mobxUtils.reaction(
      () => [this.settings.enabled, this._windowManager.state.isManagerFinishedInit],
      ([enabled, finishedInit]) => {
        if (!finishedInit) {
          return
        }

        if (enabled) {
          this.createWindow()
        } else {
          this.close(true)
        }
      },
      {
        fireImmediately: true,
        equals: comparer.shallow,
        delay: 500
      }
    )

    // 2. 窗口 Ready 后只设置行为并保持隐藏。是否展示由 LiveCoachMain 的真实
    // 会话状态统一决定，不能仅因 Gameflow=InProgress 就向未启用教练的用户弹出。
    this._mobxUtils.reaction(
      () => this.state.ready,
      (ready) => {
        if (ready && this._window) {
          this._applyOverlayWindowBehavior()

          this._window.on('show', () => {
            this._applyOverlayWindowBehavior()
          })

          if (this.state.interactive) {
            this.show()
            this._window.focus()
          } else {
            this.hide()
          }
        }
      },
      { fireImmediately: true, equals: comparer.shallow }
    )

    this._mobxUtils.reaction(
      () => [this.state.interactive, this.settings.locked],
      () => this._applyOverlayWindowBehavior(),
      { fireImmediately: true, equals: comparer.shallow }
    )
  }

  public override hide(): void {
    this._interactionRequestGeneration++
    this.state.setInteractive(false)
    super.hide()
  }

  protected override getSettingPropKeys() {
    return ['enabled', 'showShortcut', 'locked'] as const
  }

  protected override getStatePropKeys() {
    return ['interactive'] as const
  }
}
