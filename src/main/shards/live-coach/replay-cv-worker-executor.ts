import {
  type MinimapObservationBatch,
  type WorkerToMainMessage,
  workerToMainMessageSchema
} from '@shared/types/live-coach'
import { type UtilityProcess, app, utilityProcess } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import type { ChampionIdentityModelDescriptor } from '../minimap-observer/champion-identity-model'
import { createWorkerPublicError } from '../minimap-observer/public-error'
import type { LiveCoachMainContext } from './context'

export interface ReplayCvWorkerStartOptions {
  sessionId: string
  patch: string
  identityModel: ChampionIdentityModelDescriptor | null
  championCandidates: number[]
  allyChampionCandidates: number[]
  enemyChampionCandidates: number[]
  selfChampionId: number | null
}

export interface ReplayCvFrame {
  buffer: Uint8Array
  pixelFormat: 'bgra' | 'rgba'
  width: number
  height: number
  observedAt: number
  sequence: number
}

export interface ReplayCvSession {
  readonly runtimeVersions: Readonly<Record<string, string>>
  processFrame(frame: ReplayCvFrame): Promise<MinimapObservationBatch>
  stop(reason: string): void
}

export type ReplayCvSessionFactory = (
  options: ReplayCvWorkerStartOptions
) => Promise<ReplayCvSession>

interface PendingFrame {
  sequence: number
  resolve: (batch: MinimapObservationBatch) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const READY_TIMEOUT_MS = 5_000
const FRAME_TIMEOUT_MS = 5_000
const PENDING_FRAME_CAPACITY = 3

type ReplayWorkerFactory = (workerPath: string) => UtilityProcess

function forkReplayWorker(workerPath: string): UtilityProcess {
  if (!utilityProcess?.fork) {
    throw new Error('当前运行环境不支持 Electron utility process，无法执行录像视觉分析')
  }
  return utilityProcess.fork(workerPath, [], {
    serviceName: 'LeagueAkari Replay CV'
  })
}

export function resolveMinimapWorkerPath(
  dirname: string = __dirname,
  appPath: string = app?.getAppPath?.() ?? process.cwd()
): string | null {
  const candidatePaths = [
    path.join(dirname, 'minimap-observer-worker.js'),
    path.join(dirname, '../utility-processes/minimap-observer/index.js'),
    path.join(appPath, 'out/main/minimap-observer-worker.js')
  ]
  return candidatePaths.find((candidate) => fs.existsSync(candidate)) ?? null
}

/**
 * 为单次录像分析创建独立 CV utility process。像素只跨进程发送，Electron main 仅接收结构化观测。
 */
export class ReplayCvWorkerExecutor implements ReplayCvSession {
  private _worker: UtilityProcess | null = null
  private _sessionId = ''
  private _runtimeVersions: Record<string, string> = {}
  private _readyResolve: ((versions: Record<string, string>) => void) | null = null
  private _readyReject: ((error: Error) => void) | null = null
  private _readyTimer: NodeJS.Timeout | null = null
  private readonly _pendingFrames = new Map<string, PendingFrame>()
  private _requestCounter = 0
  private _stopping = false

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _forkWorker: ReplayWorkerFactory = forkReplayWorker,
    private readonly _workerPathResolver: () => string | null = resolveMinimapWorkerPath
  ) {}

  public get runtimeVersions(): Readonly<Record<string, string>> {
    return this._runtimeVersions
  }

  public async start(options: ReplayCvWorkerStartOptions): Promise<this> {
    if (this._worker) throw new Error('录像 CV Worker 已经启动')
    const workerPath = this._workerPathResolver()
    if (!workerPath) throw new Error('未找到小地图 CV Worker 构建产物')

    this._sessionId = options.sessionId
    this._stopping = false
    const child = this._forkWorker(workerPath)
    this._worker = child
    child.on('message', (rawMessage: unknown) => {
      if (this._worker !== child) return
      const parsed = workerToMainMessageSchema.safeParse(rawMessage)
      if (!parsed.success) {
        this._context.logger.warn(
          `录像 CV Worker 返回无效协议消息: ${parsed.error.issues
            .map((issue) => issue.message)
            .join('; ')
            .slice(0, 500)}`
        )
        return
      }
      this._handleMessage(parsed.data as WorkerToMainMessage)
    })
    child.on('exit', (code) => {
      if (this._worker !== child) return
      this._worker = null
      const error = new Error(`录像 CV Worker 意外退出，代码 ${code}`)
      this._rejectReady(error)
      this._rejectAllFrames(error)
    })

    const ready = new Promise<Record<string, string>>((resolve, reject) => {
      this._readyResolve = resolve
      this._readyReject = reject
      this._readyTimer = setTimeout(() => {
        this._readyTimer = null
        reject(new Error(`录像 CV Worker 在 ${READY_TIMEOUT_MS}ms 内未完成初始化`))
      }, READY_TIMEOUT_MS)
    })
    // Initialization delivery can throw synchronously before execution reaches
    // `await ready`; attach a rejection observer now so stop() cannot create an
    // unhandled rejection while it tears the worker down.
    void ready.catch(() => undefined)

    try {
      child.postMessage({
        type: 'initialize',
        protocolVersion: '1.0.0',
        runtimePaths: {},
        modelManifest: options.identityModel ? { 'champion-icon-onnx': options.identityModel } : {}
      })
      this._runtimeVersions = await ready
      if (this._worker !== child) throw new Error('录像 CV Worker 在启动过程中已退出')
      child.postMessage({
        type: 'replay-start',
        sessionId: options.sessionId,
        patch: options.patch,
        championCandidates: options.championCandidates,
        allyChampionCandidates: options.allyChampionCandidates,
        enemyChampionCandidates: options.enemyChampionCandidates,
        selfChampionId: options.selfChampionId
      })
      return this
    } catch (error) {
      this.stop('initialization-failed')
      throw error
    }
  }

