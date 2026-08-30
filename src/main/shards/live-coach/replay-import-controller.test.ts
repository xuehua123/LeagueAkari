import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { detectMinimapRoi } from '../minimap-observer/calibration-detection'
import { resolveFfmpegRuntime } from './ffmpeg-runtime'
import type { ReplayCvSessionFactory } from './replay-cv-worker-executor'
import {
  ReplayImportController,
  calculateReplayCalibrationFrameSize,
  createReplayFallbackRoi,
  discoverReplaySidecarPath
} from './replay-import-controller'
import { CoachReplaySimulator } from './replay-simulator'

describe('ReplayImportController Real Pipeline & Edge Cases Test', () => {
  function createMockContext() {
    return {
      namespace: 'live-coach-main',
      ipc: {
        sendEvent: vi.fn()
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    } as any
  }

  const createDeterministicReplayCvSession: ReplayCvSessionFactory = async (options) => ({
    runtimeVersions: { ccl: 'test' },
    async processFrame(frame) {
      return {
        sessionId: options.sessionId,
        patch: options.patch,
        calibrationVersion: 'test',
        modelVersions: { ccl: 'test' },
        frame: {
          observedAt: frame.observedAt,
          receivedAt: frame.observedAt,
          sequence: frame.sequence,
          ageMs: 0
        },
        health: 'healthy',
        entities: [],
        events: []
      }
    },
    stop() {}
  })

  function createTexturedCorner(
    width: number,
    height: number,
    side: 'left' | 'right',
    edge: number
  ) {
    const pixels = new Uint8Array(width * height * 4)
    const startX = side === 'left' ? 0 : width - edge
    for (let y = height - edge; y < height; y++) {
      for (let x = startX; x < startX + edge; x++) {
        const index = (y * width + x) * 4
        const bright = (x + y) % 8 < 4 ? 230 : 25
        pixels[index] = bright
        pixels[index + 1] = 255 - bright
        pixels[index + 2] = (x * 3 + y * 5) % 255
        pixels[index + 3] = 255
      }
    }
    return pixels
  }

  const non16By9ReplaySizes = [
    ['1024x768 4:3', 1024, 768, 960, 720, 480, 360],
    ['1920x1200 16:10', 1920, 1200, 1152, 720, 576, 360],
    ['3440x1440 21:9', 3440, 1440, 1280, 536, 640, 268],
    ['5120x1440 32:9', 5120, 1440, 1280, 360, 640, 180]
  ] as const

  it.each(non16By9ReplaySizes)(
    'keeps the calibration and preview aspect ratio for %s',
    (
      _,
      sourceWidth,
      sourceHeight,
      calibrationWidth,
      calibrationHeight,
      previewWidth,
      previewHeight
    ) => {
      const calibrationSize = calculateReplayCalibrationFrameSize(sourceWidth, sourceHeight)
      expect(calibrationSize).toEqual({ width: calibrationWidth, height: calibrationHeight })

      const previewSize = calculateReplayCalibrationFrameSize(
        calibrationSize.width,
        calibrationSize.height,
        640,
        360
      )
      expect(previewSize).toEqual({ width: previewWidth, height: previewHeight })
      expect(
        Math.abs(previewSize.width / previewSize.height - sourceWidth / sourceHeight)
      ).toBeLessThan(0.003)
    }
  )

  it.each(non16By9ReplaySizes)(
    'maps an automatically detected normalized ROI back to a square source ROI for %s',
    (_, sourceWidth, sourceHeight) => {
      const calibrationSize = calculateReplayCalibrationFrameSize(sourceWidth, sourceHeight)
      const edge = Math.round(calibrationSize.height * 0.26)
      const pixels = createTexturedCorner(
        calibrationSize.width,
        calibrationSize.height,
        'right',
        edge
      )
      const detected = detectMinimapRoi(pixels, calibrationSize.width, calibrationSize.height)

      expect(detected?.side).toBe('right')
      expect(detected).not.toBeNull()
      const projectedWidth = (detected?.roi.width ?? 0) * sourceWidth
      const projectedHeight = (detected?.roi.height ?? 0) * sourceHeight
      expect(Math.abs(projectedWidth - projectedHeight)).toBeLessThanOrEqual(4)
      expect((detected?.roi.x ?? 0) + (detected?.roi.width ?? 0)).toBeCloseTo(1, 10)
      expect((detected?.roi.y ?? 0) + (detected?.roi.height ?? 0)).toBeCloseTo(1, 10)
    }
  )

  it.each(non16By9ReplaySizes)(
    'keeps the source-pixel fallback square for %s',
    (_, sourceWidth, sourceHeight) => {
      for (const side of ['left', 'right'] as const) {
        const roi = createReplayFallbackRoi(sourceWidth, sourceHeight, side)
        expect(roi.width * sourceWidth).toBeCloseTo(roi.height * sourceHeight, 8)
        expect(roi.y + roi.height).toBeCloseTo(1, 10)
        expect(side === 'left' ? roi.x : roi.x + roi.width).toBeCloseTo(side === 'left' ? 0 : 1, 10)
      }
    }
  )

  it('discovers only the two documented adjacent sidecar names', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-sidecar-discovery-'))
    const videoPath = path.join(directory, 'match.mp4')
    fs.writeFileSync(videoPath, 'video')
    try {
      expect(discoverReplaySidecarPath(videoPath)).toBeNull()

      const sidecarPath = `${videoPath}.sidecar.json`
      fs.writeFileSync(sidecarPath, '{}')
      expect(discoverReplaySidecarPath(videoPath)).toBe(sidecarPath)
    } finally {
      fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  it('validates sidecar schema and rejects an artifact hash mismatch before analysis', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-sidecar-validation-'))
    const videoPath = path.join(directory, 'match.mp4')
    const sidecarPath = path.join(directory, 'match.sidecar.json')
    fs.writeFileSync(videoPath, 'owned-replay-video')
    const baseSidecar = {
      schemaVersion: 1,
      artifactSha256: createHash('sha256').update('owned-replay-video').digest('hex'),
      source: 'league-akari-user-export',
      producerVersion: '1.5.1',
      exportedAt: '2026-08-27T00:00:00Z',
      patch: '16.17.1',
      mapId: 11,
      queueId: 420,
      selfTeam: 'blue',
      videoGameStartMs: 5_000,
      roster: [{ team: 'blue', championId: 266 }],
      events: []
    }
    fs.writeFileSync(sidecarPath, JSON.stringify(baseSidecar))

    const controller = new ReplayImportController(
      createMockContext(),
      createDeterministicReplayCvSession
    )
    try {
      await expect(
        (controller as any)._loadAndVerifySidecar(videoPath, sidecarPath)
      ).resolves.toEqual({ path: sidecarPath, data: baseSidecar })

      fs.writeFileSync(
        sidecarPath,
        JSON.stringify({ ...baseSidecar, artifactSha256: '0'.repeat(64) })
      )
      await expect(
        (controller as any)._loadAndVerifySidecar(videoPath, sidecarPath)
      ).rejects.toThrow('artifactSha256 与所选录像不匹配')

      fs.writeFileSync(
        sidecarPath,
        JSON.stringify({
          ...baseSidecar,
          events: [
            { videoTimeMs: 2_000, gameTimeSeconds: 2, kind: 'First', payload: {} },
            { videoTimeMs: 1_000, gameTimeSeconds: 1, kind: 'Second', payload: {} }
          ]
        })
      )
      await expect(
        (controller as any)._loadAndVerifySidecar(videoPath, sidecarPath)
      ).rejects.toThrow('Sidecar 契约校验失败')

      fs.writeFileSync(
        sidecarPath,
        JSON.stringify({ ...baseSidecar, source: '', artifactSha256: 'not-a-sha' })
      )
      await expect(
        (controller as any)._loadAndVerifySidecar(videoPath, sidecarPath)
      ).rejects.toThrow('Sidecar 契约校验失败')
    } finally {
      fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  it('rejects an oversized sidecar before reading or parsing it', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-sidecar-size-'))
    const videoPath = path.join(directory, 'match.mp4')
    const sidecarPath = path.join(directory, 'match.sidecar.json')
    fs.writeFileSync(videoPath, 'video')
    fs.writeFileSync(sidecarPath, '{}')
    fs.truncateSync(sidecarPath, 8 * 1024 * 1024 + 1)
    const controller = new ReplayImportController(createMockContext())

    try {
      await expect(
        (controller as any)._loadAndVerifySidecar(videoPath, sidecarPath)
      ).rejects.toThrow('超过 8 MiB')
    } finally {
      fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  it('imports valid JSON replay session and generates standard ReplaySidecarData', async () => {
    const ctx = createMockContext()
    const controller = new ReplayImportController(ctx)

    const sampleSession = new CoachReplaySimulator().createSampleReplaySession()

    const tempJsonPath = path.join(os.tmpdir(), `akari_test_session_${Date.now()}.JSON`)
    fs.writeFileSync(tempJsonPath, JSON.stringify(sampleSession), 'utf-8')

    try {
      const taskId = '11111111-1111-4111-8111-111111111111'
      const result = await controller.importVideoReplay(
        tempJsonPath,
        undefined,
        undefined,
        undefined,
        taskId
      )

      expect(result.session).toBeDefined()
      expect(result.sidecar).toBeDefined()
      expect(result.sidecar.sessionId).toBe(sampleSession.metadata.sessionId)
      expect(result.sidecar.patch).toBe('16.17.1')
      expect(result.markdown).toContain('战术复盘')
      expect(ctx.ipc.sendEvent).toHaveBeenCalledWith(
        'live-coach-main',
        'replay-import-progress',
        expect.objectContaining({ taskId, stage: 'completed', progress: 100 })
      )
    } finally {
      if (fs.existsSync(tempJsonPath)) {
        fs.unlinkSync(tempJsonPath)
      }
    }
  })

  it('rejects malformed JSON replay contracts before simulation', async () => {
    const controller = new ReplayImportController(createMockContext())
    const tempJsonPath = path.join(os.tmpdir(), `akari_invalid_session_${Date.now()}.json`)
    fs.writeFileSync(tempJsonPath, JSON.stringify({ metadata: {}, frames: [{}] }), 'utf-8')

    try {
      await expect(controller.importVideoReplay(tempJsonPath)).rejects.toThrow()
    } finally {
      fs.rmSync(tempJsonPath, { force: true })
    }
  })

  it('rejects a second replay operation while another one is still active', async () => {
    const controller = new ReplayImportController(createMockContext())
    const tempVideoPath = path.join(os.tmpdir(), `akari_busy_replay_${Date.now()}.mp4`)
    fs.writeFileSync(tempVideoPath, 'video', 'utf-8')
    let releaseCheck!: (value: { available: boolean; error?: string }) => void
    vi.spyOn(controller, 'checkFfmpegAvailable').mockImplementation(
      () => new Promise((resolve) => (releaseCheck = resolve))
    )

    try {
      const first = controller.prepareVideoReplay(tempVideoPath)
      await Promise.resolve()
      await expect(controller.prepareVideoReplay(tempVideoPath)).rejects.toThrow(
        '已有录像导入或分析任务正在运行'
      )
      releaseCheck({ available: false, error: 'test stop' })
      await expect(first).rejects.toThrow('test stop')
    } finally {
      fs.rmSync(tempVideoPath, { force: true })
    }
  })

  it('rejects video files when ffmpeg is unavailable with a clear error message', async () => {
    const ctx = createMockContext()
    const controller = new ReplayImportController(ctx)

    vi.spyOn(controller, 'checkFfmpegAvailable').mockResolvedValue({
      available: false,
      error: '系统未检测到可用 FFmpeg'
    })

    const tempVideoPath = path.join(os.tmpdir(), `akari_test_video_${Date.now()}.mp4`)
    fs.writeFileSync(tempVideoPath, 'dummy-video-data', 'utf-8')

    try {
      await expect(controller.importVideoReplay(tempVideoPath)).rejects.toThrow(
        '未能执行视频解码: 系统未检测到可用 FFmpeg。请导入 .json 会话文件或安装 FFmpeg 后重试。'
      )
    } finally {
      if (fs.existsSync(tempVideoPath)) {
        fs.unlinkSync(tempVideoPath)
      }
    }
  })

  it('cancels active import and ensures temporary directory cleanup', async () => {
    const ctx = createMockContext()
    const controller = new ReplayImportController(ctx)

    vi.spyOn(controller, 'checkFfmpegAvailable').mockResolvedValue({ available: true })
    vi.spyOn(controller, 'probeVideo').mockImplementation(async () => {
      controller.cancelImport()
      return {
        durationSeconds: 60,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: 'h264'
      }
    })

    const tempVideoPath = path.join(os.tmpdir(), `akari_test_cancel_${Date.now()}.mp4`)
    fs.writeFileSync(tempVideoPath, 'dummy-video-data', 'utf-8')

    try {
      await expect(controller.importVideoReplay(tempVideoPath)).rejects.toThrow('任务已被用户取消')
    } finally {
      if (fs.existsSync(tempVideoPath)) {
        fs.unlinkSync(tempVideoPath)
      }
    }
  })

  it('dispose waits for the active operation to settle after cancellation', async () => {
    const controller = new ReplayImportController(createMockContext())
    const tempVideoPath = path.join(os.tmpdir(), `akari_test_dispose_${Date.now()}.mp4`)
    fs.writeFileSync(tempVideoPath, 'dummy-video-data', 'utf-8')
    let releaseProbe!: () => void
    vi.spyOn(controller, 'checkFfmpegAvailable').mockResolvedValue({ available: true })
    vi.spyOn(controller, 'probeVideo').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseProbe = () =>
            resolve({ durationSeconds: 60, width: 1920, height: 1080, fps: 30, codec: 'h264' })
        })
    )

    try {
      const operation = controller.importVideoReplay(tempVideoPath)
      await vi.waitFor(() => expect(releaseProbe).toBeTypeOf('function'))
      const dispose = controller.dispose()
      releaseProbe()
      await dispose
      await expect(operation).rejects.toThrow('任务已被用户取消')
      expect(controller.activeTaskId).toBeNull()
    } finally {
      fs.rmSync(tempVideoPath, { force: true })
    }
  })

  it('does not lose cancellation requested immediately after an import starts', async () => {
    const controller = new ReplayImportController(createMockContext())
    const sampleSession = new CoachReplaySimulator().createSampleReplaySession()
    const sourcePath = path.join(os.tmpdir(), `akari_immediate_cancel_${Date.now()}.json`)
    fs.writeFileSync(sourcePath, JSON.stringify(sampleSession), 'utf-8')

    try {
      const operation = controller.importVideoReplay(sourcePath)
      const cancellation = controller.cancelImport()
      await expect(operation).rejects.toThrow('任务已被用户取消')
      await expect(cancellation).resolves.toMatchObject({ cancelled: true })
      expect(controller.activeTaskId).toBeNull()
    } finally {
      fs.rmSync(sourcePath, { force: true })
    }
  })

  it('streams a real video at 5 FPS and produces deterministic analysis results', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-replay-stream-'))
    const videoPath = path.join(directory, 'deterministic.mp4')
    const runtime = resolveFfmpegRuntime({
      appPath: process.cwd(),
      resourcesPath: process.cwd()
    })
    const generated = spawnSync(
      runtime.ffmpeg,
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=640x360:r=30:d=1.2',
        '-c:v',
        'mpeg4',
        '-y',
        videoPath
      ],
      { cwd: runtime.directory, encoding: 'utf8', windowsHide: true }
    )
    expect(generated.status, generated.stderr).toBe(0)

    const controller = new ReplayImportController(
      createMockContext(),
      createDeterministicReplayCvSession
    )
    const roi = { x: 0.82, y: 0.68, width: 0.18, height: 0.32 }
    try {
      const first = await controller.importVideoReplay(videoPath, undefined, roi)
      const second = await controller.importVideoReplay(videoPath, undefined, roi)

      expect(first.session.analysisFps).toBe(5)
      expect(first.session.frameCount).toBeGreaterThanOrEqual(5)
      expect(first.session.frameCount).toBeLessThanOrEqual(7)
      expect(first.session.id).toBe(second.session.id)
      expect(first.session.artifactSha256).toBe(second.session.artifactSha256)
      expect(first.sidecar).toEqual(second.sidecar)
      expect(first.cues).toEqual(second.cues)
    } finally {
      fs.rmSync(directory, { force: true, recursive: true })
    }
  }, 20_000)
})
