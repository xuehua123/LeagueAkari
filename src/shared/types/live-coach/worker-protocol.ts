import { z } from 'zod'

import { MinimapObservationBatch, minimapObservationBatchSchema } from './observation'

export interface MainToWorkerInitMessage {
  type: 'initialize'
  protocolVersion: string
  runtimePaths: {
    onnxRuntimeDll?: string
    directMlDll?: string
  }
  modelManifest: Record<string, { version: string; sha256: string; path: string }>
}

export interface MainToWorkerStartMessage {
  type: 'start'
  sessionId: string
  patch?: string
  targetHwnd: number | null
  targetPid: number | null
  backend: 'auto' | 'wgc' | 'dda' | 'desktopCapturer'
  captureConfig: {
    fps: number
    roi: { x: number; y: number; width: number; height: number }
  }
  detectors: string[]
}

export interface MainToWorkerStopMessage {
  type: 'stop'
  sessionId: string
  reason: string
}

export interface MainToWorkerUpdateConfigMessage {
  type: 'update-config'
  detectorSwitches: Record<string, boolean>
  thresholds: Record<string, number>
  fps: number
}

export interface MainToWorkerRequestPreviewMessage {
  type: 'request-preview'
  requestId: string
  maxEdge: number
  includeImage: boolean
}

export interface MainToWorkerPingMessage {
  type: 'ping'
  requestId: string
  sentAt: number
}

export interface MainToWorkerShutdownMessage {
  type: 'shutdown'
  reason: string
}

export interface MainToWorkerFrameBufferMessage {
  type: 'frame-buffer'
  buffer: Uint8Array | Buffer | ArrayBuffer
  pixelFormat: 'bgra' | 'rgba'
  width: number
  height: number
  observedAt: number
  sequence: number
}

export type MainToWorkerMessage =
  | MainToWorkerInitMessage
  | MainToWorkerStartMessage
  | MainToWorkerStopMessage
  | MainToWorkerUpdateConfigMessage
  | MainToWorkerRequestPreviewMessage
  | MainToWorkerPingMessage
  | MainToWorkerShutdownMessage
  | MainToWorkerFrameBufferMessage

export interface WorkerToMainReadyMessage {
  type: 'ready'
  protocolVersion: string
  runtimeVersions: Record<string, string>
  supportedBackends: string[]
}

export interface WorkerToMainHeartbeatMessage {
  type: 'heartbeat'
  sequence: number
  captureState: string
  queueDepth: number
  memoryBytes: number
}

export interface WorkerToMainStatusMessage {
  type: 'status'
  backend: string
  resolution: { width: number; height: number }
  hdr: boolean
  fps: number
  roiHealth: 'healthy' | 'degraded' | 'occluded' | 'unknown'
}

export interface WorkerToMainObservationBatchMessage {
  type: 'observation-batch'
  batch: MinimapObservationBatch
}

export interface WorkerToMainPreviewResultMessage {
  type: 'preview-result'
  requestId: string
  roi: { x: number; y: number; width: number; height: number }
  imageDataUrl?: string
  expiresAt: number
}

export interface WorkerToMainMetricsMessage {
  type: 'metrics'
  captureLatencyMs: number
  inferenceLatencyMs: number
  dropCount: number
  frameAgeMs: number
}

export interface WorkerToMainErrorMessage {
  type: 'error'
  code: string
  recoverable: boolean
  stage: string
  details?: string
}

export interface WorkerToMainStoppedMessage {
  type: 'stopped'
  sessionId: string
  reason: string
}

export type WorkerToMainMessage =
  | WorkerToMainReadyMessage
  | WorkerToMainHeartbeatMessage
  | WorkerToMainStatusMessage
  | WorkerToMainObservationBatchMessage
  | WorkerToMainPreviewResultMessage
  | WorkerToMainMetricsMessage
  | WorkerToMainErrorMessage
  | WorkerToMainStoppedMessage

export const workerToMainMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    protocolVersion: z.string(),
    runtimeVersions: z.record(z.string(), z.string()),
    supportedBackends: z.array(z.string())
  }),
  z.object({
    type: z.literal('heartbeat'),
    sequence: z.number(),
    captureState: z.string(),
    queueDepth: z.number(),
    memoryBytes: z.number()
  }),
  z.object({
    type: z.literal('status'),
    backend: z.string(),
    resolution: z.object({ width: z.number(), height: z.number() }),
    hdr: z.boolean(),
    fps: z.number(),
    roiHealth: z.enum(['healthy', 'degraded', 'occluded', 'unknown'])
  }),
  z.object({
    type: z.literal('observation-batch'),
    batch: minimapObservationBatchSchema
  }),
  z.object({
    type: z.literal('preview-result'),
    requestId: z.string(),
    roi: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    imageDataUrl: z.string().optional(),
    expiresAt: z.number()
  }),
  z.object({
    type: z.literal('metrics'),
    captureLatencyMs: z.number(),
    inferenceLatencyMs: z.number(),
    dropCount: z.number(),
    frameAgeMs: z.number()
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    recoverable: z.boolean(),
    stage: z.string(),
    details: z.string().optional()
  }),
  z.object({
    type: z.literal('stopped'),
    sessionId: z.string(),
    reason: z.string()
  })
])