  public processFrame(frame: ReplayCvFrame): Promise<MinimapObservationBatch> {
    const worker = this._worker
    if (!worker || this._stopping) return Promise.reject(new Error('录像 CV Worker 未运行'))

    if (this._pendingFrames.size >= PENDING_FRAME_CAPACITY) {
      const oldestRequestId = this._pendingFrames.keys().next().value as string | undefined
      if (oldestRequestId) {
        const oldest = this._pendingFrames.get(oldestRequestId)
        if (oldest) {
          clearTimeout(oldest.timer)
          this._pendingFrames.delete(oldestRequestId)
          oldest.reject(new Error('录像 CV 帧已被更新的帧替代'))
        }
      }
    }

    const requestId = `${this._sessionId}:${frame.sequence}:${++this._requestCounter}`
    return new Promise<MinimapObservationBatch>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingFrames.delete(requestId)
        reject(new Error(`录像 CV 第 ${frame.sequence} 帧处理超时`))
      }, FRAME_TIMEOUT_MS)
      this._pendingFrames.set(requestId, { sequence: frame.sequence, resolve, reject, timer })
      try {
        worker.postMessage({
          type: 'replay-frame',
          requestId,
          sessionId: this._sessionId,
          ...frame
        })
      } catch (error) {
        clearTimeout(timer)
        this._pendingFrames.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  public stop(reason: string): void {
    if (this._stopping) return
    this._stopping = true
    const worker = this._worker
    this._worker = null
    const error = new Error(`录像 CV Worker 已停止: ${reason}`)
    this._rejectReady(error)
    this._rejectAllFrames(error)
    if (worker) {
      try {
        worker.postMessage({ type: 'replay-stop', sessionId: this._sessionId, reason })
        worker.postMessage({ type: 'shutdown', reason })
        worker.kill()
      } catch {
        // Worker may already have exited.
      }
    }
  }

  private _handleMessage(message: WorkerToMainMessage): void {
    if (message.type === 'ready') {
      if (this._readyTimer) clearTimeout(this._readyTimer)
      this._readyTimer = null
      const resolve = this._readyResolve
      this._readyResolve = null
      this._readyReject = null
      resolve?.({ ...message.runtimeVersions })
      return
    }
    if (message.type === 'replay-frame-result') {
      if (message.sessionId !== this._sessionId) return
      const pending = this._pendingFrames.get(message.requestId)
      if (!pending || pending.sequence !== message.sequence) return
      clearTimeout(pending.timer)
      this._pendingFrames.delete(message.requestId)
      if (message.dropped || !message.batch) {
        pending.reject(new Error(`录像 CV 帧被丢弃: ${message.reason ?? 'unknown'}`))
      } else {
        pending.resolve(message.batch)
      }
      return
    }
    if (message.type === 'error') {
      const publicError = createWorkerPublicError(message)
      this._context.logger.warn(
        `Replay CV worker reported ${publicError.code} at ${publicError.stage}; recoverable=${publicError.recoverable}`
      )
      if (!publicError.recoverable && publicError.stage !== 'minimap-identity-model') {
        this._rejectAllFrames(
          new Error(`录像 CV Worker 错误 [${publicError.code}/${publicError.stage}]`)
        )
      }
    }
  }

  private _rejectReady(error: Error): void {
    if (this._readyTimer) clearTimeout(this._readyTimer)
    this._readyTimer = null
    const reject = this._readyReject
    this._readyResolve = null
    this._readyReject = null
    reject?.(error)
  }

  private _rejectAllFrames(error: Error): void {
    for (const pending of this._pendingFrames.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this._pendingFrames.clear()
  }
}

export function createReplayCvSessionFactory(
  context: LiveCoachMainContext
): ReplayCvSessionFactory {
  return async (options) => new ReplayCvWorkerExecutor(context).start(options)
}
