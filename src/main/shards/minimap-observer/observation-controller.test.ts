import type { MinimapObservationBatch } from '@shared/types/live-coach'
import { describe, expect, it, vi } from 'vitest'

import { MinimapObservationController } from './observation-controller'

function createBatch(): MinimapObservationBatch {
  const now = Date.now()
  return {
    sessionId: 'session',
    patch: '16.16.1',
    calibrationVersion: '1',
    modelVersions: {},
    frame: { observedAt: now, receivedAt: now, sequence: 1, ageMs: 10 },
    health: 'healthy',
    entities: [],
    events: []
  }
}

describe('MinimapObservationController', () => {
  function createContext(confidence: number, source: 'automatic' | 'manual' = 'automatic') {
    return {
      state: {
        currentCalibration: { confidence, source },
        backend: 'desktopCapturer',
        fps: 10,
        setFrameAgeMs: vi.fn(),
        setRoiHealth: vi.fn()
      },
      liveCoach: {
        state: { capture: { dropCount: 7 }, setCaptureState: vi.fn() },
        feedMinimapObservationBatch: vi.fn()
      }
    } as any
  }

  it('fails closed when a template ROI has not been confirmed by image detection', () => {
    const context = createContext(0)
    const controller = new MinimapObservationController(context)

    controller.handleObservationBatch(createBatch())

    expect(context.state.setRoiHealth).toHaveBeenCalledWith('unknown')
    expect(context.liveCoach.feedMinimapObservationBatch).toHaveBeenCalledWith(
      expect.objectContaining({ health: 'unknown' })
    )
  })

  it('accepts a manually confirmed ROI even when automatic confidence is unavailable', () => {
    const context = createContext(0, 'manual')
    const controller = new MinimapObservationController(context)

    controller.handleObservationBatch(createBatch())

    expect(context.state.setRoiHealth).toHaveBeenCalledWith('healthy')
    expect(context.liveCoach.feedMinimapObservationBatch).toHaveBeenCalledWith(
      expect.objectContaining({ health: 'healthy' })
    )
  })

  it('keeps compatibility frames usable within the shared 750ms freshness budget', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_500)
    const context = createContext(1)
    const controller = new MinimapObservationController(context)
    const batch = createBatch()
    batch.frame = { observedAt: 1_000, receivedAt: 1_300, sequence: 1, ageMs: 300 }
    batch.entities = [
      {
        trackId: 'enemy-1',
        kind: 'enemy',
        team: 'enemy',
        championId: 103,
        point: { x: 0.5, y: 0.5 },
        regionId: 'mid_lane',
        confidence: 0.95,
        lifecycle: 'confirmed',
        firstObservedAt: 1_000,
        lastObservedAt: 1_000,
        expiresAt: 6_000
      }
    ]
    batch.events = [
      {
        eventId: 'event-1',
        kind: 'enemy-region-changed',
        timestamp: 1_000,
        payload: {}
      }
    ]

    controller.handleObservationBatch(batch)

    expect(context.state.setFrameAgeMs).toHaveBeenCalledWith(500)
    expect(context.state.setRoiHealth).toHaveBeenCalledWith('healthy')
    expect(context.liveCoach.state.setCaptureState).toHaveBeenCalledWith(
      expect.not.objectContaining({ dropCount: 8 })
    )
    expect(context.liveCoach.feedMinimapObservationBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        health: 'healthy',
        entities: batch.entities,
        events: batch.events,
        frame: expect.objectContaining({ receivedAt: 1_500, ageMs: 500 })
      })
    )
  })

  it('includes IPC delivery time and strips current facts once frame age exceeds 750ms', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_751)
    const context = createContext(1)
    const controller = new MinimapObservationController(context)
    const batch = createBatch()
    batch.frame = { observedAt: 1_000, receivedAt: 1_500, sequence: 1, ageMs: 500 }
    batch.entities = [
      {
        trackId: 'enemy-1',
        kind: 'enemy',
        team: 'enemy',
        championId: 103,
        point: { x: 0.5, y: 0.5 },
        regionId: 'mid_lane',
        confidence: 0.95,
        lifecycle: 'confirmed',
        firstObservedAt: 1_000,
        lastObservedAt: 1_000,
        expiresAt: 6_000
      }
    ]

    controller.handleObservationBatch(batch)

    expect(context.state.setFrameAgeMs).toHaveBeenCalledWith(751)
    expect(context.state.setRoiHealth).toHaveBeenCalledWith('unknown')
    expect(context.liveCoach.state.setCaptureState).toHaveBeenCalledWith(
      expect.objectContaining({ dropCount: 8 })
    )
    expect(context.liveCoach.feedMinimapObservationBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        health: 'unknown',
        entities: [],
        events: [],
        frame: expect.objectContaining({ receivedAt: 1_751, ageMs: 751 })
      })
    )
  })

  it('does not double-count a frame that the worker already marked stale', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_751)
    const context = createContext(1)
    const controller = new MinimapObservationController(context)
    const batch = createBatch()
    batch.frame = { observedAt: 1_000, receivedAt: 1_751, sequence: 1, ageMs: 751 }
    batch.health = 'unknown'

    controller.handleObservationBatch(batch)

    const captureUpdate = context.liveCoach.state.setCaptureState.mock.calls[0][0]
    expect(captureUpdate).not.toHaveProperty('dropCount')
  })
})
