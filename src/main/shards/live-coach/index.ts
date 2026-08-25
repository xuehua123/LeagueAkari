import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { z } from 'zod'

import { GameClientMain } from '../game-client'
import { AkariIpcMain } from '../ipc'
import { LeagueClientMain } from '../league-client'
import { LiveGameDataMain } from '../live-game-data'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { LiveCoachCapabilityController } from './capability-controller'
import { LIVE_COACH_MAIN_NAMESPACE, type LiveCoachMainContext } from './context'
import { CueSchedulerController } from './cue-scheduler-controller'
import { LiveCoachIpcHandlers } from './ipc-handlers'
import { LocalSpeechExecutor } from './local-speech-executor'
import { LiveCoachSessionController } from './session-controller'
import { LiveCoachSettings, LiveCoachState } from './state'

/**
 * 实时语音 AI 教练主进程 Shard
 */
@Shard(LiveCoachMain.id)
export class LiveCoachMain implements IAkariShardInitDispose {
  static id = LIVE_COACH_MAIN_NAMESPACE

  public readonly settings = new LiveCoachSettings()
  public readonly state = new LiveCoachState()

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService<LiveCoachSettings>
  private readonly _context: LiveCoachMainContext

  private readonly _capabilityController: LiveCoachCapabilityController
  private readonly _speechExecutor: LocalSpeechExecutor
  private readonly _cueScheduler: CueSchedulerController
  private readonly _sessionController: LiveCoachSessionController
  private readonly _ipcHandlers: LiveCoachIpcHandlers

  constructor(
    private readonly _ipc: AkariIpcMain,
    _loggerFactory: LoggerFactoryMain,
    _settingFactory: SettingFactoryMain,
    private readonly _mobxUtils: MobxUtilsMain,
    private readonly _leagueClient: LeagueClientMain,
    private readonly _gameClient: GameClientMain,
    private readonly _liveGameData: LiveGameDataMain
  ) {
    this._logger = _loggerFactory.create(LiveCoachMain.id)

    this._settingService = _settingFactory.register(
      LiveCoachMain.id,
      {
        enabled: { default: this.settings.enabled, schema: z.boolean() },
        coachMode: {
          default: this.settings.coachMode,
          schema: z.enum(['minimal', 'balanced', 'training'])
        },
        outputMode: {
          default: this.settings.outputMode,
          schema: z.array(z.enum(['sound', 'subtitle', 'speech']))
        },
        captureBackend: {
          default: this.settings.captureBackend,
          schema: z.enum(['auto', 'wgc', 'dda'])
        },
        minimapSide: {
          default: this.settings.minimapSide,
          schema: z.enum(['auto', 'left', 'right'])
        },
        manualCalibration: {
          default: this.settings.manualCalibration,
          schema: z.unknown().nullable()
        },
        speechEnabled: { default: this.settings.speechEnabled, schema: z.boolean() },
        speechVoiceId: { default: this.settings.speechVoiceId, schema: z.string().nullable() },
        speechOutputDeviceId: {
          default: this.settings.speechOutputDeviceId,
          schema: z.string().nullable()
        },
        speechVolume: { default: this.settings.speechVolume, schema: z.number().min(0).max(1) },
        speechRate: { default: this.settings.speechRate, schema: z.number().min(0.5).max(2) },
        cueCategories: {
          default: this.settings.cueCategories,
          schema: z.record(z.string(), z.boolean())
        },
        pauseShortcut: { default: this.settings.pauseShortcut, schema: z.string().nullable() },
        muteShortcut: { default: this.settings.muteShortcut, schema: z.string().nullable() },
        overlayShortcut: { default: this.settings.overlayShortcut, schema: z.string().nullable() },
        recalibrateShortcut: {
          default: this.settings.recalibrateShortcut,
          schema: z.string().nullable()
        },
        overlayEnabled: { default: this.settings.overlayEnabled, schema: z.boolean() },
        overlayOpacity: {
          default: this.settings.overlayOpacity,
          schema: z.number().min(0.2).max(1)
        },
        replaySpeechSimulation: {
          default: this.settings.replaySpeechSimulation,
          schema: z.boolean()
        }
      },
      this.settings
    )

    this._context = {
      namespace: LiveCoachMain.id,
      logger: this._logger,
      settings: this.settings,
      state: this.state,
      settingService: this._settingService,
      ipc: this._ipc,
      mobxUtils: this._mobxUtils,
      leagueClient: this._leagueClient,
      gameClient: this._gameClient,
      liveGameData: this._liveGameData
    }

    this._capabilityController = new LiveCoachCapabilityController(this._context)
    this._speechExecutor = new LocalSpeechExecutor(this._context)
    this._cueScheduler = new CueSchedulerController(this._context, this._speechExecutor)
    this._sessionController = new LiveCoachSessionController(
      this._context,
      this._capabilityController,
      this._cueScheduler
    )
    this._ipcHandlers = new LiveCoachIpcHandlers(
      this._context,
      this._sessionController,
      this._speechExecutor
    )
  }

  public async onInit(): Promise<void> {
    this._logger.info('Initializing LiveCoachMain')

    // Register State and Settings for renderer synchronization
    this._mobxUtils.propSync(LiveCoachMain.id, 'settings', this.settings, [
      'enabled',
      'coachMode',
      'outputMode',
      'captureBackend',
      'minimapSide',
      'speechEnabled',
      'speechVoiceId',
      'speechOutputDeviceId',
      'speechVolume',
      'speechRate',
      'cueCategories',
      'overlayEnabled',
      'overlayOpacity',
      'replaySpeechSimulation'
    ])

    this._mobxUtils.propSync(LiveCoachMain.id, 'state', this.state, [
      'session',
      'capability',
      'capture',
      'liveData',
      'cue',
      'speech',
      'conversation',
      'lastError'
    ])

    this._ipcHandlers.register()
    this._cueScheduler.init()
    this._sessionController.init()
  }

  public feedMinimapObservationBatch(
    batch: import('@shared/types/live-coach').MinimapObservationBatch
  ): void {
    this._sessionController.handleMinimapBatch(batch)
  }

  public async onDispose(): Promise<void> {
    this._logger.info('Disposing LiveCoachMain')
    this._sessionController.dispose()
    this._cueScheduler.dispose()
  }
}
