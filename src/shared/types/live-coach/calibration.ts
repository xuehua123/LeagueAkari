import { z } from 'zod'

export interface CaptureEnvironmentFingerprint {
  displayId: string
  width: number
  height: number
  dpiScale: number
  hdr: boolean
  windowMode: 'windowed' | 'borderless' | 'exclusive-fullscreen' | 'unknown'
  backend: 'wgc' | 'dda'
  minimapSide: 'left' | 'right'
}

export interface MinimapCalibration {
  schemaVersion: 1
  id: string
  fingerprintHash: string
  roi: { x: number; y: number; width: number; height: number }
  transform: 'blue-normal' | 'red-rotated'
  source: 'automatic' | 'manual'
  confidence: number
  createdAt: number
}

export const captureEnvironmentFingerprintSchema = z.object({
  displayId: z.string(),
  width: z.number(),
  height: z.number(),
  dpiScale: z.number(),
  hdr: z.boolean(),
  windowMode: z.enum(['windowed', 'borderless', 'exclusive-fullscreen', 'unknown']),
  backend: z.enum(['wgc', 'dda']),
  minimapSide: z.enum(['left', 'right'])
})

export const minimapCalibrationSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  fingerprintHash: z.string(),
  roi: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1)
  }),
  transform: z.enum(['blue-normal', 'red-rotated']),
  source: z.enum(['automatic', 'manual']),
  confidence: z.number().min(0).max(1),
  createdAt: z.number()
})
