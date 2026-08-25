import { MinimapCalibrationController } from './calibration-controller'
import type { MinimapObserverMainContext } from './context'

export class MinimapObserverIpcHandlers {
  constructor(
    private readonly _context: MinimapObserverMainContext,
    private readonly _calibrationController: MinimapCalibrationController
  ) {}

  public register(): void {
    const { ipc, namespace } = this._context

    ipc.onCall(namespace, 'probeSupport', async () => {
      const isWindows = process.platform === 'win32'
      return {
        supported: isWindows,
        platform: process.platform,
        backends: isWindows ? ['wgc', 'dda'] : ['mock'],
        hdrSupported: false,
        permissionGranted: true
      }
    })

    ipc.onCall(
      namespace,
      'requestCalibrationPreview',
      async (_e, _includeImage: boolean = false) => {
        const calibration = this._calibrationController.getOrCreateCalibration()
        const fingerprint = this._calibrationController.getEnvironmentFingerprint()
        return {
          requestId: `req_${Date.now()}`,
          calibration,
          fingerprint,
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
        const calibration = this._calibrationController.applyManualCalibration(
          params.roi,
          params.side
        )
        return calibration
      }
    )

    ipc.onCall(namespace, 'resetCalibration', async () => {
      this._calibrationController.resetCalibration()
      return { deletedCount: 1 }
    })
  }
}
