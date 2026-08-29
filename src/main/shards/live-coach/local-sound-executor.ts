import { loadTrustedNativeRuntime } from '../../native/trusted-native-runtime'
import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import type { LiveCoachMainContext } from './context'

interface NativeEarconModule {
  load(): void
  playEarcon(category: string, volume: number): Promise<boolean>
}

type NativeEarconLoader = () => NativeEarconModule

function loadNativeEarcon(): NativeEarconModule {
  const native = loadTrustedNativeRuntime<typeof import('league-akari-native-win32')>()
  native.speech.load()
  return native.speech as NativeEarconModule
}

export class LocalSoundExecutor {
  private _nativeSpeech: NativeEarconModule | null = null

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _loadNative: NativeEarconLoader = loadNativeEarcon
  ) {}

  public initialize(): boolean {
    if (this._nativeSpeech) return true
    if (process.platform !== 'win32') return false
    try {
      this._nativeSpeech = this._loadNative()
      return true
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog('Failed to initialize native earcon output', error)
      )
      this._nativeSpeech = null
      return false
    }
  }

  public isAvailable(): boolean {
    return this._nativeSpeech !== null
  }

  public async playSound(category: string, volume: number = 0.8): Promise<boolean> {
    if (!this._nativeSpeech && !this.initialize()) return false
    try {
      return await this._nativeSpeech!.playEarcon(category, Math.max(0, Math.min(1, volume)))
    } catch (error) {
      this._context.logger.warn(formatSanitizedErrorLog('Native earcon playback failed', error))
      return false
    }
  }
}
