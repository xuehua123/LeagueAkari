import { makeAutoObservable } from 'mobx'

import { BaseAkariWindowBasicSetting, BaseAkariWindowBasicState } from '../base-akari-window'

export class CoachOverlayWindowSettings implements BaseAkariWindowBasicSetting {
  public enabled: boolean = true
  public pinned: boolean = true
  public opacity: number = 0.92
  public showShortcut: string | null = null
  public locked: boolean = true

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  setPinned(pinned: boolean) {
    this.pinned = pinned
  }

  setOpacity(opacity: number) {
    this.opacity = opacity
  }

  setShowShortcut(showShortcut: string | null) {
    this.showShortcut = showShortcut
  }

  setLocked(locked: boolean) {
    this.locked = locked
  }

  constructor() {
    makeAutoObservable(this)
  }
}

export class CoachOverlayWindowState implements BaseAkariWindowBasicState {
  public status: 'normal' | 'maximized' | 'minimized' = 'normal'
  public focus: 'focused' | 'blurred' = 'blurred'
  public ready: boolean = false
  public show: boolean = false
  public trackedBounds: Electron.Rectangle | null = null
  public interactive: boolean = false

  setInteractive(interactive: boolean) {
    this.interactive = interactive
  }

  constructor() {
    makeAutoObservable(this)
  }
}
