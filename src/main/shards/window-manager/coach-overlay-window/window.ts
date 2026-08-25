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
      rememberSize: false,
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
        }
      },
      browserWindowOptions: {
        title: AkariCoachOverlayWindow.TITLE,
        icon,
        frame: false,
        transparent: true,
        resizable: false,
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
    this._window.setIgnoreMouseEvents(true, { forward: true })
  }

  public override async onInit(): Promise<void> {
    await super.onInit()

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

    // 2. 窗口 Ready 后显示并设置点击穿透
    this._mobxUtils.reaction(
      () => this.state.ready,
      (ready) => {
        if (ready && this._window) {
          this._applyOverlayWindowBehavior()
          this.show()

          this._window.on('show', () => {
            this._applyOverlayWindowBehavior()
          })
        }
      },
      { fireImmediately: true, equals: comparer.shallow }
    )

    // 3. 对局内根据 Gameflow 联动显示与隐藏
    this._mobxUtils.reaction(
      () => this._leagueClient.data.gameflow.phase,
      (phase) => {
        if (this._window && !this._window.isDestroyed()) {
          if (phase === 'InProgress') {
            this.show()
            this._applyOverlayWindowBehavior()
          } else if (phase === 'PreEndOfGame' || phase === 'EndOfGame') {
            // 对局结束可保留悬浮窗展示或淡出
          }
        }
      }
    )
  }
}
