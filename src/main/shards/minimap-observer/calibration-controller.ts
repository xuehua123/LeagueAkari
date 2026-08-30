import { CaptureEnvironmentFingerprint, MinimapCalibration } from '@shared/types/live-coach'
import { randomUUID } from 'node:crypto'

import { detectMinimapRoi } from './calibration-detection'
import type { MinimapObserverMainContext } from './context'
import { formatSanitizedErrorLog } from './public-error'

const DEFAULT_MINIMAP_HEIGHT_RATIO = 0.28
const DEFAULT_CAPTURE_ASPECT_RATIO = 16 / 9
const MAX_AUTOMATIC_ROI_PIXEL_ASPECT_ERROR = 0.1
const CURRENT_AUTOMATIC_CALIBRATION_ID_PREFIX = 'calib_auto_v2_'

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
    const calibrationEnvironmentChanged = !this._hasSameCalibrationEnvironment(
      normalized,
      this._targetEnvironment
    )

    this._targetEnvironment = normalized
    if (!calibrationEnvironmentChanged) return false
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
    const hasTargetBinding =
      fingerprint.displayId !== null &&
      fingerprint.width !== null &&
      fingerprint.height !== null &&
      fingerprint.dpiScale !== null
    const matchesFingerprint = (
      calibration: MinimapCalibration | null
    ): calibration is MinimapCalibration =>
      calibration !== null &&
      expectedHashes.includes(calibration.fingerprintHash) &&
      this._isReusableCalibration(calibration, fingerprint)

    const current = this._context.state.currentCalibration
    if (matchesFingerprint(current)) {
      return current
    }

    const persisted = this._context.liveCoach.settings.manualCalibration
    if (hasTargetBinding && matchesFingerprint(persisted)) {
      this._context.state.setCurrentCalibration(persisted)
      return persisted
    }

    const calibration = this._createFallbackCalibration(
      fingerprint,
      fingerprint.minimapSide,
      fingerprint.width,
      fingerprint.height
    )

    this._context.state.setCurrentCalibration(calibration)
    return calibration
  }

  public applyAutomaticDetection(
    pixels: Uint8Array,
    width: number,
    height: number
  ): MinimapCalibration {
    const detected = detectMinimapRoi(pixels, width, height)
    if (!detected) {
      const fingerprint = this.getEnvironmentFingerprint()
      const side = this._context.liveCoach.settings.minimapSide === 'left' ? 'left' : 'right'
      const calibration = this._createFallbackCalibration(fingerprint, side, width, height)
      this._context.state.setCurrentCalibration(calibration)
      return calibration
    }

    const fingerprint = this.getEnvironmentFingerprint()
    const configuredSide = this._context.liveCoach.settings.minimapSide
    const side = configuredSide === 'auto' ? detected.side : configuredSide
    const roi = {
      ...detected.roi,
      x: side === 'left' ? 0 : 1 - detected.roi.width
    }
    const calibration: MinimapCalibration = {
      schemaVersion: 1,
      id: `${CURRENT_AUTOMATIC_CALIBRATION_ID_PREFIX}${Date.now()}_${randomUUID()}`,
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

  private _createFallbackCalibration(
    fingerprint: CaptureEnvironmentFingerprint,
    side: 'left' | 'right',
    captureWidth: number | null,
    captureHeight: number | null
  ): MinimapCalibration {
    // 经典召唤师峡谷小地图归一化坐标仅用于生成可编辑的候选框。
    // 未检查真实游戏画面前绝不能把屏幕长宽比当成“标定成功”的证据。
    // 候选框在像素空间必须保持正方形；固定的归一化宽度会在 21:9/32:9 上
    // 把小地图横向扩展数倍。DPI 只改变像素密度，不应改变这个归一化形状。
    const resolvedCaptureSize =
      captureWidth !== null &&
      captureHeight !== null &&
      Number.isFinite(captureWidth) &&
      Number.isFinite(captureHeight) &&
      captureWidth > 0 &&
      captureHeight > 0
        ? { width: captureWidth, height: captureHeight }
        : { width: DEFAULT_CAPTURE_ASPECT_RATIO, height: 1 }
    const defaultEdge = Math.min(
      resolvedCaptureSize.width,
      resolvedCaptureSize.height * DEFAULT_MINIMAP_HEIGHT_RATIO
    )
    const defaultWidth = defaultEdge / resolvedCaptureSize.width
    const defaultHeight = defaultEdge / resolvedCaptureSize.height

    return {
      schemaVersion: 1,
      id: `${CURRENT_AUTOMATIC_CALIBRATION_ID_PREFIX}${Date.now()}_${randomUUID()}`,
      fingerprintHash: this._fingerprintHash(fingerprint, side),
      roi: {
        x: side === 'left' ? 0 : 1 - defaultWidth,
        y: 1 - defaultHeight,
        width: defaultWidth,
        height: defaultHeight
      },
      transform: 'blue-normal',
      source: 'automatic',
      confidence: 0,
      createdAt: Date.now()
    }
  }

  private _isReusableCalibration(
    calibration: MinimapCalibration,
    fingerprint: CaptureEnvironmentFingerprint
  ): boolean {
    // A user-confirmed rectangle is authoritative even when it intentionally includes padding.
    // Automatic detections created before the boundary-fitting algorithm are not trustworthy even
    // when their guessed rectangle happens to be square. Version automatic IDs independently so
    // old guesses are replaced without discarding user-confirmed manual rectangles.
    if (calibration.source === 'manual') return true
    if (!calibration.id.startsWith(CURRENT_AUTOMATIC_CALIBRATION_ID_PREFIX)) return false

    if (fingerprint.width === null || fingerprint.height === null) {
      // A successful one-shot detection may precede native target inspection. Keep that result;
      // confidence-zero templates can be checked against the historical 16:9 assumption.
      if (calibration.confidence >= 0.65) return true
    }

    const captureWidth = fingerprint.width ?? DEFAULT_CAPTURE_ASPECT_RATIO
    const captureHeight = fingerprint.height ?? 1
    const pixelWidth = calibration.roi.width * captureWidth
    const pixelHeight = calibration.roi.height * captureHeight
    const aspectError = Math.abs(pixelWidth - pixelHeight) / Math.max(pixelWidth, pixelHeight)
    return Number.isFinite(aspectError) && aspectError <= MAX_AUTOMATIC_ROI_PIXEL_ASPECT_ERROR
  }

  private _hasSameCalibrationEnvironment(
    left: CaptureTargetEnvironment | null,
    right: CaptureTargetEnvironment | null
  ): boolean {
    if (left === null || right === null) return left === right
    return (
      left.displayId === right.displayId &&
      left.clientBounds.width === right.clientBounds.width &&
      left.clientBounds.height === right.clientBounds.height &&
      left.dpiScale === right.dpiScale &&
      left.hdr === right.hdr &&
      left.windowMode === right.windowMode
    )
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
