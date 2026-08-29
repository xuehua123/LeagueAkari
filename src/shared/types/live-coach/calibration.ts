import { z } from 'zod'

export interface CaptureEnvironmentFingerprint {
  /** Native monitor device id for the display that currently owns the game window. */
  displayId: string | null
  /** Game client-area size in physical pixels, never a desktopCapturer thumbnail size. */
  width: number | null
  height: number | null
  dpiScale: number | null
  hdr: boolean | null
  windowMode: 'windowed' | 'borderless' | 'exclusive-fullscreen' | 'unknown'
  backend: 'auto' | 'wgc' | 'dda' | 'desktopCapturer' | 'unavailable'
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
  displayId: z.string().min(1).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  dpiScale: z.number().positive().nullable(),
  hdr: z.boolean().nullable(),
  windowMode: z.enum(['windowed', 'borderless', 'exclusive-fullscreen', 'unknown']),
  backend: z.enum(['auto', 'wgc', 'dda', 'desktopCapturer', 'unavailable']),
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
