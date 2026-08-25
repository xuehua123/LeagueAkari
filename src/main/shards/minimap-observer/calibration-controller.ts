import { CaptureEnvironmentFingerprint, MinimapCalibration } from '@shared/types/live-coach'

import type { MinimapObserverMainContext } from './context'

export class MinimapCalibrationController {
  constructor(private readonly _context: MinimapObserverMainContext) {}

  public getEnvironmentFingerprint(): CaptureEnvironmentFingerprint {
    const side = (this._context.liveCoach.settings.minimapSide === 'left' ? 'left' : 'right') as
      'left' | 'right'
    return {
      displayId: 'primary_display',
      width: 1920,
      height: 1080,
      dpiScale: 1.0,
      hdr: false,
      windowMode: 'borderless',
      backend: 'wgc',
      minimapSide: side
    }
  }

  public getOrCreateCalibration(): MinimapCalibration {
    if (this._context.state.currentCalibration) {
      return this._context.state.currentCalibration
    }

    const fingerprint = this.getEnvironmentFingerprint()
    const isLeft = fingerprint.minimapSide === 'left'

    // Standard SR Minimap normalized coords in 1080p HUD
    const defaultRoi = isLeft
      ? { x: 0.0, y: 0.72, width: 0.18, height: 0.28 }
      : { x: 0.82, y: 0.72, width: 0.18, height: 0.28 }

    const calibration: MinimapCalibration = {
      schemaVersion: 1,
      id: `calib_${Date.now()}`,
      fingerprintHash: `fp_${fingerprint.width}x${fingerprint.height}_${fingerprint.minimapSide}`,
      roi: defaultRoi,
      transform: 'blue-normal',
      source: 'automatic',
      confidence: 0.95,
      createdAt: Date.now()
    }

    this._context.state.setCurrentCalibration(calibration)
    return calibration
  }

  public applyManualCalibration(
    roi: { x: number; y: number; width: number; height: number },
    side: 'left' | 'right'
  ): MinimapCalibration {
    const fingerprint = this.getEnvironmentFingerprint()
    const calibration: MinimapCalibration = {
      schemaVersion: 1,
      id: `calib_manual_${Date.now()}`,
      fingerprintHash: `fp_${fingerprint.width}x${fingerprint.height}_${side}`,
      roi,
      transform: 'blue-normal',
      source: 'manual',
      confidence: 1.0,
      createdAt: Date.now()
    }

    this._context.state.setCurrentCalibration(calibration)
    return calibration
  }

  public resetCalibration(): void {
    this._context.state.setCurrentCalibration(null)
  }
}
