import { loadTrustedNativeRuntime } from '../../native/trusted-native-runtime'
import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import type { LiveCoachMainContext } from './context'

export interface SpeakOptions {
  voiceId?: string | null
  outputDeviceId?: string | null
  volume?: number
  rate?: number
}

export interface SapiVoiceInfo {
  id: string
  name: string
  culture: string
  gender: string
}

export interface SapiOutputDeviceInfo {
  id: string
  name: string
  isDefault: boolean
}

type SpeechOperationState = 'speaking' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'unknown'

interface NativeSpeechSynthesizer {
  listVoices(): SapiVoiceInfo[]
  listOutputDevices(): SapiOutputDeviceInfo[]
  speak(
    text: string,
    options: {
      voiceId?: string | null
      outputDeviceId?: string | null
      volume: number
      rate: number
    }
  ): string
  getOperationState(operationId: string): SpeechOperationState
  cancel(operationId?: string): boolean
  pause(): boolean
  resume(): boolean
  dispose(): void
}

type NativeSpeechLoader = () => NativeSpeechSynthesizer

function loadNativeSpeech(): NativeSpeechSynthesizer {
  const native = loadTrustedNativeRuntime<typeof import('league-akari-native-win32')>()
  native.speech.load()
  return new native.speech.SpeechSynthesizer() as NativeSpeechSynthesizer
}

export class LocalSpeechExecutor {
  private _engine: NativeSpeechSynthesizer | null = null
  private _voices: SapiVoiceInfo[] = []
  private _currentOperationId: string | null = null
  private _operationGeneration = 0
  private _isSpeaking = false

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _loadNative: NativeSpeechLoader = loadNativeSpeech
  ) {}

  public get isSpeaking(): boolean {
    return this._isSpeaking
  }

  public get isAvailable(): boolean {
    return this._engine !== null
  }

  public initialize(): boolean {
    if (this._engine) return true
    if (process.platform !== 'win32') return false

    try {
      this._engine = this._loadNative()
      this._voices = this._engine.listVoices()
      if (!this._voices.some((voice) => voice.culture.toLowerCase().startsWith('zh'))) {
        this._context.logger.warn('No installed Chinese SAPI voice is available')
        this.dispose()
        return false
      }
      this._context.state.setSpeechState('idle')
      return true
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Failed to initialize native SAPI speech', error)
      )
      this.dispose()
      return false
    }
  }

  /** Uses in-process native SAPI 5.4 and never starts a shell. */
  public async speak(text: string, options: SpeakOptions = {}): Promise<boolean> {
    this.cancel()

    if (!text || text.trim() === '' || (!this._engine && !this.initialize())) {
      return false
    }

    const engine = this._engine!
    const volume = Math.min(
      100,
      Math.max(0, Math.round((options.volume ?? this._context.settings.speechVolume) * 100))
    )
    const rawRate = options.rate ?? this._context.settings.speechRate
    const sapiRate = Math.min(10, Math.max(-10, Math.round((rawRate - 1) * 5)))
    const configuredVoiceId = options.voiceId ?? this._context.settings.speechVoiceId
    const voiceId =
      configuredVoiceId && configuredVoiceId !== 'default'
        ? configuredVoiceId
        : this._preferredChineseVoiceId()
    const outputDeviceId =
      options.outputDeviceId ?? this._context.settings.speechOutputDeviceId ?? null
    const generation = ++this._operationGeneration

    try {
      const operationId = engine.speak(text.trim(), {
        voiceId,
        outputDeviceId: outputDeviceId === 'default' ? null : outputDeviceId,
        volume,
        rate: sapiRate
      })
      this._currentOperationId = operationId
      this._isSpeaking = true
      this._context.state.setSpeechState('speaking')
      return await this._waitForCompletion(operationId, generation, text.length)
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Native SAPI speech execution error', error)
      )
      if (generation === this._operationGeneration) this._setIdle()
      return false
    }
  }

  public async listInstalledVoices(): Promise<SapiVoiceInfo[]> {
    if (!this._engine && !this.initialize()) return []
    try {
      this._voices = this._engine!.listVoices()
      return [...this._voices]
    } catch (error) {
      this._context.logger.warn(formatSanitizedErrorLog('Failed to enumerate SAPI voices', error))
      return []
    }
  }

  public async listOutputDevices(): Promise<SapiOutputDeviceInfo[]> {
    if (!this._engine && !this.initialize()) return []
    try {
      return this._engine!.listOutputDevices()
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Failed to enumerate SAPI output devices', error)
      )
      return []
    }
  }

  public pause(): boolean {
    if (!this._engine || !this._isSpeaking) return false
    try {
      return this._engine.pause()
    } catch {
      return false
    }
  }

  public resume(): boolean {
    if (!this._engine || !this._currentOperationId) return false
    try {
      return this._engine.resume()
    } catch {
      return false
    }
  }

  public cancel(): void {
    this._operationGeneration++
    if (this._engine && this._currentOperationId) {
      try {
        this._engine.cancel(this._currentOperationId)
      } catch {
        // Local state is still cleared so a stale completion cannot be published.
      }
    }
    this._setIdle()
  }

  public dispose(): void {
    this.cancel()
    if (this._engine) {
      try {
        this._engine.dispose()
      } catch {
        // ignore native teardown errors during app shutdown
      }
      this._engine = null
    }
    this._voices = []
    this._context.state.setSpeechState('unavailable')
  }

  private _preferredChineseVoiceId(): string | null {
    const chinese = this._voices.find((voice) => voice.culture.toLowerCase().startsWith('zh'))
    return chinese?.id ?? null
  }

  private async _waitForCompletion(
    operationId: string,
    generation: number,
    textLength: number
  ): Promise<boolean> {
    const timeoutAt = Date.now() + Math.min(60_000, Math.max(10_000, textLength * 500))
    while (generation === this._operationGeneration && this._engine) {
      let state: SpeechOperationState
      try {
        state = this._engine.getOperationState(operationId)
      } catch (error) {
        this._context.logger.warn(
          formatSanitizedErrorLog('Failed to read SAPI operation state', error)
        )
        state = 'failed'
      }

      if (state === 'completed') {
        if (generation === this._operationGeneration) this._setIdle()
        return true
      }
      if (state === 'cancelled' || state === 'failed' || state === 'unknown') {
        if (generation === this._operationGeneration) this._setIdle()
        return false
      }
      if (Date.now() >= timeoutAt) {
        try {
          this._engine.cancel(operationId)
        } catch {
          // ignore cancellation failure after timeout
        }
        if (generation === this._operationGeneration) this._setIdle()
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return false
  }

  private _setIdle(): void {
    this._currentOperationId = null
    this._isSpeaking = false
    this._context.state.setSpeechState(this._engine ? 'idle' : 'unavailable')
  }
}
