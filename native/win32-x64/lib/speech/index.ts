import { NativeAddonBinding } from '../addon-binding'
import type {
  AkariSpeechBinding,
  NativeSpeechOperationState,
  NativeSpeechOptions,
  NativeSpeechOutputDevice,
  NativeSpeechSynthesizerBinding,
  NativeSpeechVoice
} from '../bindings'

export type {
  NativeSpeechOperationState,
  NativeSpeechOptions,
  NativeSpeechOutputDevice,
  NativeSpeechVoice
}

const addon = new NativeAddonBinding<AkariSpeechBinding>('speech', () =>
  require('../../addons/akari-speech-win64.node')
)

export function load(): void {
  addon.load()
}

export function isLoaded(): boolean {
  return addon.isLoaded()
}

export function playEarcon(category: string, volume: number): Promise<boolean> {
  return addon.get().playEarcon(category, volume)
}

export class SpeechSynthesizer implements NativeSpeechSynthesizerBinding {
  private readonly _binding: NativeSpeechSynthesizerBinding

  constructor() {
    const Binding = addon.get().SpeechSynthesizer
    this._binding = new Binding()
  }

  listVoices(): NativeSpeechVoice[] {
    return this._binding.listVoices()
  }

  listOutputDevices(): NativeSpeechOutputDevice[] {
    return this._binding.listOutputDevices()
  }

  speak(text: string, options: NativeSpeechOptions): string {
    return this._binding.speak(text, options)
  }

  getOperationState(operationId: string): NativeSpeechOperationState {
    return this._binding.getOperationState(operationId)
  }

  cancel(operationId?: string): boolean {
    return this._binding.cancel(operationId)
  }

  pause(): boolean {
    return this._binding.pause()
  }

  resume(): boolean {
    return this._binding.resume()
  }

  dispose(): void {
    this._binding.dispose()
  }
}
