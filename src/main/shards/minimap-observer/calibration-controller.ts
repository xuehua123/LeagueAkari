import { CaptureEnvironmentFingerprint, MinimapCalibration } from '@shared/types/live-coach'
import { randomUUID } from 'node:crypto'

import { detectMinimapRoi } from './calibration-detection'
import type { MinimapObserverMainContext } from './context'
import { formatSanitizedErrorLog } from './public-error'

export interface CaptureTargetEnvironment {
  displayId: string
  clientBounds: { x: number; y: number; width: number; height: number }
  dpiScale: number | null
  hdr: boolean | null
  windowMode: 'windowed' | 'borderless' | 'exclusive-fullscreen' | 'unknown'
}

export class MinimapCalibrationController {
  private _targetEnvironment: CaptureTargetEnvironment | null = null

  constructor(private readonly _context: MinimapObserverMainContext) {}

  public setTargetEnvironment(environment: CaptureTargetEnvironment | null): boolean {
    const normalized = this._normalizeTargetEnvironment(environment)
    if (JSON.stringify(normalized) === JSON.stringify(this._targetEnvironment)) return false

    this._targetEnvironment = normalized
    // A calibration is display-, DPI-, HDR- and window-size-specific. Never retain the active
    // calibration when the target moves to another display or its environment becomes unknown.
    this._context.state.setCurrentCalibration(null)
    return true
  }

  public getEnvironmentFingerprint(): CaptureEnvironmentFingerprint {
    const side = (this._context.liveCoach.settings.minimapSide === 'left' ? 'left' : 'right') as
      'left' | 'right'

    const configuredBackend = this._context.liveCoach.settings.captureBackend ?? 'auto'
    const activeBackend = this._context.state.backend
    const backend =
      activeBackend && activeBackend !== 'unavailable' ? activeBackend : configuredBackend

    return {
      displayId: this._targetEnvironment?.displayId ?? null,
      width: this._targetEnvironment?.clientBounds.width ?? null,
      height: this._targetEnvironment?.clientBounds.height ?? null,
      dpiScale: this._targetEnvironment?.dpiScale ?? null,
      hdr: this._targetEnvironment?.hdr ?? null,
      windowMode: this._targetEnvironment?.windowMode ?? 'unknown',
      backend,
      minimapSide: side
    }
  }

  public getOrCreateCalibration(): MinimapCalibration {
    const fingerprint = this.getEnvironmentFingerprint()
    const expectedHashes =
      this._context.liveCoach.settings.minimapSide === 'auto'
        ? [this._fingerprintHash(fingerprint, 'left'), this._fingerprintHash(fingerprint, 'right')]
        : [this._fingerprintHash(fingerprint, fingerprint.minimapSide)]
    const expectedHash = this._fingerprintHash(fingerprint, fingerprint.minimapSide)
    const hasTargetBinding =
      fingerprint.displayId !== null &&
      fingerprint.width !== null &&
      fingerprint.height !== null &&
      fingerprint.dpiScale !== null
    const matchesFingerprint = (
      calibration: MinimapCalibration | null
    ): calibration is MinimapCalibration =>
      calibration !== null && expectedHashes.includes(calibration.fingerprintHash)

    const current = this._context.state.currentCalibration
    if (matchesFingerprint(current)) {
      return current
    }

    const persisted = this._context.liveCoach.settings.manualCalibration
    if (hasTargetBinding && matchesFingerprint(persisted)) {
      this._context.state.setCurrentCalibration(persisted)
      return persisted
    }

    const isLeft = fingerprint.minimapSide === 'left'

    // 经典召唤师峡谷小地图归一化坐标仅用于生成可编辑的候选框。
    // 未检查真实游戏画面前绝不能把屏幕长宽比当成“标定成功”的证据。
    const defaultRoi = isLeft
      ? { x: 0.0, y: 0.72, width: 0.18, height: 0.28 }
      : { x: 0.82, y: 0.72, width: 0.18, height: 0.28 }

    const calibration: MinimapCalibration = {
      schemaVersion: 1,
      id: `calib_${Date.now()}_${randomUUID()}`,
      fingerprintHash: expectedHash,
      roi: defaultRoi,
      transform: 'blue-normal',
      source: 'automatic',
      confidence: 0,
      createdAt: Date.now()
    }

    this._context.state.setCurrentCalibration(calibration)
    return calibration
  }

