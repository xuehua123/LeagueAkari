export interface DetectedMinimapRoi {
  side: 'left' | 'right'
  roi: { x: number; y: number; width: number; height: number }
  confidence: number
}

function regionComplexity(
  pixels: Uint8Array,
  frameWidth: number,
  startX: number,
  startY: number,
  width: number,
  height: number
): number {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 96))
  let count = 0
  let sum = 0
  let squareSum = 0
  let chromaSum = 0
  let gradientSum = 0

  for (let y = startY; y < startY + height - step; y += step) {
    for (let x = startX; x < startX + width - step; x += step) {
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

function cornerComplexity(
  pixels: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  side: 'left' | 'right',
  edge: number
): number {
  return regionComplexity(
    pixels,
    frameWidth,
    side === 'left' ? 0 : frameWidth - edge,
    frameHeight - edge,
    edge,
    edge
  )
}

function meanColor(
  pixels: Uint8Array,
  frameWidth: number,
  startX: number,
  startY: number,
  width: number,
  height: number
): [number, number, number] {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 128))
  let blue = 0
  let green = 0
  let red = 0
  let count = 0
  for (let y = startY; y < startY + height; y += step) {
    for (let x = startX; x < startX + width; x += step) {
      const index = (y * frameWidth + x) * 4
      blue += pixels[index]
      green += pixels[index + 1]
      red += pixels[index + 2]
      count++
    }
  }
  return count > 0 ? [blue / count, green / count, red / count] : [0, 0, 0]
}

function colorDistance(left: [number, number, number], right: [number, number, number]): number {
  return (
    (Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2])) / 3
  )
}

/**
 * Measures the two interior borders that define a corner-anchored square. Averaging thin bands on
 * both sides suppresses ordinary gameplay texture; a random textured corner alone is not enough.
 */
function squareBoundaryEvidence(
  pixels: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  side: 'left' | 'right',
  edge: number
): number {
  const startX = side === 'left' ? 0 : frameWidth - edge
  const startY = frameHeight - edge
  const band = Math.max(2, Math.round(edge * 0.025))
  const inset = Math.max(band + 1, Math.round(edge * 0.08))
  if (startY < band || edge <= inset * 2) return 0

  const lineLength = edge - inset * 2
  const topInside = meanColor(pixels, frameWidth, startX + inset, startY, lineLength, band)
  const topOutside = meanColor(pixels, frameWidth, startX + inset, startY - band, lineLength, band)

  const insideX = side === 'left' ? startX + edge - band : startX
  const outsideX = side === 'left' ? startX + edge : startX - band
  if (outsideX < 0 || outsideX + band > frameWidth) return 0
  const innerInside = meanColor(pixels, frameWidth, insideX, startY + inset, band, lineLength)
  const innerOutside = meanColor(pixels, frameWidth, outsideX, startY + inset, band, lineLength)

  return Math.min(colorDistance(topInside, topOutside), colorDistance(innerInside, innerOutside))
}

function distributedCornerComplexity(
  pixels: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  side: 'left' | 'right',
  edge: number
): number {
  const startX = side === 'left' ? 0 : frameWidth - edge
  const startY = frameHeight - edge
  const inset = Math.max(2, Math.round(edge * 0.04))
  const innerEdge = edge - inset * 2
  const half = Math.floor(innerEdge / 2)
  if (half < 8) return 0
  const scores = [
    regionComplexity(pixels, frameWidth, startX + inset, startY + inset, half, half),
    regionComplexity(
      pixels,
      frameWidth,
      startX + inset + innerEdge - half,
      startY + inset,
      half,
      half
    ),
    regionComplexity(
      pixels,
      frameWidth,
      startX + inset,
      startY + inset + innerEdge - half,
      half,
      half
    ),
    regionComplexity(
      pixels,
      frameWidth,
      startX + inset + innerEdge - half,
      startY + inset + innerEdge - half,
      half,
      half
    )
  ].sort((left, right) => left - right)

  // Use the second-lowest quadrant: one quiet/fogged quadrant is acceptable, but a small textured
  // badge or banner cannot masquerade as a full minimap.
  return scores[1]
}

interface CornerCandidate {
  side: 'left' | 'right'
  edge: number
  boundary: number
  complexity: number
  distributedComplexity: number
  score: number
}

const MIN_MINIMAP_EDGE_RATIO = 0.14
const MAX_MINIMAP_EDGE_RATIO = 0.4

function findCornerCandidate(
  pixels: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  side: 'left' | 'right'
): CornerCandidate | null {
  const minEdge = Math.max(40, Math.round(frameHeight * MIN_MINIMAP_EDGE_RATIO))
  const maxEdge = Math.min(
    frameHeight - 4,
    Math.round(frameHeight * MAX_MINIMAP_EDGE_RATIO),
    Math.round(frameWidth * 0.45)
  )
  let strongestBoundary = 0
  const boundaryCandidates: Array<{ edge: number; boundary: number }> = []

  for (let edge = minEdge; edge <= maxEdge; edge++) {
    const boundary = squareBoundaryEvidence(pixels, frameWidth, frameHeight, side, edge)
    strongestBoundary = Math.max(strongestBoundary, boundary)
    boundaryCandidates.push({ edge, boundary })
  }
  if (strongestBoundary < 12) return null

  // Prefer the largest edge within the narrow peak. Slight over-coverage is safer than cutting off
  // champion icons on the top/inner boundary after Electron thumbnail rounding.
  const nearPeak = boundaryCandidates.filter(
    (candidate) => candidate.boundary >= strongestBoundary * 0.94
  )
  const selectedBoundary = nearPeak.at(-1)
  if (!selectedBoundary) return null

  const complexity = cornerComplexity(pixels, frameWidth, frameHeight, side, selectedBoundary.edge)
  const distributedComplexity = distributedCornerComplexity(
    pixels,
    frameWidth,
    frameHeight,
    side,
    selectedBoundary.edge
  )
  if (complexity < 12 || distributedComplexity < 8) return null

  return {
    side,
    edge: selectedBoundary.edge,
    boundary: selectedBoundary.boundary,
    complexity,
    distributedComplexity,
    score:
      selectedBoundary.boundary * 0.6 +
      Math.min(120, complexity) * 0.25 +
      Math.min(120, distributedComplexity) * 0.15
  }
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

  const left = findCornerCandidate(pixels, frameWidth, frameHeight, 'left')
  const right = findCornerCandidate(pixels, frameWidth, frameHeight, 'right')
  if (!left && !right) return null
  const best = !right || (left && left.score >= right.score) ? left : right
  const oppositeScore = best?.side === 'left' ? (right?.score ?? 0) : (left?.score ?? 0)
  if (!best) return null

  const width = best.edge / frameWidth
  const height = best.edge / frameHeight
  const scoreRatio = best.score / Math.max(1, oppositeScore)
  // 普通游戏画面两侧都可能有高纹理 UI；若目标角没有显著胜过另一角，必须
  // 返回 unknown 交给手动标定，不能仅凭“有纹理”猜测小地图侧。
  if (scoreRatio < 1.2 || best.score - oppositeScore < 8) return null
  const confidence = Math.min(
    0.98,
    0.65 + Math.min(0.18, (scoreRatio - 1.2) * 0.16) + Math.min(0.15, (best.boundary - 12) / 160)
  )

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
