import type { MinimapCalibration } from '@shared/types/live-coach'

export type Roi = MinimapCalibration['roi']

export interface RoiSourceSize {
  width: number
  height: number
}

export type RoiResizeHandle = 'resize-nw' | 'resize-se'

const FALLBACK_SOURCE_SIZE: RoiSourceSize = Object.freeze({ width: 16, height: 9 })
const MINIMUM_ROI_SOURCE_FRACTION = 0.05

export function resolveRoiSourceSize(sourceSize?: RoiSourceSize | null): RoiSourceSize {
  if (
    !sourceSize ||
    !Number.isFinite(sourceSize.width) ||
    !Number.isFinite(sourceSize.height) ||
    sourceSize.width <= 0 ||
    sourceSize.height <= 0
  ) {
    return FALLBACK_SOURCE_SIZE
  }

  return sourceSize
}

export function getRoiPreviewAspectRatio(sourceSize?: RoiSourceSize | null): number {
  const resolved = resolveRoiSourceSize(sourceSize)
  return resolved.width / resolved.height
}

export function moveRoi(start: Roi, dx: number, dy: number): Roi {
  return {
    ...start,
    x: Math.max(0, Math.min(1 - start.width, start.x + dx)),
    y: Math.max(0, Math.min(1 - start.height, start.y + dy))
  }
}

export function resizeSquareRoi(
  start: Roi,
  dx: number,
  dy: number,
  handle: RoiResizeHandle,
  sourceSize?: RoiSourceSize | null
): Roi {
  const source = resolveRoiSourceSize(sourceSize)
  const deltaXInSourcePixels = dx * source.width
  const deltaYInSourcePixels = dy * source.height
  const startingSideInSourcePixels = (start.width * source.width + start.height * source.height) / 2
  const sideDeltaInSourcePixels = (deltaXInSourcePixels + deltaYInSourcePixels) / 2
  const minimumSideInSourcePixels =
    Math.min(source.width, source.height) * MINIMUM_ROI_SOURCE_FRACTION

  if (handle === 'resize-se') {
    const anchorXInSourcePixels = start.x * source.width
    const anchorYInSourcePixels = start.y * source.height
    const maximumSideInSourcePixels = Math.min(
      source.width - anchorXInSourcePixels,
      source.height - anchorYInSourcePixels
    )
    const sideInSourcePixels = clampSquareSide(
      startingSideInSourcePixels + sideDeltaInSourcePixels,
      minimumSideInSourcePixels,
      maximumSideInSourcePixels
    )

    return {
      ...start,
      width: sideInSourcePixels / source.width,
      height: sideInSourcePixels / source.height
    }
  }

  const anchorXInSourcePixels = (start.x + start.width) * source.width
  const anchorYInSourcePixels = (start.y + start.height) * source.height
  const maximumSideInSourcePixels = Math.min(anchorXInSourcePixels, anchorYInSourcePixels)
  const sideInSourcePixels = clampSquareSide(
    startingSideInSourcePixels - sideDeltaInSourcePixels,
    minimumSideInSourcePixels,
    maximumSideInSourcePixels
  )

  return {
    ...start,
    x: (anchorXInSourcePixels - sideInSourcePixels) / source.width,
    y: (anchorYInSourcePixels - sideInSourcePixels) / source.height,
    width: sideInSourcePixels / source.width,
    height: sideInSourcePixels / source.height
  }
}

function clampSquareSide(side: number, minimumSide: number, maximumSide: number): number {
  const legalMinimumSide = Math.min(minimumSide, maximumSide)
  return Math.max(legalMinimumSide, Math.min(maximumSide, side))
}
