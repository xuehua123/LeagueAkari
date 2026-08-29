import { MinimapCalibration } from '@shared/types/live-coach'
import { makeAutoObservable, observable } from 'mobx'

export class MinimapObserverState {
  public isCapturing: boolean = false
  public backend: 'wgc' | 'dda' | 'desktopCapturer' | 'unavailable' = 'unavailable'
  public fps: number = 0
  public frameAgeMs: number | null = null
  public roiHealth: 'healthy' | 'degraded' | 'occluded' | 'unknown' = 'unknown'
  public currentCalibration: MinimapCalibration | null = null

  constructor() {
    makeAutoObservable(this, {
      currentCalibration: observable.ref
    })
  }

  setIsCapturing(capturing: boolean) {
    this.isCapturing = capturing
  }

  setBackend(backend: 'wgc' | 'dda' | 'desktopCapturer' | 'unavailable') {
    this.backend = backend
  }

  setFps(fps: number) {
    this.fps = fps
  }

  setFrameAgeMs(age: number | null) {
    this.frameAgeMs = age
  }

  setRoiHealth(health: 'healthy' | 'degraded' | 'occluded' | 'unknown') {
    this.roiHealth = health
  }

  setCurrentCalibration(calibration: MinimapCalibration | null) {
    this.currentCalibration = calibration
  }

  reset() {
    this.isCapturing = false
    this.backend = 'unavailable'
    this.fps = 0
    this.frameAgeMs = null
    this.roiHealth = 'unknown'
  }
}
