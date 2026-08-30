import {
  type CoachCue,
  type CoachReplayImportMetadata,
  type CoachReplaySidecarV1,
  type MinimapCalibration,
  type ReplayAnalysisRuntimeManifest,
  type ReplayCapabilityStatus,
  type ReplaySelectedFileGrant,
  coachReplayImportMetadataSchema,
  coachReplaySessionSchema,
  coachReplaySidecarV1Schema,
  getReplayCapabilityStatus,
  replaySelectedFileGrantSchema
} from '@shared/types/live-coach'
import { formatError } from '@shared/utils/errors'
import { app, dialog, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type {
  LocalFileGrantDescriptor,
  LocalFileGrantPurpose
} from '../akari-protocol/local-file-grants'
import { detectMinimapRoi } from '../minimap-observer/calibration-detection'
import {
  createChampionIdentityModelRoots,
  resolveChampionIdentityModelFromRoots
} from '../minimap-observer/champion-identity-model'
import { CURRENT_LIVE_COACH_PATCH } from './catalog/current'
import type { LiveCoachMainContext } from './context'
import { FactFusionEngine } from './fact-fusion'
import { resolveFfmpegRuntime } from './ffmpeg-runtime'
import {
  type ReplayCvSession,
  type ReplayCvSessionFactory,
  createReplayCvSessionFactory
} from './replay-cv-worker-executor'
import { CoachReplaySimulator, type ReplaySidecarData } from './replay-simulator'
import { CoachRuleEngine } from './rule-engine'

export interface ReplayImportProgress {
  taskId: string
  stage: 'probing' | 'extracting' | 'analyzing' | 'completed' | 'failed' | 'cancelled'
  progress: number // 0 - 100
  message: string
  messageCode?:
    | 'json-parsing'
    | 'json-completed'
    | 'video-probing'
    | 'video-extracting'
    | 'video-analyzing'
    | 'video-completed'
    | 'task-failed'
    | 'task-cancelled'
  details?: Record<string, string | number>
}

export interface ReplayVideoProbeResult {
  durationSeconds: number
  width: number
  height: number
  fps: number
  codec: string
}

export interface ReplayVideoPreparation {
  videoPath: string
  fileName: string
  fileSizeBytes: number
  sidecarPath: string | null
  probe: ReplayVideoProbeResult
  calibration: MinimapCalibration
  metadata: CoachReplayImportMetadata
  capabilityStatus: ReplayCapabilityStatus
  hasExplicitSidecarGameTime: boolean
  imageDataUrl: string
  expiresAt: number
  artifactSha256: string
  sidecarSha256: string | null
}

export interface ReplayAnalysisIdentity {
  artifactSha256: string
  sidecarSha256: string | null
  metadata: CoachReplayImportMetadata
  manifest: ReplayAnalysisRuntimeManifest
}

export interface ReplayFileGrantService {
  issueLocalFileGrant(
    filePath: string,
    purpose: LocalFileGrantPurpose
  ): Promise<LocalFileGrantDescriptor>
  resolveLocalFileGrant(
    token: string,
    allowedPurposes: readonly LocalFileGrantPurpose[]
  ): Promise<{
    descriptor: LocalFileGrantDescriptor
    filePath: string
  }>
  revokeLocalFileGrant(token: string): boolean
}

export interface ResolvedReplayFileGrant extends ReplaySelectedFileGrant {
  filePath: string
}

const MAX_REPLAY_JSON_BYTES = 64 * 1024 * 1024
const MAX_REPLAY_SIDECAR_BYTES = 8 * 1024 * 1024
const MAX_REPLAY_CALIBRATION_FRAME_WIDTH = 1280
const MAX_REPLAY_CALIBRATION_FRAME_HEIGHT = 720
const MAX_REPLAY_PREVIEW_WIDTH = 640
const MAX_REPLAY_PREVIEW_HEIGHT = 360
const DEFAULT_REPLAY_MINIMAP_HEIGHT_RATIO = 0.28

export interface ReplayCalibrationFrameSize {
  width: number
  height: number
}

interface ReplayCalibrationFrame extends ReplayCalibrationFrameSize {
  pixels: Uint8Array
}

export function calculateReplayCalibrationFrameSize(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth = MAX_REPLAY_CALIBRATION_FRAME_WIDTH,
  maxHeight = MAX_REPLAY_CALIBRATION_FRAME_HEIGHT
): ReplayCalibrationFrameSize {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    !Number.isFinite(maxWidth) ||
    !Number.isFinite(maxHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    maxWidth <= 0 ||
    maxHeight <= 0
  ) {
    throw new Error('录像标定帧尺寸必须为正数')
  }

  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  }
}

export function createReplayFallbackRoi(
  sourceWidth: number,
  sourceHeight: number,
  side: 'left' | 'right'
): MinimapCalibration['roi'] {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error('录像源尺寸必须为正数')
  }

  const edge = Math.min(sourceWidth, sourceHeight * DEFAULT_REPLAY_MINIMAP_HEIGHT_RATIO)
  const width = edge / sourceWidth
  const height = edge / sourceHeight
  return {
    x: side === 'left' ? 0 : 1 - width,
    y: 1 - height,
    width,
    height
  }
}

