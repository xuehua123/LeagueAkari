import { z } from 'zod'

import { MinimapObservationBatch, minimapObservationBatchSchema } from './observation'

export interface ChampionIdentityModelRuntimeDescriptor {
  modelName: string
  architecture: 'bootstrap-linear' | 'mobilenet-v3-small'
  format: 'onnx'
  version: string
  sha256: string
  path: string
  opset: 17
  inputName: string
  outputName: string
  inputShape: [1, 3, number, number]
  preprocessing: 'per-channel-standardize-l2' | 'imagenet'
  outputLayout: 'prototype-scores' | 'champion-logits'
  cropRatios: number[]
  championIds: number[]
  variantsPerChampion: number
  confidenceThreshold: number
  top2MarginThreshold: number
}

export interface MainToWorkerInitMessage {
  type: 'initialize'
  protocolVersion: string
  runtimePaths: {
    onnxRuntimeDll?: string
    directMlDll?: string
  }
  modelManifest: Record<string, ChampionIdentityModelRuntimeDescriptor>
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
    normalizedRoi?: { x: number; y: number; width: number; height: number }
  }
  detectors: string[]
  championCandidates?: number[]
  allyChampionCandidates?: number[]
  enemyChampionCandidates?: number[]
  selfChampionId?: number | null
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
  normalizedRoi?: { x: number; y: number; width: number; height: number }
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
  sourceWidth?: number
  sourceHeight?: number
  observedAt: number
  sequence: number
}

export interface MainToWorkerReplayStartMessage {
  type: 'replay-start'
  sessionId: string
  patch: string
  championCandidates: number[]
  allyChampionCandidates: number[]
  enemyChampionCandidates: number[]
  selfChampionId: number | null
}

export interface MainToWorkerReplayFrameMessage {
  type: 'replay-frame'
  requestId: string
  sessionId: string
  buffer: Uint8Array | Buffer | ArrayBuffer
  pixelFormat: 'bgra' | 'rgba'
  width: number
  height: number
  observedAt: number
  sequence: number
}

export interface MainToWorkerReplayStopMessage {
  type: 'replay-stop'
  sessionId: string
  reason: string
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
  | MainToWorkerReplayStartMessage
  | MainToWorkerReplayFrameMessage
  | MainToWorkerReplayStopMessage

const roiSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite()
})

