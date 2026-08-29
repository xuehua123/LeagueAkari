import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'

import { GameClientMain } from '../game-client'
import { AkariIpcMain } from '../ipc'
import { KeyboardShortcutsMain } from '../keyboard-shortcuts'
import { LeagueClientMain } from '../league-client'
import { LiveCoachMain } from '../live-coach'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { MinimapCalibrationController } from './calibration-controller'
import { MinimapCalibrationShortcutController } from './calibration-shortcut-controller'
import { CaptureProcessSupervisorController } from './capture-process-supervisor-controller'
import { MINIMAP_OBSERVER_MAIN_NAMESPACE, type MinimapObserverMainContext } from './context'
import { MinimapObserverIpcHandlers } from './ipc-handlers'
import { MinimapObservationController } from './observation-controller'
import { MinimapObserverState } from './state'

/**
 * 小地图视觉观察 Main Shard（负责环境指纹、ROI 标定、采集与推理子进程生命周期管理）
 */
@Shard(MinimapObserverMain.id)
export class MinimapObserverMain implements IAkariShardInitDispose {
  static id = MINIMAP_OBSERVER_MAIN_NAMESPACE

  public readonly state = new MinimapObserverState()

  private readonly _logger: AkariLogger
  private readonly _context: MinimapObserverMainContext

  private readonly _calibrationController: MinimapCalibrationController
  private readonly _observationController: MinimapObservationController
  private readonly _supervisorController: CaptureProcessSupervisorController
  private readonly _calibrationShortcutController: MinimapCalibrationShortcutController
  private readonly _ipcHandlers: MinimapObserverIpcHandlers
  private _calibrationSettingDisposer: (() => void) | null = null

  constructor(
    private readonly _ipc: AkariIpcMain,
    _loggerFactory: LoggerFactoryMain,
    private readonly _mobxUtils: MobxUtilsMain,
    private readonly _leagueClient: LeagueClientMain,
    private readonly _gameClient: GameClientMain,
    private readonly _liveCoach: LiveCoachMain,
    private readonly _keyboardShortcuts: KeyboardShortcutsMain
  ) {
    this._logger = _loggerFactory.create(MinimapObserverMain.id)

    this._context = {
      namespace: MinimapObserverMain.id,
      logger: this._logger,
      state: this.state,
      ipc: this._ipc,
      mobxUtils: this._mobxUtils,
      leagueClient: this._leagueClient,
      gameClient: this._gameClient,
      liveCoach: this._liveCoach
    }

    this._calibrationController = new MinimapCalibrationController(this._context)
    this._observationController = new MinimapObservationController(this._context)
    this._supervisorController = new CaptureProcessSupervisorController(
      this._context,
      this._calibrationController,
      this._observationController
    )
    this._calibrationShortcutController = new MinimapCalibrationShortcutController(
      this._context,
      this._calibrationController,
      this._supervisorController,
      this._keyboardShortcuts
    )
    this._ipcHandlers = new MinimapObserverIpcHandlers(
      this._context,
      this._calibrationController,
      this._supervisorController
    )
  }

  public async onInit(): Promise<void> {
    this._logger.info('Initializing MinimapObserverMain')

    this._mobxUtils.propSync(MinimapObserverMain.id, 'state', this.state, [
      'isCapturing',
      'backend',
      'fps',
      'frameAgeMs',
      'roiHealth',
      'currentCalibration'
    ])

    this._ipcHandlers.register()
    this._calibrationShortcutController.init()
    this._supervisorController.init()
    this._calibrationSettingDisposer = this._mobxUtils.reaction(
      () => this._liveCoach.settings.manualCalibration,
      (calibration, previousCalibration) => {
        if (calibration !== null || previousCalibration === null) return
        this.state.setCurrentCalibration(null)
        this._supervisorController.applyCalibration(
          this._calibrationController.getOrCreateCalibration()
        )
      }
    )
  }

  public async onDispose(): Promise<void> {
    this._logger.info('Disposing MinimapObserverMain')
    this._calibrationSettingDisposer?.()
    this._calibrationSettingDisposer = null
    this._calibrationShortcutController.dispose()
    this._supervisorController.dispose()
  }
}
