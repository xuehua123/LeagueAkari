import { CaptureEnvironmentFingerprint, MinimapCalibration } from '@shared/types/live-coach'
import { screen } from 'electron'
import os from 'node:os'

import type { MinimapObserverMainContext } from './context'

export class MinimapCalibrationController {
  constructor(private readonly _context: MinimapObserverMainContext) {}

  public getEnvironmentFingerprint(): CaptureEnvironmentFingerprint {
    const side = (this._context.liveCoach.settings.minimapSide === 'left' ? 'left' : 'right') as
      'left' | 'right'

    let width = 1920
    let height = 1080
    let dpiScale = 1.0
    let displayId = 'primary'
    let isHdr = false

    try {
      const primary = screen.getPrimaryDisplay()
      if (primary) {
        width = primary.size.width
        height = primary.size.height
        dpiScale = primary.scaleFactor || 1.0
        displayId = String(primary.id)
      }
    } catch {
      // Electron screen might not be ready yet in tests
    }

    const isWin = process.platform === 'win32'
    let backend: 'wgc' | 'dda' = 'wgc'
    if (isWin) {
      const releaseMajor = parseInt(os.release().split('.')[0] || '0', 10)
      backend = releaseMajor >= 10 ? 'wgc' : 'dda'
    } else {
      backend = 'wgc'
    }

    return {
      displayId,
      width,
      height,
      dpiScale,
      hdr: isHdr,
      windowMode: 'borderless',
      backend,
      minimapSide: side
    }
  }

  public getOrCreateCalibration(): MinimapCalibration {
    if (this._context.state.currentCalibration) {
      return this._context.state.currentCalibration
    }

    const fingerprint = this.getEnvironmentFingerprint()
    const isLeft = fingerprint.minimapSide === 'left'

    // 根据屏幕长宽比计算置信度
    const aspect = fingerprint.width / Math.max(1, fingerprint.height)
    const confidence =
      Math.abs(aspect - 16 / 9) < 0.05
        ? 0.98
        : Math.abs(aspect - 16 / 10) < 0.05
          ? 0.92
          : Math.abs(aspect - 21 / 9) < 0.05
            ? 0.85
            : 0.8

    // 经典召唤师峡谷小地图归一化坐标基准
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
      confidence,
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

  public resetCalibration(): MinimapCalibration {
    this._context.state.setCurrentCalibration(null)
    return this.getOrCreateCalibration()
  }
}
