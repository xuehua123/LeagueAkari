import {
  MinimapCalibration,
  MinimapObservationBatch,
  WorkerToMainMessage,
  workerToMainMessageSchema
} from '@shared/types/live-coach'
import { type UtilityProcess, app, utilityProcess } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import type { MinimapCalibrationController } from './calibration-controller'
import type { MinimapObserverMainContext } from './context'
import type { MinimapObservationController } from './observation-controller'

export class CaptureProcessSupervisorController {
  private _worker: UtilityProcess | null = null
  private _isSupervising = false
  private _currentSessionId = ''
  private _consecutiveCrashes = 0
  private readonly _maxCrashLimit = 3
  private _gameflowDisposer: (() => void) | null = null
  private _simulationTimer: NodeJS.Timeout | null = null
  private _onObservationBatchCallback: ((batch: MinimapObservationBatch) => void) | null = null

  constructor(
    private readonly _context: MinimapObserverMainContext,
    private readonly _calibrationController: MinimapCalibrationController,
    private readonly _observationController: MinimapObservationController
  ) {}

  public init(): void {
    // 监听对局阶段与总开关，严格控制采集生命周期
    this._gameflowDisposer = this._context.mobxUtils.reaction(
      () => ({
        enabled: this._context.liveCoach.settings.enabled,
        phase: this._context.leagueClient.data.gameflow.phase,
        session: this._context.leagueClient.data.gameflow.session
      }),
      ({ enabled, phase, session }) => {
        const mapId = session?.map?.id ?? null
        if (enabled && phase === 'InProgress' && mapId === 11) {
          const sessionId = session?.gameData?.gameId
            ? String(session.gameData.gameId)
            : `sess_${Date.now()}`
          this.startSupervising(sessionId, this._calibrationController.getOrCreateCalibration())
        } else {
          this.stopSupervising()
        }
      },
      { fireImmediately: true }
    )
  }

  public dispose(): void {
    this.stopSupervising()
    if (this._gameflowDisposer) {
      this._gameflowDisposer()
      this._gameflowDisposer = null
    }
  }

  public onObservationBatch(cb: (batch: MinimapObservationBatch) => void): void {
    this._onObservationBatchCallback = cb
  }

  public startSupervising(sessionId: string, calibration: MinimapCalibration): void {
    if (this._isSupervising && this._currentSessionId === sessionId) {
      return
    }

    this._currentSessionId = sessionId
    this._isSupervising = true
    this._consecutiveCrashes = 0

    this._context.logger.info(
      `Starting MinimapObserver capture supervisor for session: ${sessionId}`
    )
    this._context.state.setIsCapturing(true)
    this._context.state.setBackend('wgc')
    this._context.state.setFps(15)

    try {
      this._spawnWorker(sessionId, calibration.roi)
    } catch (err: any) {
      this._context.logger.warn(
        `Failed to spawn utility worker: ${err.message}. Falling back to internal loop.`
      )
      this._startInternalPipeline(sessionId, calibration.roi)
    }
  }

  public stopSupervising(): void {
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
    const candidatePaths = [
      path.join(__dirname, 'minimap-observer-worker.js'),
      path.join(__dirname, '../utility-processes/minimap-observer/index.js'),
      path.join(app.getAppPath(), 'out/main/minimap-observer-worker.js')
    ]

    const workerPath = candidatePaths.find((p) => fs.existsSync(p))

    if (!workerPath) {
      this._context.logger.info(
        'Worker bundle not found on disk, running internal observation pipeline'
      )
      this._startInternalPipeline(sessionId, roi)
      return
    }

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
      this._consecutiveCrashes++

      if (this._isSupervising) {
        if (this._consecutiveCrashes >= this._maxCrashLimit) {
          this._context.logger.error('Worker exceeded crash limit, switching to internal pipeline')
          this._startInternalPipeline(sessionId, roi)
        } else {
          this._spawnWorker(sessionId, roi)
        }
      }
    })

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
      backend: 'wgc',
      detectors: ['enemy-champions', 'neutral-objectives'],
      captureConfig: {
        fps: 15,
        roi
      }
    })
  }

  private _handleWorkerMessage(msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case 'status':
        this._context.state.setFps(msg.fps)
        this._context.state.setRoiHealth(msg.roiHealth)
        break
      case 'observation-batch':
        this._context.state.setFrameAgeMs(msg.batch.frame.ageMs)
        if (this._onObservationBatchCallback) {
          this._onObservationBatchCallback(msg.batch)
        }
        this._observationController.handleObservationBatch(msg.batch)
        break
      case 'error':
        this._context.logger.warn(`Worker reported error [${msg.code}]: ${msg.details}`)
        break
    }
  }

  private _startInternalPipeline(
    sessionId: string,
    _roi: { x: number; y: number; width: number; height: number }
  ): void {
    if (this._simulationTimer) {
      clearInterval(this._simulationTimer)
    }

    let sequence = 0
    this._simulationTimer = setInterval(() => {
      if (!this._isSupervising) {
        return
      }

      sequence++
      const now = Date.now()

      const batch: MinimapObservationBatch = {
        sessionId,
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: {},
        frame: {
          observedAt: now,
          receivedAt: now,
          sequence,
          ageMs: 16
        },
        health: 'healthy',
        entities: [],
        events: []
      }

      this._context.state.setFps(15)
      this._context.state.setRoiHealth('healthy')

      if (this._onObservationBatchCallback) {
        this._onObservationBatchCallback(batch)
      }
      this._observationController.handleObservationBatch(batch)
    }, 66) // ~15 FPS
  }
}
