import { type LiveCoachMainContext } from './context'
import type { LocalSpeechExecutor } from './local-speech-executor'
import type { LiveCoachSessionController } from './session-controller'

export class LiveCoachIpcHandlers {
  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _sessionController: LiveCoachSessionController,
    private readonly _speechExecutor: LocalSpeechExecutor
  ) {}

  public register(): void {
    const { ipc, namespace } = this._context

    ipc.onCall(namespace, 'startInternalSession', async (_e, options: any = {}) => {
      const sessionId = options.sessionId || `manual_${Date.now()}`
      this._sessionController.startSession(sessionId, 11, 420, '14.15.1')
      return { success: true, sessionId }
    })

    ipc.onCall(namespace, 'stopSession', async (_e, reason: string = 'user-manual-stop') => {
      this._sessionController.endSession(reason)
      return { success: true }
    })

    ipc.onCall(namespace, 'pause', async (_e, reason: string = 'user-pause') => {
      this._sessionController.pause(reason)
      return { success: true, state: 'paused' }
    })

    ipc.onCall(namespace, 'resume', async () => {
      this._sessionController.resume()
      return { success: true, state: 'active' }
    })

    ipc.onCall(namespace, 'testSpeech', async (_e, options: any = {}) => {
      const text = options.text || '实时语音 AI 教练测试播报，音量与语速正常。'
      const success = await this._speechExecutor.speak(text, {
        volume: options.volume ?? this._context.settings.speechVolume,
        rate: options.rate ?? this._context.settings.speechRate,
        voiceId: options.voiceId ?? this._context.settings.speechVoiceId
      })
      return { success }
    })

    ipc.onCall(
      namespace,
      'submitCueFeedback',
      async (_e, params: { cueId: string; type: string; comment?: string }) => {
        this._context.logger.info(`Cue feedback received for ${params?.cueId}: ${params?.type}`)
        return { feedbackId: `fb_${Date.now()}` }
      }
    )

    ipc.onCall(namespace, 'getEvidence', async (_e, evidenceId: string) => {
      const evidences = this._sessionController.fusion.getActiveEvidences()
      const found = evidences.find((e) => e.id === evidenceId)
      return found || null
    })

    ipc.onCall(namespace, 'listAudioDevices', async () => {
      return {
        inputDevices: [{ id: 'default', name: '系统默认麦克风' }],
        outputDevices: [{ id: 'default', name: '系统默认扬声器' }]
      }
    })
  }
}
