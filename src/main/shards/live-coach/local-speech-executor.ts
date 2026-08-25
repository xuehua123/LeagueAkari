import { type ChildProcess, spawn } from 'node:child_process'

import type { LiveCoachMainContext } from './context'

export interface SpeakOptions {
  voiceId?: string | null
  volume?: number // 0-1
  rate?: number // 0.5-2
}

export interface SapiVoiceInfo {
  id: string
  name: string
  culture: string
  gender: string
}

export class LocalSpeechExecutor {
  private _currentProcess: ChildProcess | null = null
  private _isSpeaking = false

  constructor(private readonly _context: LiveCoachMainContext) {}

  public get isSpeaking(): boolean {
    return this._isSpeaking
  }

  /**
   * 安全调用 Windows SAPI 5.4 离线合成语音
   * 采用 Base64 数据隔离，杜绝任何 PowerShell 代码注入
   */
  public async speak(text: string, options: SpeakOptions = {}): Promise<boolean> {
    this.cancel()

    if (!text || text.trim() === '') {
      return false
    }

    if (process.platform !== 'win32') {
      this._context.logger.info(`[TTS-Mock] (Non-Windows platform): ${text}`)
      return true
    }

    const volume = Math.min(
      100,
      Math.max(0, Math.round((options.volume ?? this._context.settings.speechVolume) * 100))
    )
    const rawRate = options.rate ?? this._context.settings.speechRate
    const sapiRate = Math.min(10, Math.max(-10, Math.round((rawRate - 1) * 5)))
    const voiceId = options.voiceId ?? this._context.settings.speechVoiceId

    // 1. 将文本编码为 Base64，彻底隔离任何特殊字符或注入向量
    const textBase64 = Buffer.from(text, 'utf-8').toString('base64')
    const voiceIdBase64 = voiceId ? Buffer.from(voiceId, 'utf-8').toString('base64') : ''

    const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Volume = ${volume}
$synth.Rate = ${sapiRate}

$voiceB64 = '${voiceIdBase64}'
if ($voiceB64 -ne '') {
  try {
    $voiceName = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($voiceB64))
    $synth.SelectVoice($voiceName)
  } catch {}
}

$textBytes = [System.Convert]::FromBase64String('${textBase64}')
$speakText = [System.Text.Encoding]::UTF8.GetString($textBytes)
$synth.Speak($speakText)
`
    const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64')

    this._isSpeaking = true
    this._context.state.setSpeechState('speaking')

    return new Promise<boolean>((resolve) => {
      try {
        const proc = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
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

  /**
   * 枚举 Windows 系统已安装的 SAPI 语音包
   */
  public async listInstalledVoices(): Promise<SapiVoiceInfo[]> {
    if (process.platform !== 'win32') {
      return [{ id: 'mock_voice', name: '系统默认语音 (Mock)', culture: 'zh-CN', gender: 'Female' }]
    }

    const script = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @()
foreach ($v in $synth.GetInstalledVoices()) {
  $info = $v.VoiceInfo
  $voices += [PSCustomObject]@{
    id = $info.Name
    name = $info.Description
    culture = $info.Culture.Name
    gender = $info.Gender.ToString()
  }
}
$voices | ConvertTo-Json -Compress
`
    const encodedCommand = Buffer.from(script, 'utf16le').toString('base64')

    return new Promise<SapiVoiceInfo[]>((resolve) => {
      try {
        const proc = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
          {
            windowsHide: true
          }
        )

        let output = ''
        proc.stdout?.on('data', (d) => (output += d.toString()))
        proc.on('close', (code) => {
          if (code === 0 && output.trim()) {
            try {
              const parsed = JSON.parse(output.trim())
              const list = Array.isArray(parsed) ? parsed : [parsed]
              resolve(
                list.map((v) => ({
                  id: v.id,
                  name: v.name || v.id,
                  culture: v.culture || 'zh-CN',
                  gender: v.gender || 'Unknown'
                }))
              )
              return
            } catch {}
          }
          resolve([{ id: 'default', name: '系统默认语音', culture: 'zh-CN', gender: 'Female' }])
        })
        proc.on('error', () => {
          resolve([{ id: 'default', name: '系统默认语音', culture: 'zh-CN', gender: 'Female' }])
        })
      } catch {
        resolve([{ id: 'default', name: '系统默认语音', culture: 'zh-CN', gender: 'Female' }])
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
