import { describe, expect, it } from 'vitest'

import { detectMinimapRoi } from './calibration-detection'

describe('detectMinimapRoi', () => {
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
})
