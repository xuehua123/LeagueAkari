import { NativeAddonBinding } from '../addon-binding'
import type {
  AkariCaptureBinding,
  NativeCaptureSessionBinding,
  NativeCaptureSessionOptions,
  NativeCaptureTargetEnvironment,
  NativeCaptureTargetOptions,
  NativeCapturedFrame
} from '../bindings'

export type {
  NativeCapturedFrame,
  NativeCaptureSessionOptions,
  NativeCaptureTargetEnvironment,
  NativeCaptureTargetOptions
}

const addon = new NativeAddonBinding<AkariCaptureBinding>('capture', () =>
  require('../../addons/akari-capture-win64.node')
)

export function load(): void {
  addon.load()
}

export function isLoaded(): boolean {
  return addon.isLoaded()
}

export function isWgcSupported(): boolean {
  return addon.get().isWgcSupported()
}

export function isDdaSupported(): boolean {
  return addon.get().isDdaSupported()
}

export function inspectTargetEnvironment(
  options: NativeCaptureTargetOptions
): NativeCaptureTargetEnvironment | null {
  return addon.get().inspectTargetEnvironment(options)
}

export class CaptureSession implements NativeCaptureSessionBinding {
  private readonly _binding: NativeCaptureSessionBinding

  constructor(options: NativeCaptureSessionOptions) {
    const Binding = addon.get().CaptureSession
    this._binding = new Binding(options)
  }

  captureFrame(timeoutMs = 100): NativeCapturedFrame | null {
    return this._binding.captureFrame(timeoutMs)
  }

  dispose(): void {
    this._binding.dispose()
  }
}
