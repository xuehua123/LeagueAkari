import { describe, expect, it } from 'vitest'

import {
  type Roi,
  type RoiSourceSize,
  getRoiPreviewAspectRatio,
  moveRoi,
  resizeSquareRoi
} from './geometry'

const SOURCE_SIZES: RoiSourceSize[] = [
  { width: 1440, height: 1080 },
  { width: 1680, height: 1050 },
  { width: 2560, height: 1080 },
  { width: 3840, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 320, height: 2160 }
]

function createSquareRoi(source: RoiSourceSize, sideInSourcePixels = 240): Roi {
  return {
    x: 0.25,
    y: 0.25,
    width: sideInSourcePixels / source.width,
    height: sideInSourcePixels / source.height
  }
}

function expectPhysicalSquare(roi: Roi, source: RoiSourceSize) {
  expect(roi.width * source.width).toBeCloseTo(roi.height * source.height, 8)
}

function expectInsideSource(roi: Roi) {
  expect(roi.x).toBeGreaterThanOrEqual(0)
  expect(roi.y).toBeGreaterThanOrEqual(0)
  expect(roi.width).toBeGreaterThan(0)
  expect(roi.height).toBeGreaterThan(0)
  expect(roi.x + roi.width).toBeLessThanOrEqual(1)
  expect(roi.y + roi.height).toBeLessThanOrEqual(1)
}

describe('ROI preview geometry', () => {
  it.each(SOURCE_SIZES)('uses the actual $width×$height source aspect ratio', (source) => {
    expect(getRoiPreviewAspectRatio(source)).toBeCloseTo(source.width / source.height, 8)
  })

  it('falls back safely to 16:9 when the source size is unavailable or invalid', () => {
    expect(getRoiPreviewAspectRatio()).toBeCloseTo(16 / 9, 8)
    expect(getRoiPreviewAspectRatio(null)).toBeCloseTo(16 / 9, 8)
    expect(getRoiPreviewAspectRatio({ width: 0, height: 1080 })).toBeCloseTo(16 / 9, 8)
  })
})

describe('ROI source-pixel square resizing', () => {
  it.each(SOURCE_SIZES)(
    'keeps southeast resizing square and legal for $width×$height',
    (source) => {
      const next = resizeSquareRoi(createSquareRoi(source), 0.8, 0.7, 'resize-se', source)

      expectPhysicalSquare(next, source)
      expectInsideSource(next)
      expect(next.x + next.width === 1 || next.y + next.height === 1).toBe(true)
    }
  )

  it.each(SOURCE_SIZES)(
    'keeps northwest resizing square and legal for $width×$height',
    (source) => {
      const start = createSquareRoi(source)
      const anchorX = start.x + start.width
      const anchorY = start.y + start.height
      const next = resizeSquareRoi(start, -0.8, -0.7, 'resize-nw', source)

      expectPhysicalSquare(next, source)
      expectInsideSource(next)
      expect(next.x + next.width).toBeCloseTo(anchorX, 8)
      expect(next.y + next.height).toBeCloseTo(anchorY, 8)
    }
  )

  it('supports shrinking from a vertical drag and preserves the minimum square size', () => {
    const source = { width: 1920, height: 1080 }
    const start = createSquareRoi(source, 320)
    const next = resizeSquareRoi(start, 0, -1, 'resize-se', source)

    expectPhysicalSquare(next, source)
    expectInsideSource(next)
    expect(next.width * source.width).toBeCloseTo(54, 8)
  })

  it('projects an asymmetric drag and a legacy non-square ROI onto a source-pixel square', () => {
    const source = { width: 1600, height: 1200 }
    const next = resizeSquareRoi(
      { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
      0.04,
      -0.01,
      'resize-se',
      source
    )

    expectPhysicalSquare(next, source)
    expectInsideSource(next)
    expect(next.width * source.width).toBeCloseTo(246, 8)
  })

  it('does not resize for source-pixel pointer movement perpendicular to the square diagonal', () => {
    const source = { width: 2560, height: 1080 }
    const start = createSquareRoi(source)
    const next = resizeSquareRoi(start, 60 / source.width, -60 / source.height, 'resize-se', source)

    expectPhysicalSquare(next, source)
    expect(next.width * source.width).toBeCloseTo(240, 8)
  })

  it('uses 16:9 source geometry when resize dimensions are unavailable', () => {
    const next = resizeSquareRoi(
      { x: 0.1, y: 0.1, width: 0.2, height: (0.2 * 16) / 9 },
      0.1,
      0.05,
      'resize-se'
    )

    expect(next.width * 16).toBeCloseTo(next.height * 9, 8)
    expectInsideSource(next)
  })

  it('keeps a square ROI legal while moving it against source boundaries', () => {
    const source = { width: 2560, height: 1080 }
    const next = moveRoi(createSquareRoi(source), 2, -2)

    expectPhysicalSquare(next, source)
    expectInsideSource(next)
    expect(next.x).toBeCloseTo(1 - next.width, 8)
    expect(next.y).toBe(0)
  })
})
