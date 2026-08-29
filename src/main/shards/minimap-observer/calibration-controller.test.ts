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
})
