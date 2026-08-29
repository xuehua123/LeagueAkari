import type { KeyboardShortcutsMain } from '../keyboard-shortcuts'
import type { MinimapCalibrationController } from './calibration-controller'
import type { CaptureProcessSupervisorController } from './capture-process-supervisor-controller'
import type { MinimapObserverMainContext } from './context'
import { formatSanitizedErrorLog } from './public-error'

export class MinimapCalibrationShortcutController {
  static readonly TARGET_ID = 'minimap-observer-main/recalibrate'

  private _reactionDisposer: (() => void) | null = null

  constructor(
    private readonly _context: MinimapObserverMainContext,
    private readonly _calibrationController: MinimapCalibrationController,
    private readonly _supervisorController: CaptureProcessSupervisorController,
    private readonly _keyboardShortcuts: KeyboardShortcutsMain
  ) {}

  public init(): void {
    this._reactionDisposer = this._context.mobxUtils.reaction(
      () => this._context.liveCoach.settings.recalibrateShortcut,
      (shortcut) => {
        this._keyboardShortcuts.unregisterByTargetId(MinimapCalibrationShortcutController.TARGET_ID)
        if (!shortcut) {
          return
        }

        try {
          this._keyboardShortcuts.register(
            MinimapCalibrationShortcutController.TARGET_ID,
            shortcut,
            'normal',
            () => void this._recalibrate()
          )
        } catch (error) {
          this._context.logger.warn(
            formatSanitizedErrorLog('Failed to register minimap recalibration shortcut', error)
          )
          void this._context.liveCoach.setRecalibrateShortcut(null)
        }
      },
      { fireImmediately: true }
    )
  }

  public dispose(): void {
    this._reactionDisposer?.()
    this._reactionDisposer = null
    this._keyboardShortcuts.unregisterByTargetId(MinimapCalibrationShortcutController.TARGET_ID)
  }

  private async _recalibrate(): Promise<void> {
    try {
      await this._calibrationController.resetCalibration()
      const { calibration } = await this._supervisorController.requestCalibrationPreview(false)
      this._supervisorController.applyCalibration(calibration)
      this._context.logger.info('Minimap calibration refreshed from global shortcut')
    } catch (error) {
      const fallback = this._calibrationController.getOrCreateCalibration()
      this._supervisorController.applyCalibration(fallback)
      this._context.logger.warn(
        formatSanitizedErrorLog(
          'Automatic minimap recalibration failed; applied the safe fallback calibration',
          error
        )
      )
    }
  }
}
