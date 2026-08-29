import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import {
  type LiveCoachBuildChannel,
  type MinimapCalibration,
  coachCommunicationCategorySettingsSchema,
  coachCommunicationTemplatesSchema,
  hasCurrentLiveCoachPrivacyConsent,
  minimapCalibrationSchema,
  requiresLiveCoachPrivacyReconfirmation
} from '@shared/types/live-coach'
import { getSgpServerId } from '@shared/utils/sgp'
import { app, clipboard } from 'electron'
import { z } from 'zod'

import { AkariApiMain } from '../akari-api'
import { AkariProtocolMain } from '../akari-protocol'
import { FeatureGatingMain } from '../feature-gating'
import { GameClientMain } from '../game-client'
import { AkariIpcMain } from '../ipc'
import { KeyboardShortcutsMain } from '../keyboard-shortcuts'
import { LeagueClientMain } from '../league-client'
import { LiveGameDataMain } from '../live-game-data'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { WindowManagerMain } from '../window-manager'
import { LiveCoachAcceptanceEvidenceController } from './acceptance-evidence-controller'
import { LiveCoachCapabilityController } from './capability-controller'
import { CommunicationController } from './communication-controller'
import { LIVE_COACH_MAIN_NAMESPACE, type LiveCoachMainContext } from './context'
import { CooldownTrackerController } from './cooldown-tracker-controller'
import { CueFeedbackController } from './cue-feedback-controller'
import { CueSchedulerController } from './cue-scheduler-controller'
import { LiveCoachIpcHandlers } from './ipc-handlers'
import { LocalSoundExecutor } from './local-sound-executor'
import { LocalSpeechExecutor } from './local-speech-executor'
import { ReplayHistoryController, resolveReplayHistoryDirectory } from './replay-history'
import { ReplayImportController } from './replay-import-controller'
import { LiveCoachSessionController } from './session-controller'
import { LiveCoachShortcutController } from './shortcut-controller'
import { LiveCoachSettings, LiveCoachState } from './state'

declare const __LIVE_COACH_BUILD_CHANNEL__: LiveCoachBuildChannel

function getLiveCoachBuildChannel(): LiveCoachBuildChannel {
  if (typeof __LIVE_COACH_BUILD_CHANNEL__ !== 'undefined') {
    return __LIVE_COACH_BUILD_CHANNEL__
  }
  return app.isPackaged ? 'public' : 'internal'
}

/**
 * 实时语音 AI 教练主进程 Shard
 */
@Shard(LiveCoachMain.id)
export class LiveCoachMain implements IAkariShardInitDispose {
  static readonly id = LIVE_COACH_MAIN_NAMESPACE

  public readonly settings = new LiveCoachSettings()
  public readonly state = new LiveCoachState()

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService<LiveCoachSettings>
  private readonly _context: LiveCoachMainContext

  private readonly _capabilityController: LiveCoachCapabilityController
  private readonly _speechExecutor: LocalSpeechExecutor
  private readonly _soundExecutor: LocalSoundExecutor
  private readonly _cueScheduler: CueSchedulerController
  private readonly _cooldownTracker: CooldownTrackerController
  private readonly _communicationController: CommunicationController
  private readonly _feedbackController: CueFeedbackController
  private readonly _acceptanceController: LiveCoachAcceptanceEvidenceController
  private readonly _sessionController: LiveCoachSessionController
  private readonly _shortcutController: LiveCoachShortcutController
  private readonly _replayHistoryController: ReplayHistoryController
  private readonly _replayImportController: ReplayImportController
  private readonly _ipcHandlers: LiveCoachIpcHandlers
  private _featureGatingDisposer: (() => void) | null = null
  private _capabilitySnapshotDisposer: (() => void) | null = null
  private _overlayVisibilityDisposer: (() => void) | null = null
  private _shadowModeDisposer: (() => void) | null = null
  private _privacyConsentDisposer: (() => void) | null = null

