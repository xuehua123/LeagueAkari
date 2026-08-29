export interface DetectedMinimapRoi {
  side: 'left' | 'right'
  roi: { x: number; y: number; width: number; height: number }
  confidence: number
}

function cornerComplexity(
  pixels: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  side: 'left' | 'right',
  edge: number
): number {
  const startX = side === 'left' ? 0 : frameWidth - edge
  const startY = frameHeight - edge
  const step = Math.max(2, Math.floor(edge / 96))
  let count = 0
  let sum = 0
  let squareSum = 0
  let chromaSum = 0
  let gradientSum = 0

  for (let y = startY; y < frameHeight - step; y += step) {
    for (let x = startX; x < startX + edge - step; x += step) {
      const index = (y * frameWidth + x) * 4
      const rightIndex = (y * frameWidth + x + step) * 4
      const downIndex = ((y + step) * frameWidth + x) * 4
      const b = pixels[index]
      const g = pixels[index + 1]
      const r = pixels[index + 2]
      const luminance = (r * 77 + g * 150 + b * 29) / 256
      const rightLuminance =
        (pixels[rightIndex + 2] * 77 + pixels[rightIndex + 1] * 150 + pixels[rightIndex] * 29) / 256
      const downLuminance =
        (pixels[downIndex + 2] * 77 + pixels[downIndex + 1] * 150 + pixels[downIndex] * 29) / 256

      count++
      sum += luminance
      squareSum += luminance * luminance
      chromaSum += Math.max(r, g, b) - Math.min(r, g, b)
      gradientSum += Math.abs(luminance - rightLuminance) + Math.abs(luminance - downLuminance)
    }
  }

  if (count === 0) return 0
  const mean = sum / count
  const variance = Math.max(0, squareSum / count - mean * mean)
  return Math.sqrt(variance) + chromaSum / count + gradientSum / count
}

/** Detects the likely minimap corner and UI scale from a bounded one-shot game preview. */
export function detectMinimapRoi(
  pixels: Uint8Array,
  frameWidth: number,
  frameHeight: number
): DetectedMinimapRoi | null {
  if (frameWidth < 320 || frameHeight < 240 || pixels.byteLength < frameWidth * frameHeight * 4) {
    return null
  }

  let best: { side: 'left' | 'right'; edge: number; score: number } | null = null
  let oppositeScore = 0

  for (const ratio of [0.2, 0.23, 0.26, 0.29, 0.32]) {
    const edge = Math.max(80, Math.round(frameHeight * ratio))
    const leftScore = cornerComplexity(pixels, frameWidth, frameHeight, 'left', edge)
    const rightScore = cornerComplexity(pixels, frameWidth, frameHeight, 'right', edge)
    const candidate =
      leftScore >= rightScore
        ? { side: 'left' as const, edge, score: leftScore, opposite: rightScore }
        : { side: 'right' as const, edge, score: rightScore, opposite: leftScore }

    if (!best || candidate.score > best.score) {
      best = candidate
      oppositeScore = candidate.opposite
    }
  }

  if (!best || best.score < 8) return null

  const width = best.edge / frameWidth
  const height = best.edge / frameHeight
  const scoreRatio = best.score / Math.max(1, oppositeScore)
  // 普通游戏画面两侧都可能有高纹理 UI；若目标角没有显著胜过另一角，必须
  // 返回 unknown 交给手动标定，不能仅凭“有纹理”猜测小地图侧。
  if (scoreRatio < 1.15) return null
  const confidence = Math.max(0.65, Math.min(0.98, 0.6 + (scoreRatio - 1) * 0.35))

  return {
    side: best.side,
    roi: {
      x: best.side === 'left' ? 0 : 1 - width,
      y: 1 - height,
      width,
      height
    },
    confidence
  }
}
