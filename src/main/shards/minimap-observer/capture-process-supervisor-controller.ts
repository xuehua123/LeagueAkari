import {
  MinimapObservationBatch,
  WorkerToMainMessage,
  workerToMainMessageSchema
} from '@shared/types/live-coach'
import { type UtilityProcess, utilityProcess } from 'electron'
import path from 'node:path'

import { MinimapCalibrationController } from './calibration-controller'
import type { MinimapObserverMainContext } from './context'
import { MinimapObservationController } from './observation-controller'

export class CaptureProcessSupervisorController {
  private _worker: UtilityProcess | null = null
  private _isSupervising = false
  private _currentSessionId = ''
  private _sequence = 0
  private _simulationTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly _context: MinimapObserverMainContext,
    private readonly _calibrationController: MinimapCalibrationController,
    private readonly _observationController: MinimapObservationController
  ) {}

  public init(): void {
    // Watch game session state
    this._context.mobxUtils.reaction(
      () => ({
        enabled: this._context.liveCoach.settings.enabled,
        sessionState: this._context.liveCoach.state.session.state,
        sessionId: this._context.liveCoach.state.session.id
      }),
      ({ enabled, sessionState, sessionId }) => {
        if (enabled && sessionState === 'active' && sessionId) {
          this.startCapture(sessionId)
        } else {
          this.stopCapture()
        }
      },
      { fireImmediately: true }
    )
  }

  public dispose(): void {
    this.stopCapture()
  }

  public startCapture(sessionId: string): void {
    if (this._isSupervising && this._currentSessionId === sessionId) {
      return
    }

    this._currentSessionId = sessionId
    this._isSupervising = true
    this._context.state.setIsCapturing(true)
    this._context.logger.info(
      `Starting MinimapObserver capture supervisor for session: ${sessionId}`
    )

    const calibration = this._calibrationController.getOrCreateCalibration()

    // Try to spawn utilityProcess, fallback to simulation if bundle not present in dev
    try {
      this._spawnWorker(sessionId, calibration.roi)
    } catch (err: any) {
      this._context.logger.warn(
        `Failed to spawn utilityProcess worker: ${err.message}. Starting fallback simulation.`
      )
      this._startSimulation(sessionId, calibration.roi)
    }
  }

  public stopCapture(): void {
    if (!this._isSupervising) {
      return
    }

    this._isSupervising = false
    this._currentSessionId = ''
    this._context.state.reset()

    if (this._simulationTimer) {
      clearInterval(this._simulationTimer)
      this._simulationTimer = null
    }

    if (this._worker) {
      try {
        this._worker.postMessage({
          type: 'stop',
          sessionId: this._currentSessionId,
          reason: 'capture-stopped'
        })
        this._worker.kill()
      } catch {
        // ignore
      }
      this._worker = null
    }

    this._context.logger.info('Stopped MinimapObserver capture supervisor')
  }

  private _spawnWorker(
    sessionId: string,
    roi: { x: number; y: number; width: number; height: number }
  ): void {
    // In production or built environment, worker script is in out/main
    const workerPath = path.join(__dirname, '../utility-processes/minimap-observer/index.js')

    const child = utilityProcess.fork(workerPath, [], {
      serviceName: 'minimap-observer-worker'
    })

    this._worker = child

    child.on('message', (rawMsg: unknown) => {
      const parsed = workerToMainMessageSchema.safeParse(rawMsg)
      if (parsed.success) {
        this._handleWorkerMessage(parsed.data as WorkerToMainMessage)
      }
    })

    child.on('exit', (code) => {
      this._context.logger.warn(`Minimap worker exited with code ${code}`)
      this._worker = null
      if (this._isSupervising) {
        // Restart or fallback to simulation
        this._startSimulation(sessionId, roi)
      }
    })

    // Send init & start message
    child.postMessage({
      type: 'initialize',
      protocolVersion: '1.0.0',
      runtimePaths: {},
      modelManifest: {}
    })

    child.postMessage({
      type: 'start',
      sessionId,
      targetHwnd: null,
      targetPid: null,
      backend: 'auto',
      captureConfig: { fps: 15, roi },
      detectors: ['unit-detector']
    })
  }

  private _handleWorkerMessage(msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case 'ready':
        this._context.logger.info('Minimap worker is ready')
        break
      case 'status':
        this._context.state.setFps(msg.fps)
        this._context.state.setRoiHealth(msg.roiHealth)
        break
      case 'observation-batch':
        this._observationController.handleObservationBatch(msg.batch)
        break
      case 'error':
        this._context.logger.warn(`Minimap worker error [${msg.code}]: ${msg.details}`)
        break
    }
  }

  private _startSimulation(
    sessionId: string,
    _roi: { x: number; y: number; width: number; height: number }
  ): void {
    if (this._simulationTimer) {
      clearInterval(this._simulationTimer)
    }

    this._context.state.setFps(15)
    this._context.state.setRoiHealth('healthy')

    this._simulationTimer = setInterval(() => {
      if (!this._isSupervising) return

      const now = Date.now()
      this._sequence++

      const batch: MinimapObservationBatch = {
        sessionId,
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: { 'detector-v1': '1.0.0' },
        frame: {
          observedAt: now,
          receivedAt: now,
          sequence: this._sequence,
          ageMs: 30
        },
        health: 'healthy',
        entities: [],
        events: []
      }

      this._observationController.handleObservationBatch(batch)
    }, 1000)
  }
}