export function discoverReplaySidecarPath(videoPath: string): string | null {
  const extension = path.extname(videoPath)
  const withoutExtension = videoPath.slice(0, Math.max(0, videoPath.length - extension.length))
  const candidates = [`${videoPath}.sidecar.json`, `${withoutExtension}.sidecar.json`]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

export class ReplayImportController {
  private _activeProcess: any = null
  private _isBusy = false
  private _isCancelled = false
  private readonly _simulator = new CoachReplaySimulator()
  private _activeReplayCvSession: ReplayCvSession | null = null
  private _activeTaskId: string | null = null
  private _activeOperation: Promise<unknown> | null = null
  private readonly _issuedFileGrantTokens = new Set<string>()
  private readonly _analysisFileGrantTokens = new Map<string, Set<string>>()

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _replayCvSessionFactory: ReplayCvSessionFactory = createReplayCvSessionFactory(
      _context
    ),
    private readonly _fileGrants?: ReplayFileGrantService
  ) {}

  public get activeTaskId(): string | null {
    return this._activeTaskId
  }

  /**
   * 打开系统文件选择对话框
   */
  public async selectReplayFile(): Promise<ReplaySelectedFileGrant | null> {
    const result = await dialog.showOpenDialog({
      title: '选择对局录像或战术回放文件',
      filters: [
        { name: '支持的回放文件', extensions: ['json', 'mp4', 'mkv', 'webm'] },
        { name: 'JSON 会话回放', extensions: ['json'] },
        { name: '视频录像', extensions: ['mp4', 'mkv', 'webm'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const filePath = result.filePaths[0]
    const extension = path.extname(filePath).toLowerCase()
    const kind = extension === '.json' ? 'json' : 'video'
    if (kind === 'video' && !['.mp4', '.mkv', '.webm'].includes(extension)) {
      throw new Error('仅支持 JSON、MP4、MKV 和 WebM 回放文件')
    }
    return await this._issueReplayFileGrant(filePath, kind)
  }

  public async selectReplaySidecarFile(): Promise<ReplaySelectedFileGrant | null> {
    const result = await dialog.showOpenDialog({
      title: '选择与录像匹配的 Sidecar JSON',
      filters: [{ name: 'Coach Replay Sidecar', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    if (path.extname(result.filePaths[0]).toLowerCase() !== '.json') {
      throw new Error('Sidecar 必须是 JSON 文件')
    }
    return await this._issueReplayFileGrant(result.filePaths[0], 'sidecar')
  }

  public async grantReplaySidecarFile(filePath: string): Promise<ReplaySelectedFileGrant> {
    return await this._issueReplayFileGrant(filePath, 'sidecar')
  }

  public async resolveReplayFileGrant(
    token: string,
    allowedKinds: readonly ReplaySelectedFileGrant['purpose'][]
  ): Promise<ResolvedReplayFileGrant> {
    if (!this._issuedFileGrantTokens.has(token)) throw new Error('所选文件授权已失效，请重新选择')
    const service = this._requireFileGrantService()
    const purposes = allowedKinds.map(replayKindToGrantPurpose)
    const resolved = await service.resolveLocalFileGrant(token, purposes)
    const kind = grantPurposeToReplayKind(resolved.descriptor.purpose)
    return {
      ...replaySelectedFileGrantSchema.parse({
        token: resolved.descriptor.token,
        displayName: resolved.descriptor.displayName,
        purpose: kind,
        expiresAt: resolved.descriptor.expiresAt
      }),
      filePath: resolved.filePath
    }
  }

  public associateReplayFileGrants(analysisId: string, tokens: readonly string[]): void {
    const associated = this._analysisFileGrantTokens.get(analysisId) ?? new Set<string>()
    for (const token of tokens) {
      if (this._issuedFileGrantTokens.has(token)) associated.add(token)
    }
    if (associated.size) this._analysisFileGrantTokens.set(analysisId, associated)
  }

  public revokeReplayFileGrants(tokens: readonly string[]): number {
    const service = this._fileGrants
    let revoked = 0
    for (const token of new Set(tokens)) {
      if (!this._issuedFileGrantTokens.delete(token)) continue
      if (service?.revokeLocalFileGrant(token)) revoked++
      for (const [analysisId, associated] of this._analysisFileGrantTokens) {
        associated.delete(token)
        if (!associated.size) this._analysisFileGrantTokens.delete(analysisId)
      }
    }
    return revoked
  }

  public revokeAnalysisFileGrants(analysisId: string): number {
    const tokens = this._analysisFileGrantTokens.get(analysisId)
    return tokens ? this.revokeReplayFileGrants([...tokens]) : 0
  }

  public revokeUnassociatedReplayFileGrants(): number {
    const associated = new Set(
      [...this._analysisFileGrantTokens.values()].flatMap((tokens) => [...tokens])
    )
    return this.revokeReplayFileGrants(
      [...this._issuedFileGrantTokens].filter((token) => !associated.has(token))
    )
  }

  public revokeAllReplayFileGrants(): number {
    const revoked = this.revokeReplayFileGrants([...this._issuedFileGrantTokens])
    this._analysisFileGrantTokens.clear()
    return revoked
  }

  /**
   * 检测系统中是否有可用的 ffmpeg / ffprobe
   */
  public async checkFfmpegAvailable(): Promise<{ available: boolean; error?: string }> {
    let runtime
    try {
      runtime = resolveFfmpegRuntime()
    } catch (error) {
      return { available: false, error: formatError(error) }
    }

    return new Promise((resolve) => {
      const p = spawn(runtime.ffmpeg, ['-version'], {
        cwd: runtime.directory,
        windowsHide: true
      })
      this._activeProcess = p
      p.on('error', (err) => {
        if (this._activeProcess === p) this._activeProcess = null
        resolve({
          available: false,
          error: `系统未检测到可用 FFmpeg: ${err.message}`
        })
      })
      p.on('close', (code) => {
        if (this._activeProcess === p) this._activeProcess = null
        if (code === 0) {
          resolve({ available: true })
        } else {
          resolve({ available: false, error: `FFmpeg 退出码异常: ${code}` })
        }
      })
    })
  }

  /**
   * 使用 ffprobe 获取视频时长与规格
   */
  public async probeVideo(videoPath: string): Promise<ReplayVideoProbeResult> {
    const runtime = resolveFfmpegRuntime()
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,r_frame_rate,codec_name:format=duration',
        '-of',
        'json',
        videoPath
      ]
      const p = spawn(runtime.ffprobe, args, {
        cwd: runtime.directory,
        windowsHide: true
      })
      this._activeProcess = p
      let stdout = ''
      let stderr = ''

      p.stdout.on('data', (d) => {
        stdout += d.toString()
      })
      p.stderr.on('data', (d) => {
        stderr += d.toString()
      })
      p.on('error', (err) => {
        if (this._activeProcess === p) this._activeProcess = null
        reject(new Error(`无法启动 ffprobe: ${err.message}`))
      })
      p.on('close', (code) => {
        if (this._activeProcess === p) this._activeProcess = null
        if (code !== 0) {
          return reject(new Error(`ffprobe 解析失败 (${code}): ${stderr}`))
        }
        try {
          const parsed = JSON.parse(stdout)
          const stream = parsed.streams?.[0]
          if (!stream) {
            return reject(new Error('ffprobe 未发现可用的视频轨道'))
          }
          const duration = parseFloat(parsed.format?.duration || '0')
          const [num, den] = String(stream.r_frame_rate || '').split('/')
          const numerator = parseFloat(num)
          const denominator = parseFloat(den)
          const fps = numerator / denominator

          resolve({
            durationSeconds: duration,
            width: Number(stream.width),
            height: Number(stream.height),
            fps,
            codec: typeof stream.codec_name === 'string' ? stream.codec_name : 'unknown'
          })
        } catch (err) {
          reject(new Error(`解析 ffprobe 输出失败: ${formatError(err)}`))
        }
      })
    })
  }

  public async prepareVideoReplay(
    videoPath: string,
    sidecarPath?: string,
    taskId: string = randomUUID()
  ): Promise<ReplayVideoPreparation> {
    return this._runExclusive(() => this._prepareVideoReplay(videoPath, sidecarPath), taskId)
  }

  private async _prepareVideoReplay(
    videoPath: string,
    sidecarPath?: string
  ): Promise<ReplayVideoPreparation> {
    this._validateVideoFile(videoPath)
    const status = await this.checkFfmpegAvailable()
    this._throwIfCancelled()
    if (!status.available) throw new Error(`未能执行视频解码: ${status.error}`)

    const probe = await this.probeVideo(videoPath)
    this._throwIfCancelled()
    this._validateVideoProbe(probe)
    const artifactSha256 = await this._hashFile(videoPath)
    const loadedSidecar = await this._loadAndVerifySidecar(videoPath, sidecarPath, artifactSha256)
    const sidecarSha256 = loadedSidecar.path ? await this._hashFile(loadedSidecar.path) : null
    this._throwIfCancelled()
    const calibrationFrame = await this._extractCalibrationFrame(videoPath, probe)
    this._throwIfCancelled()
    const detected = detectMinimapRoi(
      calibrationFrame.pixels,
      calibrationFrame.width,
      calibrationFrame.height
    )
    const fallbackSide =
      this._context.settings.minimapSide === 'left' ? ('left' as const) : ('right' as const)
    const fallbackRoi = createReplayFallbackRoi(probe.width, probe.height, fallbackSide)
    const calibration: MinimapCalibration = loadedSidecar.data?.calibration ?? {
      schemaVersion: 1,
      id: `replay_calibration_${Date.now()}`,
      fingerprintHash: `replay_${probe.width}x${probe.height}`,
      roi: detected?.roi ?? fallbackRoi,
      transform: 'blue-normal',
      source: 'automatic',
      confidence: detected?.confidence ?? 0,
      createdAt: Date.now()
    }
    const metadata = this._resolveReplayMetadata(loadedSidecar.data, undefined, calibration.roi)

    const calibrationImage = nativeImage.createFromBitmap(Buffer.from(calibrationFrame.pixels), {
      width: calibrationFrame.width,
      height: calibrationFrame.height,
      scaleFactor: 1
    })
    const previewSize = calculateReplayCalibrationFrameSize(
      calibrationFrame.width,
      calibrationFrame.height,
      MAX_REPLAY_PREVIEW_WIDTH,
      MAX_REPLAY_PREVIEW_HEIGHT
    )
    const previewImage =
      previewSize.width === calibrationFrame.width && previewSize.height === calibrationFrame.height
        ? calibrationImage
        : calibrationImage.resize({ ...previewSize, quality: 'good' })
    const jpeg = previewImage.toJPEG(70)
    if (jpeg.byteLength > 512 * 1024) throw new Error('录像标定预览超过 512 KiB 安全上限')

    return {
      videoPath,
      fileName: path.basename(videoPath),
      fileSizeBytes: fs.statSync(videoPath).size,
      sidecarPath: loadedSidecar.path,
      probe,
      calibration,
      metadata,
      capabilityStatus: getReplayCapabilityStatus(
        metadata,
        Boolean(loadedSidecar.data),
        loadedSidecar.data?.events.some((event) => event.gameTimeSeconds !== null) ?? false
      ),
      hasExplicitSidecarGameTime:
        loadedSidecar.data?.events.some((event) => event.gameTimeSeconds !== null) ?? false,
      imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      expiresAt: Date.now() + 30_000,
      artifactSha256,
      sidecarSha256
    }
  }

  /**
   * Creates a privacy-safe identity for duplicate analysis detection. Source paths are used only
   * for this call and are never included in the returned descriptor.
   */
  public async createAnalysisIdentity(
    sourcePath: string,
    sidecarPath?: string,
    metadata?: CoachReplayImportMetadata,
    roi?: MinimapCalibration['roi'],
    taskId: string = randomUUID()
  ): Promise<ReplayAnalysisIdentity> {
    return this._runExclusive(
      () => this._createAnalysisIdentity(sourcePath, sidecarPath, metadata, roi),
      taskId
    )
  }

  private async _createAnalysisIdentity(
    sourcePath: string,
    sidecarPath?: string,
    metadata?: CoachReplayImportMetadata,
    roi?: MinimapCalibration['roi']
  ): Promise<ReplayAnalysisIdentity> {
    const isJson = sourcePath.toLowerCase().endsWith('.json')
    let resolvedMetadata: CoachReplayImportMetadata
    if (isJson) {
      this._validateReplayJsonFile(sourcePath)
      const session = coachReplaySessionSchema.parse(
        JSON.parse(await fs.promises.readFile(sourcePath, 'utf-8'))
      )
      resolvedMetadata = {
        patch: session.metadata.patch,
        mapId: session.metadata.mapId,
        queueId: session.metadata.queueId,
        selfTeam: null,
        selfChampionId: null,
        minimapSide: null,
        videoGameStartMs: null,
        roster: null
      }
    } else {
      this._validateVideoFile(sourcePath)
      resolvedMetadata = metadata ?? this._resolveReplayMetadata(null, undefined, roi)
    }

    const artifactSha256 = await this._hashFile(sourcePath)
    let resolvedSidecarPath: string | null = null
    if (!isJson) {
      const loadedSidecar = await this._loadAndVerifySidecar(
        sourcePath,
        sidecarPath,
        artifactSha256
      )
      resolvedSidecarPath = loadedSidecar.path
      resolvedMetadata = this._resolveReplayMetadata(loadedSidecar.data, metadata, roi)
    }
    const sidecarSha256 = resolvedSidecarPath ? await this._hashFile(resolvedSidecarPath) : null
    const patch = resolvedMetadata.patch ?? 'unknown'
    const identityDescriptor = resolvedMetadata.roster?.length
      ? resolveChampionIdentityModelFromRoots(
          patch,
          createChampionIdentityModelRoots(
            app?.getAppPath?.() ?? process.cwd(),
            process.resourcesPath ?? process.cwd()
          )
        )
      : null

    return {
      artifactSha256,
      sidecarSha256,
      metadata: resolvedMetadata,
      manifest: {
        pipelineVersion: 'replay-analysis-v1',
        ruleCatalogVersion: CURRENT_LIVE_COACH_PATCH,
        ffmpegVersion: null,
        runtimeVersion: app.getVersion(),
        models: identityDescriptor
          ? {
              'champion-identity': {
                version: identityDescriptor.version,
                sha256: identityDescriptor.sha256
              }
            }
          : {}
      }
    }
  }

  private async _extractCalibrationFrame(
    videoPath: string,
    probe: ReplayVideoProbeResult
  ): Promise<ReplayCalibrationFrame> {
    const runtime = resolveFfmpegRuntime()
    const frameSize = calculateReplayCalibrationFrameSize(probe.width, probe.height)
    const sampleTime = Math.max(
      0,
      Math.min(Math.max(10, probe.durationSeconds * 0.25), Math.max(0, probe.durationSeconds - 0.5))
    )
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-ss',
        sampleTime.toFixed(3),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        `scale=${frameSize.width}:${frameSize.height}`,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'bgra',
        'pipe:1'
      ]
      const child = spawn(runtime.ffmpeg, args, {
        cwd: runtime.directory,
        windowsHide: true
      })
      this._activeProcess = child
      const chunks: Buffer[] = []
      let stderr = ''
      child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => reject(new Error(`无法提取录像标定帧: ${error.message}`)))
      child.on('close', (code) => {
        this._activeProcess = null
        if (code !== 0) return reject(new Error(`录像标定帧提取失败 (${code}): ${stderr}`))
        const frame = Buffer.concat(chunks)
        const expectedBytes = frameSize.width * frameSize.height * 4
        if (frame.byteLength !== expectedBytes) {
          return reject(
            new Error(
              `录像标定帧尺寸异常: 预期 ${expectedBytes} 字节，实际 ${frame.byteLength} 字节`
            )
          )
        }
        resolve({ pixels: new Uint8Array(frame), ...frameSize })
      })
    })
  }

  private async _loadAndVerifySidecar(
    videoPath: string,
    requestedPath?: string,
    knownArtifactSha256?: string
  ): Promise<{ path: string | null; data: CoachReplaySidecarV1 | null }> {
    const resolvedPath = requestedPath ?? discoverReplaySidecarPath(videoPath)
    if (!resolvedPath) return { path: null, data: null }
    if (!fs.existsSync(resolvedPath)) throw new Error(`指定的 Sidecar 文件不存在: ${resolvedPath}`)
    const sidecarStat = fs.statSync(resolvedPath)
    if (!sidecarStat.isFile() || sidecarStat.size <= 0) {
      throw new Error('Sidecar 文件为空或不是普通文件')
    }
    if (sidecarStat.size > MAX_REPLAY_SIDECAR_BYTES) {
      throw new Error('Sidecar 文件超过 8 MiB 安全读取上限')
    }

    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'))
    } catch (error) {
      throw new Error(`Sidecar JSON 解析失败: ${formatError(error)}`)
    }
    const parsed = coachReplaySidecarV1Schema.safeParse(raw)
    if (!parsed.success) throw new Error(`Sidecar 契约校验失败: ${parsed.error.message}`)

    const artifactSha256 = knownArtifactSha256 ?? (await this._hashFile(videoPath))
    if (parsed.data.artifactSha256.toLowerCase() !== artifactSha256) {
      throw new Error('Sidecar artifactSha256 与所选录像不匹配，已拒绝导入')
    }
    return { path: resolvedPath, data: parsed.data }
  }

  private _hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this._isCancelled) {
        reject(new Error('任务已被用户取消'))
        return
      }
      const hash = createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('data', (chunk) => {
        if (this._isCancelled) {
          stream.destroy(new Error('任务已被用户取消'))
          return
        }
        hash.update(chunk)
      })
      stream.on('error', reject)
      stream.on('end', () => resolve(hash.digest('hex')))
    })
  }

  /**
   * 取消当前正在执行的录像导入任务并清理临时文件
   */
  public async cancelImport(
    taskId?: string
  ): Promise<{ cancelled: boolean; taskId: string | null }> {
    const activeTaskId = this._activeTaskId
    if (!activeTaskId || (taskId && taskId !== activeTaskId)) {
      return { cancelled: false, taskId: activeTaskId }
    }
    this._isCancelled = true
    this._activeReplayCvSession?.stop('user-cancelled')
    this._activeReplayCvSession = null
    if (this._activeProcess) {
      try {
        this._activeProcess.kill('SIGKILL')
      } catch {
        // ignore
      }
      this._activeProcess = null
    }
    const activeOperation = this._activeOperation
    if (activeOperation) {
      await activeOperation.catch(() => undefined)
    }
    return { cancelled: true, taskId: activeTaskId }
  }

  public async dispose(): Promise<void> {
    await this.cancelImport()
    this.revokeAllReplayFileGrants()
  }

  private async _issueReplayFileGrant(
    filePath: string,
    kind: ReplaySelectedFileGrant['purpose']
  ): Promise<ReplaySelectedFileGrant> {
    const descriptor = await this._requireFileGrantService().issueLocalFileGrant(
      filePath,
      replayKindToGrantPurpose(kind)
    )
    this._issuedFileGrantTokens.add(descriptor.token)
    return replaySelectedFileGrantSchema.parse({
      token: descriptor.token,
      displayName: descriptor.displayName,
      purpose: kind,
      expiresAt: descriptor.expiresAt
    })
  }

  private _requireFileGrantService(): ReplayFileGrantService {
    if (!this._fileGrants) throw new Error('本机文件授权服务不可用')
    return this._fileGrants
  }

  private _sendProgress(progress: Omit<ReplayImportProgress, 'taskId'>): void {
    this._context.ipc.sendEvent(this._context.namespace, 'replay-import-progress', {
      ...progress,
      taskId: this._activeTaskId ?? randomUUID()
    })
  }

  /**
   * 真实执行录像导入分析管线（含抽帧像素读取、CV 连通域追踪、事实融合与规则引擎推断）
   */
  public async importVideoReplay(
    videoPath: string,
    sidecarPath?: string,
    replayRoi?: MinimapCalibration['roi'],
    replayMetadata?: CoachReplayImportMetadata,
    taskId: string = randomUUID()
  ): Promise<{ session: any; sidecar: ReplaySidecarData; markdown: string; cues: CoachCue[] }> {
    return this._runExclusive(
      () => this._importVideoReplay(videoPath, sidecarPath, replayRoi, replayMetadata),
      taskId
    )
  }

  private async _importVideoReplay(
    videoPath: string,
    sidecarPath?: string,
    replayRoi?: MinimapCalibration['roi'],
    replayMetadata?: CoachReplayImportMetadata
  ): Promise<{ session: any; sidecar: ReplaySidecarData; markdown: string; cues: CoachCue[] }> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`录像文件不存在: ${videoPath}`)
    }

    // 1. 若为 JSON 回放文件，直接由 ReplaySimulator 进行事件重放
    if (videoPath.toLowerCase().endsWith('.json')) {
      this._sendProgress({
        stage: 'probing',
        progress: 20,
        message: '正在解析 JSON 会话回放数据...',
        messageCode: 'json-parsing'
      })
      this._validateReplayJsonFile(videoPath)
      const content = await fs.promises.readFile(videoPath, 'utf-8')
      this._throwIfCancelled()
      const session = coachReplaySessionSchema.parse(JSON.parse(content))
      const artifactSha256 = await this._hashFile(videoPath)
      this._throwIfCancelled()
      const simResult = this._simulator.simulateSynchronous(session)
      const sidecar = this._simulator.generateSidecar(session, simResult.cues)
      const markdown = this._simulator.generateMarkdownReport(sidecar)
      this._sendProgress({
        stage: 'completed',
        progress: 100,
        message: 'JSON 回放解析完成',
        messageCode: 'json-completed'
      })
      return {
        session: { ...session, artifactSha256, analyzedAt: Date.now() },
        sidecar,
        markdown,
        cues: simResult.cues
      }
    }

    // 2. 视频文件：检查 FFmpeg 工具可用性
    this._validateVideoFile(videoPath)
    const ffmpegStatus = await this.checkFfmpegAvailable()
    this._throwIfCancelled()
    if (!ffmpegStatus.available) {
      throw new Error(
        `未能执行视频解码: ${ffmpegStatus.error || '未安装 FFmpeg'}。请导入 .json 会话文件或安装 FFmpeg 后重试。`
      )
    }

    // 3. 视频元数据与 Sidecar 在抽帧前完成探测/校验，避免分析结束后才发现上下文无效
    this._sendProgress({
      stage: 'probing',
      progress: 10,
      message: '正在探测视频编码与规格...',
      messageCode: 'video-probing'
    })
    const probe = await this.probeVideo(videoPath)
    this._throwIfCancelled()
    this._validateVideoProbe(probe)
    const loadedSidecar = await this._loadAndVerifySidecar(videoPath, sidecarPath)
    this._throwIfCancelled()
    const metadata = this._resolveReplayMetadata(loadedSidecar.data, replayMetadata, replayRoi)
    const capabilityStatus = getReplayCapabilityStatus(
      metadata,
      Boolean(loadedSidecar.data),
      loadedSidecar.data?.events.some((event) => event.gameTimeSeconds !== null) ?? false
    )
    if (this._isCancelled) throw new Error('任务已被用户取消')

    let roi = replayRoi ?? loadedSidecar.data?.calibration?.roi ?? null
    if (!roi) {
      const calibrationFrame = await this._extractCalibrationFrame(videoPath, probe)
      roi =
        detectMinimapRoi(calibrationFrame.pixels, calibrationFrame.width, calibrationFrame.height)
          ?.roi ?? null
    }
    if (!roi || !this._isValidRoi(roi)) {
      throw new Error('录像小地图自动标定失败，请在录像预览中手动框选小地图后再开始分析')
    }

    try {
      this._sendProgress({
        stage: 'extracting',
        progress: 30,
        message: `正在以 5 FPS 流式提取小地图像素 (${probe.width}x${probe.height}, 时长 ${Math.round(probe.durationSeconds)} 秒)...`,
        messageCode: 'video-extracting',
        details: {
          width: probe.width,
          height: probe.height,
          duration: Math.round(probe.durationSeconds)
        }
      })

      const frameWidth = 250
      const frameHeight = 250
      const analysisFps = 5
      const frameBytes = frameWidth * frameHeight * 4
      if (this._isCancelled) {
        throw new Error('任务已被用户取消')
      }

      const fusion = new FactFusionEngine()
      const ruleEngine = new CoachRuleEngine()

      const allCues: CoachCue[] = []
      const patch = metadata.patch ?? 'unknown'
      const artifactSha256 =
        loadedSidecar.data?.artifactSha256.toLowerCase() ?? (await this._hashFile(videoPath))
      const sessionId = `replay_${artifactSha256.slice(0, 16)}`
      const startTimestamp =
        1_700_000_000_000 + (parseInt(artifactSha256.slice(0, 8), 16) % 1_000_000)

      const enabledCapabilities = new Set(['coach.analyze.minimap-basic'])
      if (metadata.mapId === 11 && metadata.selfTeam) {
        enabledCapabilities.add('coach.analyze.minimap-advanced')
        if (patch === CURRENT_LIVE_COACH_PATCH) {
          enabledCapabilities.add('coach.analyze.fog-inference')
        }
      }

      const identityDescriptor = metadata.roster?.length
        ? resolveChampionIdentityModelFromRoots(
            patch,
            createChampionIdentityModelRoots(
              app?.getAppPath?.() ?? process.cwd(),
              process.resourcesPath ?? process.cwd()
            )
          )
        : null
      const roster = metadata.roster ?? []
      const selfTeam = metadata.selfTeam
      const allyChampionCandidates = selfTeam
        ? roster.filter((member) => member.team === selfTeam).map((member) => member.championId)
        : []
      const enemyChampionCandidates = selfTeam
        ? roster.filter((member) => member.team !== selfTeam).map((member) => member.championId)
        : []
      const championCandidates = Array.from(
        new Set(roster.map((member) => member.championId).filter((id) => id > 0))
      )

      const replayCvSession = await this._replayCvSessionFactory({
        sessionId,
        patch,
        identityModel: identityDescriptor,
        championCandidates,
        allyChampionCandidates,
        enemyChampionCandidates,
        selfChampionId: metadata.selfChampionId
      })
      this._activeReplayCvSession = replayCvSession
      const identityModelReady = Boolean(replayCvSession.runtimeVersions['champion-icon-onnx'])
      if (identityModelReady) {
        enabledCapabilities.add('coach.analyze.minimap-identity')
        capabilityStatus.available = capabilityStatus.available.map((capability) =>
          capability === 'champion-identity-candidate'
            ? 'champion-identity'
            : capability === 'approaching-player-candidate'
              ? 'approaching-player'
              : capability
        )
      } else if (capabilityStatus.available.includes('champion-identity-candidate')) {
        capabilityStatus.available = capabilityStatus.available.filter(
          (capability) =>
            capability !== 'champion-identity-candidate' &&
            capability !== 'approaching-player-candidate'
        )
        capabilityStatus.disabled.push({
          capability: 'champion-identity',
          reason: 'validated-model-unavailable-for-patch'
        })
      }

      let frameCount = 0
      const expectedFrameCount = Math.max(1, Math.ceil(probe.durationSeconds * analysisFps))

      const processFrame = async (frameBuffer: Uint8Array) => {
        const frameObservedAt = startTimestamp + Math.round((frameCount * 1000) / analysisFps)
        const batch = await replayCvSession.processFrame({
          buffer: frameBuffer,
          width: frameWidth,
          height: frameHeight,
          observedAt: frameObservedAt,
          sequence: frameCount + 1,
          pixelFormat: 'rgba'
        })

        const videoTimeMs = Math.round((frameCount * 1000) / analysisFps)
        const sidecarEvents = (loadedSidecar.data?.events ?? [])
          .filter(
            (event) =>
              event.videoTimeMs <= videoTimeMs &&
              (event.gameTimeSeconds !== null || metadata.videoGameStartMs !== null)
          )
          .map((event, index) => ({
            eventId: index + 1,
            eventTime:
              event.gameTimeSeconds ??
              Math.max(0, (event.videoTimeMs - (metadata.videoGameStartMs ?? 0)) / 1000),
            eventName: event.kind,
            payload:
              event.payload && typeof event.payload === 'object'
                ? (event.payload as Record<string, unknown>)
                : { value: event.payload }
          }))
        if (loadedSidecar.data) {
          fusion.updateLiveGameSnapshot(
            {
              sessionId,
              patch,
              gameTimeSeconds: Math.max(0, (videoTimeMs - (metadata.videoGameStartMs ?? 0)) / 1000),
              activePlayer: null,
              players: [],
              events: sidecarEvents,
              sourceHealth: [
                {
                  domain: 'events',
                  state: 'healthy',
                  lastSuccessAt: frameObservedAt,
                  lastErrorCode: null,
                  consecutiveFailures: 0
                }
              ],
              clock: {
                observedAt: frameObservedAt,
                receivedAt: frameObservedAt,
                sequence: frameCount + 1
              }
            },
            frameObservedAt
          )
        }

        fusion.updateMinimapBatch(batch, frameObservedAt)

        const frameCues = ruleEngine.evaluate({
          sessionId,
          patch,
          queueId: metadata.queueId,
          fusion,
          currentTime: frameObservedAt,
          enabledCategories: {
            warning: true,
            opportunity: true,
            suggestion: true,
            information: true,
            resource: true,
            system: true,
            review: true
          },
          enabledCapabilities
        })
        allCues.push(...frameCues)
        frameCount++
        if (frameCount % Math.max(1, analysisFps * 2) === 0) {
          const pct = Math.min(95, Math.round(30 + (frameCount / expectedFrameCount) * 65))
          this._sendProgress({
            stage: 'analyzing',
            progress: pct,
            message: `正在流式分析视频帧 (${frameCount}/${expectedFrameCount})...`,
            messageCode: 'video-analyzing',
            details: { current: frameCount, total: expectedFrameCount }
          })
        }
      }

      const cropFilter = `crop=iw*${roi.width}:ih*${roi.height}:iw*${roi.x}:ih*${roi.y},fps=${analysisFps},scale=${frameWidth}:${frameHeight}`
      const runtime = resolveFfmpegRuntime()
      const decoder = spawn(
        runtime.ffmpeg,
        [
          '-v',
          'error',
          '-i',
          videoPath,
          '-an',
          '-sn',
          '-vf',
          cropFilter,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgba',
          'pipe:1'
        ],
        { cwd: runtime.directory, windowsHide: true }
      )
      this._activeProcess = decoder
      let stderr = ''
      decoder.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-8000)
      })
      const decoderExit = new Promise<{ code: number | null; errorMessage?: string }>((resolve) => {
        decoder.once('error', (error) => {
          resolve({ code: null, errorMessage: error.message })
        })
        decoder.once('close', (code) => resolve({ code }))
      })

      let pending = Buffer.alloc(0)
      for await (const chunk of decoder.stdout) {
        if (this._isCancelled) {
          decoder.kill('SIGKILL')
          break
        }
        pending = pending.length ? Buffer.concat([pending, Buffer.from(chunk)]) : Buffer.from(chunk)
        while (pending.length >= frameBytes) {
          const frame = pending.subarray(0, frameBytes)
          pending = pending.subarray(frameBytes)
          await processFrame(new Uint8Array(frame))
          if (this._isCancelled) break
        }
      }
      const decoderResult = await decoderExit
      this._activeProcess = null
      if (this._isCancelled) throw new Error('任务已被用户取消')
      if (decoderResult.errorMessage) {
        throw new Error(`FFmpeg 抽帧启动失败: ${decoderResult.errorMessage}`)
      }
      if (decoderResult.code !== 0) {
        throw new Error(`FFmpeg 流式解码异常退出 (${decoderResult.code}): ${stderr}`)
      }
      if (pending.length !== 0) throw new Error('FFmpeg 输出了不完整的原始视频帧')
      if (frameCount === 0) {
        throw new Error('录像解码未生成任何可分析画面，请检查文件是否损坏或视频轨道是否受支持')
      }

      // 构建标准 ReplaySidecarData 契约结构（与 Reviews.vue 完全统一）
      const sidecar: ReplaySidecarData = {
        version: '1.0.0',
        sessionId,
        gameDurationSeconds: probe.durationSeconds,
        patch,
        totalCues: allCues.length,
        timeline: allCues.map((cue) => {
          const videoTimeSeconds = (cue.createdAt - startTimestamp) / 1000
          const gameTime = Math.max(
            0,
            Math.round(videoTimeSeconds - (metadata.videoGameStartMs ?? 0) / 1000)
          )
          const mm = Math.floor(gameTime / 60)
          const ss = String(gameTime % 60).padStart(2, '0')
          return {
            timestampMs: cue.createdAt,
            gameTimeFormatted: `${mm}:${ss}`,
            category: cue.category,
            observation: cue.observationText,
            spokenText: cue.spokenText,
            options: cue.options.map((o) => o.label),
            evidenceIds: cue.evidenceIds
          }
        }),
        evidencesSummary: {
          totalEvidences: fusion.getActiveEvidences(
            startTimestamp + Math.round((frameCount * 1000) / analysisFps)
          ).length
        }
      }

      const replaySession = {
        id: sessionId,
        videoPath,
        durationSeconds: probe.durationSeconds,
        frameCount,
        analysisFps,
        artifactSha256,
        metadata,
        capabilityStatus,
        analyzedAt: Date.now()
      }

      const markdown = this._simulator.generateMarkdownReport(sidecar)

      this._sendProgress({
        stage: 'completed',
        progress: 100,
        message: '视频录像分析完成',
        messageCode: 'video-completed'
      })

      return {
        session: replaySession,
        sidecar,
        markdown,
        cues: allCues
      }
    } finally {
      this._activeProcess = null
      this._activeReplayCvSession?.stop(this._isCancelled ? 'user-cancelled' : 'analysis-finished')
      this._activeReplayCvSession = null
    }
  }

  private _resolveReplayMetadata(
    sidecar: CoachReplaySidecarV1 | null,
    override?: CoachReplayImportMetadata,
    roi?: MinimapCalibration['roi'] | null
  ): CoachReplayImportMetadata {
    if (override) return coachReplayImportMetadataSchema.parse(override)

    const minimapSide = roi
      ? roi.x + roi.width / 2 < 0.5
        ? ('left' as const)
        : ('right' as const)
      : null
    return coachReplayImportMetadataSchema.parse({
      patch: sidecar?.patch ?? null,
      mapId: sidecar?.mapId ?? null,
      queueId: sidecar?.queueId ?? null,
      selfTeam: sidecar?.selfTeam ?? null,
      selfChampionId: sidecar?.selfChampionId ?? null,
      minimapSide,
      videoGameStartMs: sidecar?.videoGameStartMs ?? null,
      roster: sidecar?.roster ?? null
    })
  }

  private _isValidRoi(roi: MinimapCalibration['roi']): boolean {
    return (
      Number.isFinite(roi.x) &&
      Number.isFinite(roi.y) &&
      Number.isFinite(roi.width) &&
      Number.isFinite(roi.height) &&
      roi.x >= 0 &&
      roi.y >= 0 &&
      roi.width > 0 &&
      roi.height > 0 &&
      roi.x + roi.width <= 1.0001 &&
      roi.y + roi.height <= 1.0001
    )
  }

  private _validateVideoFile(videoPath: string): void {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`录像文件不存在: ${videoPath}`)
    }
    const extension = path.extname(videoPath).toLowerCase()
    if (!['.mp4', '.mkv', '.webm'].includes(extension)) {
      throw new Error(`不支持的录像格式: ${extension || '无扩展名'}，仅支持 MP4、MKV 和 WebM`)
    }
    const stat = fs.statSync(videoPath)
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error('录像文件为空或不是普通文件')
    }
    if (stat.size > 50 * 1024 * 1024 * 1024) {
      throw new Error('录像文件超过 50 GiB 的一期安全处理上限')
    }
  }

  private _validateReplayJsonFile(filePath: string): void {
    if (!fs.existsSync(filePath)) throw new Error(`录像文件不存在: ${filePath}`)
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error('JSON 回放文件为空或不是普通文件')
    }
    if (stat.size > MAX_REPLAY_JSON_BYTES) {
      throw new Error('JSON 回放文件超过 64 MiB 安全读取上限')
    }
  }

  private _throwIfCancelled(): void {
    if (this._isCancelled) throw new Error('任务已被用户取消')
  }

  private _validateVideoProbe(probe: ReplayVideoProbeResult): void {
    if (!Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0) {
      throw new Error('无法读取有效的录像时长，文件可能损坏或不包含视频轨道')
    }
    if (probe.durationSeconds > 4 * 60 * 60) {
      throw new Error('录像时长超过 4 小时的一期分析上限')
    }
    if (
      !Number.isInteger(probe.width) ||
      !Number.isInteger(probe.height) ||
      probe.width < 320 ||
      probe.height < 240 ||
      probe.width > 7680 ||
      probe.height > 4320
    ) {
      throw new Error(`不支持的录像分辨率: ${probe.width}×${probe.height}`)
    }
    if (!Number.isFinite(probe.fps) || probe.fps < 1 || probe.fps > 240) {
      throw new Error(`不支持的录像帧率: ${probe.fps}`)
    }
  }

  private async _runExclusive<T>(
    operation: () => Promise<T>,
    taskId: string = randomUUID()
  ): Promise<T> {
    if (this._isBusy) {
      throw new Error('已有录像导入或分析任务正在运行，请等待完成或先取消当前任务')
    }

    this._isBusy = true
    this._isCancelled = false
    this._activeTaskId = taskId
    const operationPromise = Promise.resolve().then(operation)
    this._activeOperation = operationPromise
    try {
      return await operationPromise
    } catch (error) {
      this._sendProgress({
        stage: this._isCancelled ? 'cancelled' : 'failed',
        progress: 100,
        message: this._isCancelled ? '任务已被用户取消' : '录像分析失败',
        messageCode: this._isCancelled ? 'task-cancelled' : 'task-failed'
      })
      throw error
    } finally {
      this._isBusy = false
      this._activeProcess = null
      if (this._activeOperation === operationPromise) this._activeOperation = null
      if (this._activeTaskId === taskId) this._activeTaskId = null
    }
  }
}

function replayKindToGrantPurpose(kind: ReplaySelectedFileGrant['purpose']): LocalFileGrantPurpose {
  switch (kind) {
    case 'video':
      return 'live-coach-replay-video'
    case 'json':
      return 'live-coach-replay-json'
    case 'sidecar':
      return 'live-coach-replay-sidecar'
  }
}

function grantPurposeToReplayKind(
  purpose: LocalFileGrantPurpose
): ReplaySelectedFileGrant['purpose'] {
  switch (purpose) {
    case 'live-coach-replay-video':
      return 'video'
    case 'live-coach-replay-json':
      return 'json'
    case 'live-coach-replay-sidecar':
      return 'sidecar'
  }
}
