import { hasCurrentLiveCoachPrivacyConsent } from '@shared/types/live-coach'

import { AkariIpcError } from '../ipc'
import { LIVE_COACH_CONSENT_REQUIRED_REASON } from '../live-coach/privacy-consent'
import { MinimapCalibrationController } from './calibration-controller'
import type { CaptureProcessSupervisorController } from './capture-process-supervisor-controller'
import type { MinimapObserverMainContext } from './context'

export class MinimapObserverIpcHandlers {
  constructor(
    private readonly _context: MinimapObserverMainContext,
    private readonly _calibrationController: MinimapCalibrationController,
    private readonly _supervisorController: CaptureProcessSupervisorController
  ) {}

  public register(): void {
    const { ipc, namespace } = this._context

    ipc.onCall(namespace, 'probeSupport', async () => {
      return this._supervisorController.probeCaptureSupport()
    })

    ipc.onCall(
      namespace,
      'requestCalibrationPreview',
      async (_e, _includeImage: boolean = false) => {
        if (!hasCurrentLiveCoachPrivacyConsent(this._context.liveCoach.settings)) {
          throw new AkariIpcError(
            '请先确认当前隐私说明，再读取游戏窗口用于诊断或标定',
            LIVE_COACH_CONSENT_REQUIRED_REASON
          )
        }
        const preview = await this._supervisorController.requestCalibrationPreview(_includeImage)
        return {
          requestId: `req_${Date.now()}`,
          ...preview,
          expiresAt: Date.now() + 10000
        }
      }
    )

    ipc.onCall(
      namespace,
      'applyManualCalibration',
      async (
        _e,
        params: {
          roi: { x: number; y: number; width: number; height: number }
          side: 'left' | 'right'
        }
      ) => {
        const calibration = await this._calibrationController.applyManualCalibration(
          params.roi,
          params.side
        )
        this._supervisorController.applyCalibration(calibration)
        return calibration
      }
    )

    ipc.onCall(namespace, 'resetCalibration', async () => {
      const calibration = await this._calibrationController.resetCalibration()
      this._supervisorController.applyCalibration(calibration)
      return { deletedCount: 1, calibration }
    })
  }
}