  constructor(
    private readonly _ipc: AkariIpcMain,
    private readonly _akariProtocol: AkariProtocolMain,
    _loggerFactory: LoggerFactoryMain,
    _settingFactory: SettingFactoryMain,
    private readonly _mobxUtils: MobxUtilsMain,
    private readonly _leagueClient: LeagueClientMain,
    private readonly _gameClient: GameClientMain,
    private readonly _liveGameData: LiveGameDataMain,
    private readonly _akariApi: AkariApiMain,
    private readonly _featureGating: FeatureGatingMain,
    private readonly _keyboardShortcuts: KeyboardShortcutsMain,
    private readonly _windowManager: WindowManagerMain
  ) {
    this._logger = _loggerFactory.create(LiveCoachMain.id)

    this._settingService = _settingFactory.register(
      LiveCoachMain.id,
      {
        enabled: { default: this.settings.enabled, schema: z.boolean() },
        onboardingCompleted: {
          default: this.settings.onboardingCompleted,
          schema: z.boolean()
        },
        privacyConsentVersion: {
          default: this.settings.privacyConsentVersion,
          schema: z.string().nullable()
        },
        autoStartEnabled: {
          default: this.settings.autoStartEnabled,
          schema: z.boolean()
        },
        coachMode: {
          default: this.settings.coachMode,
          schema: z.enum(['minimal', 'balanced', 'training'])
        },
        shadowModeEnabled: {
          default: this.settings.shadowModeEnabled,
          schema: z.boolean()
        },
        cueDensity: {
          default: this.settings.cueDensity,
          schema: z.enum(['low', 'standard', 'high'])
        },
        minimumCueIntervalSeconds: {
          default: this.settings.minimumCueIntervalSeconds,
          schema: z.number().min(2).max(15)
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
        itemGuidanceMode: {
          default: this.settings.itemGuidanceMode,
          schema: z.enum(['system', 'common', 'adaptive', 'custom'])
        },
        customItemBuilds: {
          default: this.settings.customItemBuilds,
          schema: z.record(z.string().regex(/^\d+$/), z.array(z.number().int().positive()).max(12))
        },
        fogInferenceEnabled: {
          default: this.settings.fogInferenceEnabled,
          schema: z.boolean()
        },
        fogInferenceDetail: {
          default: this.settings.fogInferenceDetail,
          schema: z.enum(['region', 'route', 'intent'])
        },
        itemGuidanceEnabled: {
          default: this.settings.itemGuidanceEnabled,
          schema: z.boolean()
        },
        cooldownTrackingEnabled: {
          default: this.settings.cooldownTrackingEnabled,
          schema: z.boolean()
        },
        communicationAssistEnabled: {
          default: this.settings.communicationAssistEnabled,
          schema: z.boolean()
        },
        communicationTemplates: {
          default: this.settings.communicationTemplates,
          schema: coachCommunicationTemplatesSchema
        },
        communicationCategories: {
          default: this.settings.communicationCategories,
          schema: coachCommunicationCategorySettingsSchema
        },
        communicationCooldownSeconds: {
          default: this.settings.communicationCooldownSeconds,
          schema: z.number().min(3).max(60)
        },
        communicationConfirmShortcut: {
          default: this.settings.communicationConfirmShortcut,
          schema: z.string().nullable()
        },
        manualCalibration: {
          default: this.settings.manualCalibration,
          schema: minimapCalibrationSchema.nullable()
        },
        speechEnabled: { default: this.settings.speechEnabled, schema: z.boolean() },
        speechVoiceId: { default: this.settings.speechVoiceId, schema: z.string().nullable() },
        speechOutputDeviceId: {
          default: this.settings.speechOutputDeviceId,
          schema: z.string().nullable()
        },
        speechVolume: { default: this.settings.speechVolume, schema: z.number().min(0).max(1) },
        soundVolume: { default: this.settings.soundVolume, schema: z.number().min(0).max(1) },
        speechRate: { default: this.settings.speechRate, schema: z.number().min(0.5).max(2) },
        cueCategories: {
          default: this.settings.cueCategories,
          schema: z.record(z.string(), z.boolean())
        },
        muted: { default: this.settings.muted, schema: z.boolean() },
        pauseShortcut: { default: this.settings.pauseShortcut, schema: z.string().nullable() },
        muteShortcut: { default: this.settings.muteShortcut, schema: z.string().nullable() },
        repeatShortcut: { default: this.settings.repeatShortcut, schema: z.string().nullable() },
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
        overlayLocked: { default: this.settings.overlayLocked, schema: z.boolean() },
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
    this._soundExecutor = new LocalSoundExecutor(this._context)
    this._cueScheduler = new CueSchedulerController(
      this._context,
      this._speechExecutor,
      this._soundExecutor
    )
    this._feedbackController = new CueFeedbackController(this._context, this._cueScheduler)
    this._acceptanceController = new LiveCoachAcceptanceEvidenceController(
      this._context,
      this._cueScheduler
    )
    this._cooldownTracker = new CooldownTrackerController(this._context)
    this._communicationController = new CommunicationController(this._context, (text) =>
      clipboard.writeText(text)
    )
    this._sessionController = new LiveCoachSessionController(
      this._context,
      this._capabilityController,
      this._cueScheduler,
      this._cooldownTracker,
      this._communicationController
    )
    this._acceptanceController.setEvidenceVerifier((cue) =>
      cue.evidenceIds.every((evidenceId) => {
        const evidence = this._sessionController.fusion.getEvidence(evidenceId, cue.createdAt)
        return (
          evidence !== null &&
          evidence.sessionId === cue.sessionId &&
          evidence.temporalScope === 'current' &&
          evidence.freshness.state === 'fresh' &&
          evidence.clock.observedAt <= cue.createdAt &&
          evidence.clock.receivedAt <= cue.createdAt &&
          evidence.freshness.expiresAt > cue.createdAt
        )
      })
    )
    this._shortcutController = new LiveCoachShortcutController(
      this._context,
      this._sessionController,
      this._cueScheduler,
      this._keyboardShortcuts,
      this._windowManager,
      this._communicationController
    )
    this._replayHistoryController = new ReplayHistoryController({
      rootDirectory: resolveReplayHistoryDirectory(app.getPath('userData')),
      logger: this._logger
    })
    this._replayImportController = new ReplayImportController(
      this._context,
      undefined,
      this._akariProtocol
    )
    this._ipcHandlers = new LiveCoachIpcHandlers(
      this._context,
      this._sessionController,
      this._speechExecutor,
      this._cueScheduler,
      this._feedbackController,
      this._acceptanceController,
      this._cooldownTracker,
      this._communicationController,
      this._replayImportController,
      this._replayHistoryController
    )
    this._capabilityController.onGateBDisabled = () => {
      this._cueScheduler.reset()
      this._speechExecutor.cancel()
    }
    this._capabilityController.onGateADisabled = () => {
      this._cueScheduler.reset()
      this._sessionController.invalidateRealtimeAnalysis()
    }
    this._capabilityController.onCapabilitiesDisabled = (capabilityIds) => {
      this._sessionController.handleCapabilitiesDisabled(capabilityIds)
    }
  }

  public async onInit(): Promise<void> {
    this._logger.info('Initializing LiveCoachMain')

    await this._settingService.applyToState()

    // A legacy boolean-only acknowledgement, a stale notice version, or a version written by a
    // newer release must never be promoted into consent for the current privacy notice.
    if (requiresLiveCoachPrivacyReconfirmation(this.settings)) {
      await this._settingService.set('onboardingCompleted', false)
    }
    if (!hasCurrentLiveCoachPrivacyConsent(this.settings) && this.settings.enabled) {
      await this._settingService.set('enabled', false)
    }

    const ttsAvailable = this._speechExecutor.initialize()
    this.state.setSpeechState(ttsAvailable ? 'idle' : 'unavailable')
    this._capabilityController.setTtsAvailable(ttsAvailable)
    this._capabilityController.setSoundAvailable(this._soundExecutor.initialize())

    // Register State and Settings for renderer synchronization
    this._mobxUtils.propSync(LiveCoachMain.id, 'settings', this.settings, [
      'enabled',
      'onboardingCompleted',
      'privacyConsentVersion',
      'autoStartEnabled',
      'coachMode',
      'shadowModeEnabled',
      'cueDensity',
      'minimumCueIntervalSeconds',
      'outputMode',
      'captureBackend',
      'minimapSide',
      'itemGuidanceMode',
      'customItemBuilds',
      'fogInferenceEnabled',
      'fogInferenceDetail',
      'itemGuidanceEnabled',
      'cooldownTrackingEnabled',
      'communicationAssistEnabled',
      'communicationTemplates',
      'communicationCategories',
      'communicationCooldownSeconds',
      'communicationConfirmShortcut',
      'speechEnabled',
      'speechVoiceId',
      'speechOutputDeviceId',
      'speechVolume',
      'soundVolume',
      'speechRate',
      'cueCategories',
      'muted',
      'pauseShortcut',
      'muteShortcut',
      'repeatShortcut',
      'overlayShortcut',
      'recalibrateShortcut',
      'overlayEnabled',
      'overlayOpacity',
      'overlayLocked',
      'replaySpeechSimulation'
    ])

    this._mobxUtils.propSync(LiveCoachMain.id, 'state', this.state, [
      'buildChannel',
      'session',
      'capability',
      'capture',
      'liveData',
      'cue',
      'recentCues',
      'sessionCueStats',
      'lastSessionSummary',
      'fogInferences',
      'itemGuidance',
      'cooldowns',
      'communicationHistory',
      'speech',
      'conversation',
      'lastError'
    ])

    const buildChannel = getLiveCoachBuildChannel()
    this.state.setBuildChannel(buildChannel)
    this._capabilityController.setBuildChannel(buildChannel)
    const getRuntimeRegion = () => {
      const auth = this._leagueClient.state.auth
      return auth ? getSgpServerId(auth.region, auth.rsoPlatformId) : null
    }
    this._capabilityController.setRuntimeRegion(getRuntimeRegion())
    this._capabilityController.setCapabilitySnapshot(
      this._akariApi.state.liveCoachCapabilities,
      this._akariApi.state.liveCoachCapabilityStatus
    )

    if (buildChannel === 'internal') {
      this._capabilityController.setGates(true, true)
    } else {
      const gateA = this._featureGating.isEnabled('live-coach.capture', false)
      const gateB = this._featureGating.isEnabled('live-coach.realtime-output', false)
      this._capabilityController.setGates(gateA, gateB)
    }

    this._featureGatingDisposer = this._mobxUtils.reaction(
      () => ({
        gateA: this._featureGating.isEnabled('live-coach.capture', false),
        gateB: this._featureGating.isEnabled('live-coach.realtime-output', false)
      }),
      ({ gateA, gateB }) => {
        if (this._capabilityController.buildChannel === 'public') {
          this._capabilityController.setGates(gateA, gateB)
        }
      }
    )

    this._capabilitySnapshotDisposer = this._mobxUtils.reaction(
      () => ({
        snapshot: this._akariApi.state.liveCoachCapabilities,
        status: this._akariApi.state.liveCoachCapabilityStatus,
        regionId: getRuntimeRegion()
      }),
      ({ snapshot, status, regionId }) => {
        this._capabilityController.setRuntimeRegion(regionId)
        this._capabilityController.setCapabilitySnapshot(snapshot, status)
      }
    )

    this._overlayVisibilityDisposer = this._mobxUtils.reaction(
      () => ({
        coachEnabled: this.settings.enabled,
        overlayEnabled: this.settings.overlayEnabled,
        sessionState: this.state.session.state,
        windowReady: this._windowManager.coachOverlayWindow.state.ready
      }),
      ({ coachEnabled, overlayEnabled, sessionState, windowReady }) => {
        const shouldShow =
          windowReady &&
          coachEnabled &&
          overlayEnabled &&
          (sessionState === 'active' || sessionState === 'paused')
        if (shouldShow) {
          this._windowManager.coachOverlayWindow.show()
        } else {
          this._windowManager.coachOverlayWindow.hide()
        }
      },
      { fireImmediately: true }
    )

    this._shadowModeDisposer = this._mobxUtils.reaction(
      () => this.settings.shadowModeEnabled,
      (enabled) => this._sessionController.applyShadowMode(enabled)
    )

    this._privacyConsentDisposer = this._mobxUtils.reaction(
      () => hasCurrentLiveCoachPrivacyConsent(this.settings),
      (hasConsent) => {
        if (!hasConsent) {
          void this._ipcHandlers.handlePrivacyConsentWithdrawal().catch((error) => {
            this._logger.warn(
              formatSanitizedErrorLog(
                'Failed to revoke replay file grants after consent withdrawal',
                error
              )
            )
          })
        }
      }
    )

    await this._feedbackController.init()
    await this._acceptanceController.init()
    await this._replayHistoryController.init()
    this._ipcHandlers.register()
    this._cueScheduler.init()
    this._shortcutController.init()
    this._sessionController.init()
  }

  public feedMinimapObservationBatch(
    batch: import('@shared/types/live-coach').MinimapObservationBatch
  ): void {
    this._sessionController.handleMinimapBatch(batch)
  }

  public setIdentityModelLoaded(
    loaded: boolean,
    descriptor?: { version: string; sha256: string } | null
  ): void {
    this._capabilityController.setIdentityModelLoaded(loaded, descriptor)
  }

  public refreshRuntimeCapabilities(status: {
    roiHealth?: string
    state?: string
    liveDataHealth?: string
    backend?: string | null
  }): void {
    this._capabilityController.evaluateCapabilities(
      this.state.session.mapId,
      this.state.session.queueId,
      this.state.session.patch,
      {
        roiHealth: status.roiHealth ?? this.state.capture.roiState,
        state: status.state ?? this.state.capture.state,
        liveDataHealth: status.liveDataHealth ?? this.state.liveData.state,
        backend: status.backend ?? this.state.capture.backend
      }
    )
  }

  public setManualCalibration(calibration: MinimapCalibration | null): Promise<void> {
    this.recordCalibrationAttempt(calibration)
    return this._settingService.set('manualCalibration', calibration)
  }

  public recordCalibrationAttempt(calibration: MinimapCalibration | null): void {
    this._acceptanceController.recordCalibrationAttempt(calibration)
  }

  public setRecalibrateShortcut(shortcut: string | null): Promise<void> {
    return this._settingService.set('recalibrateShortcut', shortcut)
  }

  public async onDispose(): Promise<void> {
    this._logger.info('Disposing LiveCoachMain')
    if (this._featureGatingDisposer) {
      this._featureGatingDisposer()
      this._featureGatingDisposer = null
    }
    if (this._capabilitySnapshotDisposer) {
      this._capabilitySnapshotDisposer()
      this._capabilitySnapshotDisposer = null
    }
    if (this._overlayVisibilityDisposer) {
      this._overlayVisibilityDisposer()
      this._overlayVisibilityDisposer = null
    }
    if (this._shadowModeDisposer) {
      this._shadowModeDisposer()
      this._shadowModeDisposer = null
    }
    if (this._privacyConsentDisposer) {
      this._privacyConsentDisposer()
      this._privacyConsentDisposer = null
    }
    this._sessionController.dispose()
    this._shortcutController.dispose()
    await this._ipcHandlers.dispose()
    await this._replayImportController.dispose()
    await this._replayHistoryController.dispose()
    await this._acceptanceController.dispose()
    this._cueScheduler.dispose()
    this._speechExecutor.dispose()
  }
}
