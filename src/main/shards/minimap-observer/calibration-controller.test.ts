import { describe, expect, it, vi } from 'vitest'

import { MinimapCalibrationController } from './calibration-controller'

describe('MinimapCalibrationController Boundary & Invalidation Test', () => {
  function createMockContext() {
    let currentCalib: any = null
    let side = 'right'

    return {
      liveCoach: {
        settings: {
          manualCalibration: null,
          get minimapSide() {
            return side
          },
          set minimapSide(val: string) {
            side = val
          }
        },
        setManualCalibration: vi.fn().mockResolvedValue(undefined)
      },
      state: {
        backend: 'unavailable',
        get currentCalibration() {
          return currentCalib
        },
        setCurrentCalibration: vi.fn((c) => {
          currentCalib = c
        })
      },
      logger: { warn: vi.fn() }
    } as any
  }

  it('rejects out of bounds manual ROI coordinates', async () => {
    const ctx = createMockContext()
    const controller = new MinimapCalibrationController(ctx)

    // x + width > 1
    await expect(
      controller.applyManualCalibration({ x: 0.9, y: 0.5, width: 0.2, height: 0.2 }, 'right')
    ).rejects.toThrow('非法 ROI 区域')

    // y < 0
    await expect(
      controller.applyManualCalibration({ x: 0.1, y: -0.1, width: 0.2, height: 0.2 }, 'left')
    ).rejects.toThrow('非法 ROI 区域')

    // width <= 0
    await expect(
      controller.applyManualCalibration({ x: 0.1, y: 0.1, width: 0, height: 0.2 }, 'left')
    ).rejects.toThrow('非法 ROI 区域')
  })

  it('accepts valid manual ROI coordinates within 0~1 range', async () => {
    const ctx = createMockContext()
    const controller = new MinimapCalibrationController(ctx)

    const validRoi = { x: 0.8, y: 0.7, width: 0.2, height: 0.3 }
    const calib = await controller.applyManualCalibration(validRoi, 'right')

    expect(calib.roi).toEqual(validRoi)
    expect(calib.source).toBe('manual')
    expect(ctx.state.setCurrentCalibration).toHaveBeenCalledWith(calib)
    expect(ctx.liveCoach.setManualCalibration).toHaveBeenCalledWith(calib)
  })

  it('persists a successful automatic image-based calibration', async () => {
    const ctx = createMockContext()
    const controller = new MinimapCalibrationController(ctx)
    const width = 640
    const height = 360
    const pixels = new Uint8Array(width * height * 4)

    for (let y = 250; y < height; y++) {
      for (let x = 530; x < width; x++) {
        const index = (y * width + x) * 4
        const value = (x + y) % 8 < 4 ? 230 : 25
        pixels[index] = value
        pixels[index + 1] = 255 - value
        pixels[index + 2] = (x * 3 + y * 5) % 255
        pixels[index + 3] = 255
      }
    }

    const calibration = controller.applyAutomaticDetection(pixels, width, height)
    await Promise.resolve()

    expect(calibration.id).toMatch(/^calib_auto_v2_/)
    expect(calibration.confidence).toBeGreaterThanOrEqual(0.65)
    expect(ctx.liveCoach.setManualCalibration).toHaveBeenCalledWith(calibration)
  })

  it('invalidates calibration and re-calculates when minimap side or resolution changes', () => {
    const ctx = createMockContext()
    const controller = new MinimapCalibrationController(ctx)

    // 1. 右侧初始标定
    const calibRight = controller.getOrCreateCalibration()
    expect(calibRight.roi.x).toBeGreaterThan(0.5)
    expect(calibRight.confidence).toBe(0)

    // 2. 切换至左侧
    ctx.liveCoach.settings.minimapSide = 'left'
    const calibLeft = controller.getOrCreateCalibration()
    expect(calibLeft.roi.x).toBe(0.0)
    expect(calibLeft.confidence).toBe(0)
  })

  it.each([
    ['600p 4:3 minimum window', 800, 600, 1.25],
    ['768p 4:3', 1024, 768, 1],
    ['1024p 5:4', 1280, 1024, 1.25],
    ['768p 1366 window', 1366, 768, 1.25],
    ['720p 16:9', 1280, 720, 1],
    ['1080p 16:9', 1920, 1080, 1.25],
    ['1440p 16:9', 2560, 1440, 1.5],
    ['2160p 16:9', 3840, 2160, 2],
    ['1200p 16:10', 1920, 1200, 1.25],
    ['1440p 21:9', 3440, 1440, 1.5],
    ['1440p 32:9', 5120, 1440, 2],
    ['portrait capture', 320, 2160, 2]
  ])(
    'keeps the fallback minimap ROI square for %s windowed capture',
    (_, width, height, dpiScale) => {
      const ctx = createMockContext()
      const controller = new MinimapCalibrationController(ctx)
      controller.setTargetEnvironment({
        displayId: '\\\\.\\DISPLAY2',
        clientBounds: { x: 2008, y: 120, width, height },
        dpiScale,
        hdr: false,
        windowMode: 'windowed'
      })

      const calibration = controller.getOrCreateCalibration()
      const pixelWidth = calibration.roi.width * width
      const pixelHeight = calibration.roi.height * height

      expect(pixelWidth).toBeCloseTo(pixelHeight, 8)
      expect(calibration.roi.x + calibration.roi.width).toBeCloseTo(1, 10)
      expect(calibration.roi.y + calibration.roi.height).toBeCloseTo(1, 10)
      expect(controller.getEnvironmentFingerprint().dpiScale).toBe(dpiScale)
    }
  )

  it('keeps normalized fallback coordinates stable across Windows DPI scaling', () => {
    const createCalibrationAtDpi = (dpiScale: number) => {
      const controller = new MinimapCalibrationController(createMockContext())
      controller.setTargetEnvironment({
        displayId: '\\\\.\\DISPLAY1',
        clientBounds: { x: 80, y: 60, width: 1920, height: 1080 },
        dpiScale,
        hdr: false,
        windowMode: 'windowed'
      })
      return controller.getOrCreateCalibration().roi
    }

    expect(createCalibrationAtDpi(1)).toEqual(createCalibrationAtDpi(2))
  })

  it('uses the actual desktop thumbnail aspect for a safe fallback when image detection is inconclusive', () => {
    const ctx = createMockContext()
    const controller = new MinimapCalibrationController(ctx)
    controller.setTargetEnvironment({
      displayId: '\\\\.\\DISPLAY1',
      clientBounds: { x: 0, y: 0, width: 5120, height: 1440 },
      dpiScale: 2,
      hdr: false,
      windowMode: 'windowed'
    })

    const calibration = controller.applyAutomaticDetection(
      new Uint8Array(1280 * 360 * 4),
      1280,
      360
    )

    expect(calibration.confidence).toBe(0)
    expect(calibration.roi.width * 5120).toBeCloseTo(calibration.roi.height * 1440, 8)
    expect(calibration.roi.x + calibration.roi.width).toBeCloseTo(1, 10)
    expect(ctx.liveCoach.setManualCalibration).not.toHaveBeenCalled()
  })

  it('replaces every pre-boundary-fitting automatic candidate without discarding a user calibration', () => {
    const ctx = createMockContext()
    const controller = new MinimapCalibrationController(ctx)
    controller.setTargetEnvironment({
      displayId: '\\\\.\\DISPLAY1',
      clientBounds: { x: 0, y: 0, width: 5120, height: 1440 },
      dpiScale: 1,
      hdr: false,
      windowMode: 'borderless'
    })
    const fingerprintHash = controller.getOrCreateCalibration().fingerprintHash
    const legacyAutomatic = {
      schemaVersion: 1,
      id: 'legacy-fixed-normalized-roi',
      fingerprintHash,
      roi: { x: 0.82, y: 0.72, width: 0.18, height: 0.28 },
      transform: 'blue-normal',
      source: 'automatic',
      confidence: 0,
      createdAt: 1
    }
    ctx.liveCoach.settings.manualCalibration = legacyAutomatic
    ctx.state.setCurrentCalibration(null)

    const migrated = controller.getOrCreateCalibration()

    expect(migrated.id).not.toBe(legacyAutomatic.id)
    expect(migrated.id).toMatch(/^calib_auto_v2_/)
    expect(migrated.roi.width * 5120).toBeCloseTo(migrated.roi.height * 1440, 8)

    const legacySquareAutomatic = {
      ...legacyAutomatic,
      id: 'calib_auto_legacy-high-confidence',
      roi: { x: 0.95, y: 1 - 256 / 1440, width: 0.05, height: 256 / 1440 },
      confidence: 0.9
    }
    ctx.liveCoach.settings.manualCalibration = legacySquareAutomatic
    ctx.state.setCurrentCalibration(null)

    expect(controller.getOrCreateCalibration().id).not.toBe(legacySquareAutomatic.id)

    const userCalibration = { ...legacySquareAutomatic, id: 'user-calibration', source: 'manual' }
    ctx.liveCoach.settings.manualCalibration = userCalibration
    ctx.state.setCurrentCalibration(null)

    expect(controller.getOrCreateCalibration()).toBe(userCalibration)
  })

  it('invalidates calibration when the effective capture backend changes', () => {
    const ctx = createMockContext()
    const controller = new MinimapCalibrationController(ctx)

    const initial = controller.getOrCreateCalibration()
    ctx.state.backend = 'desktopCapturer'
    const updated = controller.getOrCreateCalibration()

    expect(updated.id).not.toBe(initial.id)
    expect(updated.fingerprintHash).toContain('desktopCapturer')
  })

  it('never falls back to the primary display when no game target was inspected', () => {
    const controller = new MinimapCalibrationController(createMockContext())

    expect(controller.getEnvironmentFingerprint()).toMatchObject({
      displayId: null,
      width: null,
      height: null,
      dpiScale: null,
      hdr: null,
      windowMode: 'unknown'
    })
  })

  it('immediately invalidates the active calibration when the target moves displays', () => {
    const ctx = createMockContext()
    const controller = new MinimapCalibrationController(ctx)
    const firstEnvironment = {
      displayId: '\\\\.\\DISPLAY1',
      clientBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      dpiScale: 1,
      hdr: false,
      windowMode: 'windowed' as const
    }
    const secondEnvironment = {
      displayId: '\\\\.\\DISPLAY2',
      clientBounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      dpiScale: 1.5,
      hdr: null,
      windowMode: 'unknown' as const
    }

    expect(controller.setTargetEnvironment(firstEnvironment)).toBe(true)
    const firstCalibration = controller.getOrCreateCalibration()
    expect(controller.setTargetEnvironment(firstEnvironment)).toBe(false)
    expect(controller.getOrCreateCalibration()).toBe(firstCalibration)

    expect(controller.setTargetEnvironment(secondEnvironment)).toBe(true)
    expect(ctx.state.setCurrentCalibration).toHaveBeenLastCalledWith(null)
    expect(controller.getEnvironmentFingerprint()).toMatchObject({
      displayId: '\\\\.\\DISPLAY2',
      width: 2560,
      height: 1440,
      dpiScale: 1.5,
      hdr: null,
      windowMode: 'unknown'
    })
    const secondCalibration = controller.getOrCreateCalibration()
    expect(secondCalibration.id).not.toBe(firstCalibration.id)
    expect(secondCalibration.fingerprintHash).toContain('DISPLAY2')
    expect(secondCalibration.fingerprintHash).toContain('unknown-hdr')
  })

  it('keeps calibration while a window moves within the same display', () => {
    const ctx = createMockContext()
    const controller = new MinimapCalibrationController(ctx)
    const environment = {
      displayId: '\\\\.\\DISPLAY1',
      clientBounds: { x: 40, y: 60, width: 1280, height: 720 },
      dpiScale: 1.25,
      hdr: false,
      windowMode: 'windowed' as const
    }
    controller.setTargetEnvironment(environment)
    const calibration = controller.getOrCreateCalibration()
    ctx.state.setCurrentCalibration.mockClear()

    expect(
      controller.setTargetEnvironment({
        ...environment,
        clientBounds: { ...environment.clientBounds, x: 420, y: 180 }
      })
    ).toBe(false)
    expect(ctx.state.setCurrentCalibration).not.toHaveBeenCalled()
    expect(controller.getOrCreateCalibration()).toBe(calibration)
  })
})
