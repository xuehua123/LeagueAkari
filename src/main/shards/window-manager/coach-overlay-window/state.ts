import { makeAutoObservable } from 'mobx'

import { BaseAkariWindowBasicSetting, BaseAkariWindowBasicState } from '../base-akari-window'

export class CoachOverlayWindowSettings implements BaseAkariWindowBasicSetting {
  public enabled: boolean = true
  public pinned: boolean = true
  public opacity: number = 0.92
  public showShortcut: string | null = null

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

  constructor() {
    makeAutoObservable(this)
  }
}
