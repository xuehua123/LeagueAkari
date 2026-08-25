import {
  MinimapCalibration,
  MinimapObservationBatch,
  WorkerToMainMessage,
  workerToMainMessageSchema
} from '@shared/types/live-coach'
import { type UtilityProcess, app, desktopCapturer, utilityProcess } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { getPidsByName } from '../../native'
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
  private _captureTimer: NodeJS.Timeout | null = null
  private _simulationTimer: NodeJS.Timeout | null = null
  private _onObservationBatchCallback: ((batch: MinimapObservationBatch) => void) | null = null
  private _currentCalibration: MinimapCalibration | null = null
  private _targetPid: number | null = null

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

  public async startSupervising(sessionId: string, calibration: MinimapCalibration): Promise<void> {
    if (this._isSupervising && this._currentSessionId === sessionId) {
      return
    }

    this._currentSessionId = sessionId
    this._isSupervising = true
    this._consecutiveCrashes = 0
    this._currentCalibration = calibration

    this._context.logger.info(
      `Starting MinimapObserver capture supervisor for session: ${sessionId}`
    )
    this._context.state.setIsCapturing(true)
    this._context.state.setBackend('wgc')
    this._context.state.setFps(15)

    // 查找英雄联盟游戏客户端进程 PID
    try {
      if (process.platform === 'win32') {
        const pids = await getPidsByName('League of Legends.exe')
        if (pids && pids.length > 0) {
          this._targetPid = pids[0]
        }
      }
    } catch {
      // 忽略未找到进程错误
    }

    try {
      this._spawnWorker(sessionId, calibration)
      this._startCaptureLoop()
    } catch (err: any) {
      this._context.logger.warn(
        `Failed to spawn utility worker: ${err.message}. Falling back to degraded status.`
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
    this._currentCalibration = null
    this._targetPid = null
    this._context.state.reset()

    if (this._captureTimer) {
      clearInterval(this._captureTimer)
      this._captureTimer = null
    }

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

  private _spawnWorker(sessionId: string, calibration: MinimapCalibration): void {
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
      this._startInternalPipeline(sessionId, calibration.roi)
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
          this._context.logger.error('Worker exceeded crash limit, switching to degraded pipeline')
          this._startInternalPipeline(sessionId, calibration.roi)
        } else {
          this._spawnWorker(sessionId, calibration)
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
      targetPid: this._targetPid,
      backend: 'wgc',
      detectors: ['enemy-champions', 'neutral-objectives'],
      captureConfig: {
        fps: 15,
        roi: {
          x: Math.round(calibration.roi.x * 1920),
          y: Math.round(calibration.roi.y * 1080),
          width: Math.round(calibration.roi.width * 1920),
          height: Math.round(calibration.roi.height * 1080)
        }
      }
    })
  }

  private _startCaptureLoop(): void {
    if (this._captureTimer) {
      clearInterval(this._captureTimer)
    }

    // 10 FPS 采样向 Worker 提供真实画面帧（支持 4K / 2K / 1080p 动态分辨率）
    this._captureTimer = setInterval(async () => {
      if (!this._isSupervising || !this._worker || !this._currentCalibration) {
        return
      }

      try {
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen'],
          thumbnailSize: { width: 3840, height: 2160 }
        })

        // 优先匹配英雄联盟游戏客户端窗口
        const gameSource = sources.find((s) => s.name.includes('League of Legends')) || sources[0]

        if (gameSource && gameSource.thumbnail) {
          const size = gameSource.thumbnail.getSize()
          if (size.width > 100 && size.height > 100) {
            const cal = this._currentCalibration
            const pixelRoi = {
              x: Math.max(0, Math.round(cal.roi.x * size.width)),
              y: Math.max(0, Math.round(cal.roi.y * size.height)),
              width: Math.min(size.width, Math.round(cal.roi.width * size.width)),
              height: Math.min(size.height, Math.round(cal.roi.height * size.height))
            }

            if (pixelRoi.width > 20 && pixelRoi.height > 20) {
              const minimapCrop = gameSource.thumbnail.crop(pixelRoi)
              const rawBitmap = minimapCrop.toBitmap()

              this._worker.postMessage({
                type: 'frame-buffer',
                buffer: rawBitmap,
                width: pixelRoi.width,
                height: pixelRoi.height,
                observedAt: Date.now()
              })
            }
          }
        }
      } catch {
        // 捕获异常保持稳定运行
      }
    }, 100)
  }

  private _handleWorkerMessage(msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case 'status':
        this._context.state.setFps(msg.fps)
        this._context.state.setRoiHealth(msg.roiHealth)
        break
      case 'observation-batch':
        this._context.state.setFrameAgeMs(msg.batch.frame.ageMs)
        this._context.state.setRoiHealth(msg.batch.health)
        if (this._onObservationBatchCallback) {
          this._onObservationBatchCallback(msg.batch)
        }
        this._observationController.handleObservationBatch(msg.batch)
        break
      case 'error':
        this._context.logger.warn(`Worker reported error [${msg.code}]: ${msg.details}`)
        this._context.state.setRoiHealth('degraded')
        break
    }
  }

  /**
   * 内部回退循环：无真实 Worker 或画面时必须标记为 unknown/degraded，绝不伪造 healthy
   */
  private _startInternalPipeline(
    sessionId: string,
    _roi: { x: number; y: number; width: number; height: number }
  ): void {
    if (this._simulationTimer) {
      clearInterval(this._simulationTimer)
    }

    this._context.state.setRoiHealth('unknown')

    let sequence = 0
    this._simulationTimer = setInterval(() => {
      if (!this._isSupervising) return

      sequence++
      const now = Date.now()

      // 无传感器数据时，报告 health: 'unknown'，entities: []
      const batch: MinimapObservationBatch = {
        sessionId,
        patch: '14.15.1',
        calibrationVersion: '1.0.0',
        modelVersions: { cnn: '1.0.0' },
        frame: {
          observedAt: now,
          receivedAt: now,
          sequence,
          ageMs: 0
        },
        health: 'unknown',
        entities: [],
        events: []
      }

      this._observationController.handleObservationBatch(batch)
    }, 1000)
  }
}