  public applyAutomaticDetection(
    pixels: Uint8Array,
    width: number,
    height: number
  ): MinimapCalibration {
    const detected = detectMinimapRoi(pixels, width, height)
    if (!detected) return this.getOrCreateCalibration()

    const fingerprint = this.getEnvironmentFingerprint()
    const configuredSide = this._context.liveCoach.settings.minimapSide
    const side = configuredSide === 'auto' ? detected.side : configuredSide
    const roi = {
      ...detected.roi,
      x: side === 'left' ? 0 : 1 - detected.roi.width
    }
    const calibration: MinimapCalibration = {
      schemaVersion: 1,
      id: `calib_auto_${Date.now()}_${randomUUID()}`,
      fingerprintHash: this._fingerprintHash(fingerprint, side),
      roi,
      transform: 'blue-normal',
      source: 'automatic',
      confidence: detected.confidence,
      createdAt: Date.now()
    }
    this._context.state.setCurrentCalibration(calibration)
    void this._context.liveCoach.setManualCalibration(calibration).catch((error) => {
      this._context.logger.warn(
        formatSanitizedErrorLog('Failed to persist automatic minimap calibration', error)
      )
    })
    return calibration
  }

  public async applyManualCalibration(
    roi: { x: number; y: number; width: number; height: number },
    side: 'left' | 'right'
  ): Promise<MinimapCalibration> {
    // 严格边界范围校验：确保 ROI 坐标完全在 0~1 的屏幕范围内且长宽大于 0
    if (
      typeof roi.x !== 'number' ||
      typeof roi.y !== 'number' ||
      typeof roi.width !== 'number' ||
      typeof roi.height !== 'number' ||
      roi.x < 0 ||
      roi.y < 0 ||
      roi.width <= 0 ||
      roi.height <= 0 ||
      roi.x + roi.width > 1.0001 ||
      roi.y + roi.height > 1.0001
    ) {
      throw new Error(
        `非法 ROI 区域: [x=${roi.x}, y=${roi.y}, w=${roi.width}, h=${roi.height}] 超出屏幕归一化范围 (0~1)`
      )
    }

    const fingerprint = this.getEnvironmentFingerprint()
    const calibration: MinimapCalibration = {
      schemaVersion: 1,
      id: `calib_manual_${Date.now()}_${randomUUID()}`,
      fingerprintHash: this._fingerprintHash(fingerprint, side),
      roi,
      transform: 'blue-normal',
      source: 'manual',
      confidence: 1.0,
      createdAt: Date.now()
    }

    this._context.state.setCurrentCalibration(calibration)
    await this._context.liveCoach.setManualCalibration(calibration)
    return calibration
  }

  public async resetCalibration(): Promise<MinimapCalibration> {
    await this._context.liveCoach.setManualCalibration(null)
    this._context.state.setCurrentCalibration(null)
    return this.getOrCreateCalibration()
  }

  private _fingerprintHash(
    fingerprint: CaptureEnvironmentFingerprint,
    side: 'left' | 'right'
  ): string {
    return [
      'fp3',
      fingerprint.displayId ?? 'unknown-display',
      fingerprint.width !== null && fingerprint.height !== null
        ? `${fingerprint.width}x${fingerprint.height}`
        : 'unknown-size',
      fingerprint.dpiScale?.toFixed(3) ?? 'unknown-dpi',
      fingerprint.hdr === null ? 'unknown-hdr' : fingerprint.hdr ? 'hdr' : 'sdr',
      fingerprint.windowMode,
      fingerprint.backend,
      side
    ]
      .map((value) => encodeURIComponent(value))
      .join('_')
  }

  private _normalizeTargetEnvironment(
    environment: CaptureTargetEnvironment | null
  ): CaptureTargetEnvironment | null {
    if (!environment) return null
    const { clientBounds } = environment
    if (
      !environment.displayId ||
      !Number.isFinite(clientBounds.x) ||
      !Number.isFinite(clientBounds.y) ||
      !Number.isInteger(clientBounds.width) ||
      clientBounds.width <= 0 ||
      !Number.isInteger(clientBounds.height) ||
      clientBounds.height <= 0 ||
      (environment.dpiScale !== null &&
        (!Number.isFinite(environment.dpiScale) || environment.dpiScale <= 0))
    ) {
      return null
    }
    return {
      displayId: environment.displayId,
      clientBounds: { ...clientBounds },
      dpiScale: environment.dpiScale,
      hdr: environment.hdr,
      windowMode: environment.windowMode
    }
  }
}
