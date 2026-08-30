import { describe, expect, it } from 'vitest'

import { detectMinimapRoi } from './calibration-detection'

describe('detectMinimapRoi', () => {
  function createTexturedCorner(
    width: number,
    height: number,
    side: 'left' | 'right',
    edge: number
  ) {
    const pixels = new Uint8Array(width * height * 4)
    const startX = side === 'left' ? 0 : width - edge
    for (let y = height - edge; y < height; y++) {
      for (let x = startX; x < startX + edge; x++) {
        const index = (y * width + x) * 4
        const bright = (x + y) % 8 < 4 ? 230 : 25
        pixels[index] = bright
        pixels[index + 1] = 255 - bright
        pixels[index + 2] = (x * 3 + y * 5) % 255
        pixels[index + 3] = 255
      }
    }
    return pixels
  }

  it('finds a high-complexity minimap in the bottom-right corner', () => {
    const width = 640
    const height = 360
    const pixels = new Uint8Array(width * height * 4)
    const edge = 110

    for (let y = height - edge; y < height; y++) {
      for (let x = width - edge; x < width; x++) {
        const index = (y * width + x) * 4
        const bright = (x + y) % 8 < 4 ? 230 : 25
        pixels[index] = bright
        pixels[index + 1] = 255 - bright
        pixels[index + 2] = (x * 3 + y * 5) % 255
        pixels[index + 3] = 255
      }
    }

    const result = detectMinimapRoi(pixels, width, height)
    expect(result?.side).toBe('right')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.65)
    expect(result?.roi.x).toBeGreaterThan(0.7)
    expect((result?.roi.x ?? 0) + (result?.roi.width ?? 0)).toBeCloseTo(1)
    expect((result?.roi.height ?? 0) * height).toBeGreaterThanOrEqual(edge * 0.96)
    expect((result?.roi.height ?? 0) * height).toBeLessThanOrEqual(edge * 1.05)
  })

  it('returns null for blank or invalid frames', () => {
    expect(detectMinimapRoi(new Uint8Array(640 * 360 * 4), 640, 360)).toBeNull()
    expect(detectMinimapRoi(new Uint8Array(10), 10, 10)).toBeNull()
  })

  it('returns unknown when both bottom corners are equally textured', () => {
    const width = 640
    const height = 360
    const pixels = new Uint8Array(width * height * 4)
    const edge = 110
    for (let y = height - edge; y < height; y++) {
      for (const startX of [0, width - edge]) {
        for (let x = startX; x < startX + edge; x++) {
          const index = (y * width + x) * 4
          const localX = x - startX
          const bright = (localX + y) % 8 < 4 ? 230 : 25
          pixels[index] = bright
          pixels[index + 1] = 255 - bright
          pixels[index + 2] = (localX * 3 + y * 5) % 255
          pixels[index + 3] = 255
        }
      }
    }

    expect(detectMinimapRoi(pixels, width, height)).toBeNull()
  })

  it('does not treat an arbitrary non-square textured corner banner as a minimap', () => {
    const width = 640
    const height = 360
    const pixels = new Uint8Array(width * height * 4)
    for (let y = height - 72; y < height; y++) {
      for (let x = width - 220; x < width; x++) {
        const index = (y * width + x) * 4
        const value = (x * 11 + y * 7) % 255
        pixels[index] = value
        pixels[index + 1] = 255 - value
        pixels[index + 2] = (value * 3) % 255
        pixels[index + 3] = 255
      }
    }

    expect(detectMinimapRoi(pixels, width, height)).toBeNull()
  })

  it.each([
    ['15%', 0.15],
    ['38%', 0.38]
  ])('fits the square boundary at a %s HUD minimap scale', (_, ratio) => {
    const width = 1280
    const height = 720
    const edge = Math.round(height * ratio)
    const pixels = createTexturedCorner(width, height, 'left', edge)

    const result = detectMinimapRoi(pixels, width, height)

    expect(result?.side).toBe('left')
    expect((result?.roi.height ?? 0) * height).toBeGreaterThanOrEqual(edge * 0.96)
    expect((result?.roi.height ?? 0) * height).toBeLessThanOrEqual(edge * 1.05)
  })

  it.each([
    ['600p 4:3 minimum window', 800, 600, 800, 600],
    ['768p 4:3', 1024, 768, 960, 720],
    ['1024p 5:4', 1280, 1024, 900, 720],
    ['768p 1366 window', 1366, 768, 1280, 720],
    ['720p 16:9', 1280, 720, 1280, 720],
    ['1080p 16:9', 1920, 1080, 1280, 720],
    ['1440p 16:9', 2560, 1440, 1280, 720],
    ['2160p 16:9', 3840, 2160, 1280, 720],
    ['1200p 16:10', 1920, 1200, 1152, 720],
    ['1440p 21:9', 3440, 1440, 1280, 536],
    ['1440p 32:9', 5120, 1440, 1280, 360]
  ])(
    'preserves square source coordinates after desktopCapturer scaling for %s',
    (_, sourceWidth, sourceHeight, thumbnailWidth, thumbnailHeight) => {
      const edge = Math.round(thumbnailHeight * 0.26)
      const pixels = createTexturedCorner(thumbnailWidth, thumbnailHeight, 'right', edge)
      const result = detectMinimapRoi(pixels, thumbnailWidth, thumbnailHeight)

      expect(result?.side).toBe('right')
      expect(result).not.toBeNull()
      const detectedThumbnailEdge = (result?.roi.height ?? 0) * thumbnailHeight
      expect(detectedThumbnailEdge).toBeGreaterThanOrEqual(edge * 0.96)
      expect(detectedThumbnailEdge).toBeLessThanOrEqual(edge * 1.05)
      const projectedWidth = (result?.roi.width ?? 0) * sourceWidth
      const projectedHeight = (result?.roi.height ?? 0) * sourceHeight
      expect(Math.abs(projectedWidth - projectedHeight)).toBeLessThanOrEqual(4)
      expect((result?.roi.x ?? 0) + (result?.roi.width ?? 0)).toBeCloseTo(1, 10)
      expect((result?.roi.y ?? 0) + (result?.roi.height ?? 0)).toBeCloseTo(1, 10)
    }
  )
})
