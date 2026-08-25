import { type ChildProcess, spawn } from 'node:child_process'

import type { LiveCoachMainContext } from './context'

export interface SpeakOptions {
  voiceId?: string | null
  volume?: number // 0-1
  rate?: number // 0.5-2
}

export class LocalSpeechExecutor {
  private _currentProcess: ChildProcess | null = null
  private _isSpeaking = false

  constructor(private readonly _context: LiveCoachMainContext) {}

  public get isSpeaking(): boolean {
    return this._isSpeaking
  }

  public async speak(text: string, options: SpeakOptions = {}): Promise<boolean> {
    this.cancel()

    if (!text || text.trim() === '') {
      return false
    }

    if (process.platform !== 'win32') {
      this._context.logger.info(`[TTS-Mock] (Non-Windows platform): ${text}`)
      return true
    }

    const volume = Math.round((options.volume ?? this._context.settings.speechVolume) * 100)
    // Rate in SAPI is -10 to 10. Default rate 1 maps to 0.
    const rawRate = options.rate ?? this._context.settings.speechRate
    const sapiRate = Math.round((rawRate - 1) * 5)

    // Sanitize text for powershell string literal
    const sanitizedText = text.replace(/['"`$]/g, '')

    const psScript = `
      Add-Type -AssemblyName System.Speech;
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $synth.Volume = ${volume};
      $synth.Rate = ${sapiRate};
      $synth.Speak('${sanitizedText}');
    `

    this._isSpeaking = true
    this._context.state.setSpeechState('speaking')

    return new Promise<boolean>((resolve) => {
      try {
        const proc = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psScript],
          {
            windowsHide: true
          }
        )

        this._currentProcess = proc

        proc.on('close', (code) => {
          if (this._currentProcess === proc) {
            this._currentProcess = null
            this._isSpeaking = false
            this._context.state.setSpeechState('idle')
          }
          resolve(code === 0)
        })

        proc.on('error', (err) => {
          this._context.logger.warn(`SAPI speech execution error: ${err.message}`)
          if (this._currentProcess === proc) {
            this._currentProcess = null
            this._isSpeaking = false
            this._context.state.setSpeechState('idle')
          }
          resolve(false)
        })
      } catch (err: any) {
        this._context.logger.warn(`Failed to spawn TTS process: ${err.message}`)
        this._isSpeaking = false
        this._context.state.setSpeechState('idle')
        resolve(false)
      }
    })
  }

  public cancel(): void {
    if (this._currentProcess) {
      try {
        this._currentProcess.kill()
      } catch {
        // ignore kill error
      }
      this._currentProcess = null
    }
    this._isSpeaking = false
    this._context.state.setSpeechState('idle')
  }
}