export const mainToWorkerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('initialize'),
    protocolVersion: z.string(),
    runtimePaths: z.object({
      onnxRuntimeDll: z.string().optional(),
      directMlDll: z.string().optional()
    }),
    modelManifest: z.record(
      z.string(),
      z
        .object({
          modelName: z.string().min(1),
          architecture: z.enum(['bootstrap-linear', 'mobilenet-v3-small']),
          format: z.literal('onnx'),
          version: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/i),
          path: z.string().min(1),
          opset: z.literal(17),
          inputName: z.string().min(1),
          outputName: z.string().min(1),
          inputShape: z.tuple([
            z.literal(1),
            z.literal(3),
            z.number().int().min(8).max(256),
            z.number().int().min(8).max(256)
          ]),
          preprocessing: z.enum(['per-channel-standardize-l2', 'imagenet']),
          outputLayout: z.enum(['prototype-scores', 'champion-logits']),
          cropRatios: z.array(z.number().min(0).max(0.4)).min(1).max(8),
          championIds: z.array(z.number().int().positive()).min(1).max(512),
          variantsPerChampion: z.number().int().positive().max(16),
          confidenceThreshold: z.number().min(0).max(1),
          top2MarginThreshold: z.number().min(0).max(1)
        })
        .strict()
    )
  }),
  z.object({
    type: z.literal('start'),
    sessionId: z.string().min(1),
    patch: z.string().optional(),
    targetHwnd: z.number().nullable(),
    targetPid: z.number().nullable(),
    backend: z.enum(['auto', 'wgc', 'dda', 'desktopCapturer']),
    captureConfig: z.object({
      fps: z.number().min(1).max(60),
      roi: roiSchema,
      normalizedRoi: roiSchema.optional()
    }),
    detectors: z.array(z.string()),
    championCandidates: z.array(z.number().int().positive()).optional(),
    allyChampionCandidates: z.array(z.number().int().positive()).optional(),
    enemyChampionCandidates: z.array(z.number().int().positive()).optional(),
    selfChampionId: z.number().int().positive().nullable().optional()
  }),
  z.object({
    type: z.literal('stop'),
    sessionId: z.string(),
    reason: z.string()
  }),
  z.object({
    type: z.literal('update-config'),
    detectorSwitches: z.record(z.string(), z.boolean()),
    thresholds: z.record(z.string(), z.number()),
    fps: z.number().min(1).max(60),
    normalizedRoi: roiSchema.optional()
  }),
  z.object({
    type: z.literal('request-preview'),
    requestId: z.string().min(1),
    maxEdge: z.number().int().min(1).max(512),
    includeImage: z.boolean()
  }),
  z.object({
    type: z.literal('ping'),
    requestId: z.string().min(1),
    sentAt: z.number().min(0)
  }),
  z.object({
    type: z.literal('shutdown'),
    reason: z.string()
  }),
  z.object({
    type: z.literal('frame-buffer'),
    buffer: z.custom<Uint8Array | Buffer | ArrayBuffer>(
      (value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value)
    ),
    pixelFormat: z.enum(['bgra', 'rgba']),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sourceWidth: z.number().int().positive().optional(),
    sourceHeight: z.number().int().positive().optional(),
    observedAt: z.number().min(0),
    sequence: z.number().int().min(0)
  }),
  z.object({
    type: z.literal('replay-start'),
    sessionId: z.string().min(1),
    patch: z.string().min(1),
    championCandidates: z.array(z.number().int().positive()).max(10),
    allyChampionCandidates: z.array(z.number().int().positive()).max(5),
    enemyChampionCandidates: z.array(z.number().int().positive()).max(5),
    selfChampionId: z.number().int().positive().nullable()
  }),
  z.object({
    type: z.literal('replay-frame'),
    requestId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(200),
    buffer: z.custom<Uint8Array | Buffer | ArrayBuffer>(
      (value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value)
    ),
    pixelFormat: z.enum(['bgra', 'rgba']),
    width: z.number().int().positive().max(2048),
    height: z.number().int().positive().max(2048),
    observedAt: z.number().finite().min(0),
    sequence: z.number().int().positive()
  }),
  z.object({
    type: z.literal('replay-stop'),
    sessionId: z.string().min(1).max(200),
    reason: z.string().min(1).max(200)
  })
])

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
  backend: 'wgc' | 'dda' | 'desktopCapturer' | 'unavailable'
  resolution: { width: number; height: number }
  sourceResolution?: { width: number; height: number } | null
  hdr: boolean | null
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

export interface WorkerToMainReplayFrameResultMessage {
  type: 'replay-frame-result'
  requestId: string
  sessionId: string
  sequence: number
  dropped: boolean
  batch?: MinimapObservationBatch
  inferenceLatencyMs?: number
  reason?: string
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
  | WorkerToMainReplayFrameResultMessage

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
    backend: z.enum(['wgc', 'dda', 'desktopCapturer', 'unavailable']),
    resolution: z.object({ width: z.number(), height: z.number() }),
    sourceResolution: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .nullable()
      .optional(),
    hdr: z.boolean().nullable(),
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
  }),
  z
    .object({
      type: z.literal('replay-frame-result'),
      requestId: z.string().min(1).max(200),
      sessionId: z.string().min(1).max(200),
      sequence: z.number().int().positive(),
      dropped: z.boolean(),
      batch: minimapObservationBatchSchema.optional(),
      inferenceLatencyMs: z.number().finite().nonnegative().optional(),
      reason: z.string().max(200).optional()
    })
    .superRefine((message, context) => {
      if (!message.dropped && !message.batch) {
        context.addIssue({
          code: 'custom',
          path: ['batch'],
          message: 'A processed replay frame must include an observation batch'
        })
      }
      if (message.dropped && !message.reason) {
        context.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'A dropped replay frame must include a reason'
        })
      }
    })
])
