import { app } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

import ffmpegArtifactManifestJson from '../../../../resources/live-coach/ffmpeg/manifest.json'

const LIVE_COACH_PROTOCOL_VERSION = '1.0.0'
const RUNTIME_MANIFEST_FILENAME = 'runtime-manifest.json'
const ARTIFACT_MARKER_FILENAME = '.artifact-sha256'
const METADATA_FILENAMES = new Set([RUNTIME_MANIFEST_FILENAME, ARTIFACT_MARKER_FILENAME])

const sha256Schema = z.string().regex(/^[a-f\d]{64}$/)
const runtimeFileSchema = z
  .object({
    path: z.string().min(1),
    size: z.number().int().positive().safe(),
    sha256: sha256Schema
  })
  .strict()
const ffmpegArtifactManifestSchema = z
  .object({
    artifact: z.string().min(1),
    version: z.string().min(1),
    platform: z.string().min(1),
    variant: z.string().min(1),
    license: z.string().min(1),
    sha256: sha256Schema,
    downloadUrl: z.string().url(),
    sourceOfferUrl: z.string().url(),
    buildSourceUrl: z.string().url(),
    runtimeFiles: z.array(runtimeFileSchema).min(1)
  })
  .strict()
const ffmpegRuntimeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    component: z.literal('ffmpeg'),
    liveCoachProtocolVersion: z.literal(LIVE_COACH_PROTOCOL_VERSION),
    version: z.string().min(1),
    platform: z.string().min(1),
    variant: z.string().min(1),
    license: z.string().min(1),
    archiveSha256: sha256Schema,
    files: z.array(runtimeFileSchema).min(1)
  })
  .strict()

export type FfmpegArtifactManifest = z.infer<typeof ffmpegArtifactManifestSchema>

export interface FfmpegRuntimePaths {
  directory: string
  ffmpeg: string
  ffprobe: string
  license: string
}

export interface FfmpegRuntimeResolutionOptions {
  isPackaged?: boolean
  appPath?: string
  resourcesPath?: string
  overrideDirectory?: string
  /** Test-only dependency injection. Production callers use the manifest bundled in app code. */
  trustedArtifactManifest?: unknown
  /** Test-only platform injection. */
  platform?: NodeJS.Platform
  /** Test-only architecture injection. */
  arch?: string
}

interface CachedRuntimeVerification {
  fingerprint: string
  paths: FfmpegRuntimePaths
}

const verificationCache = new Map<string, CachedRuntimeVerification>()

export function resolveFfmpegRuntime(
  options: FfmpegRuntimeResolutionOptions = {}
): FfmpegRuntimePaths {
  const isPackaged = options.isPackaged ?? app?.isPackaged ?? false
  const appPath = options.appPath ?? app?.getAppPath?.() ?? process.cwd()
  const resourcesPath = options.resourcesPath ?? process.resourcesPath ?? appPath
  const overrideDirectory = options.overrideDirectory ?? process.env.LEAGUE_AKARI_FFMPEG_RUNTIME_DIR
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const trustedArtifactManifest = parseTrustedArtifactManifest(
    options.trustedArtifactManifest ?? ffmpegArtifactManifestJson,
    platform,
    arch
  )

  // An explicit developer override is itself the requested location. Never silently execute a
  // different binary after that location fails validation.
  const candidates = overrideDirectory
    ? [overrideDirectory]
    : [
        isPackaged ? path.join(resourcesPath, 'live-coach', 'ffmpeg', 'runtime') : undefined,
        path.join(appPath, 'resources', 'live-coach', 'ffmpeg', 'runtime'),
        path.join(
          resourcesPath,
          'app.asar.unpacked',
          'resources',
          'live-coach',
          'ffmpeg',
          'runtime'
        )
      ].filter((candidate): candidate is string => Boolean(candidate))

  for (const directory of candidates) {
    try {
      return verifyFfmpegRuntimeDirectory(directory, trustedArtifactManifest, platform)
    } catch {
      // Candidate paths are intentionally omitted from the public failure and persistent logs.
    }
  }

  throw new Error(
    '内置 FFmpeg 运行时缺失、损坏或不兼容。开发环境请先执行 yarn prepare:ffmpeg:win；发布包必须包含经过校验的 LGPL runtime。'
  )
}

export function verifyFfmpegRuntimeDirectory(
  directory: string,
  trustedArtifactManifest: FfmpegArtifactManifest,
  platform: NodeJS.Platform = process.platform
): FfmpegRuntimePaths {
  const directoryStat = fs.lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('FFmpeg runtime directory is not a regular directory')
  }

  const realDirectory = fs.realpathSync.native(directory)
  const manifestPath = path.join(realDirectory, RUNTIME_MANIFEST_FILENAME)
  const markerPath = path.join(realDirectory, ARTIFACT_MARKER_FILENAME)
  assertRegularFile(manifestPath)
  assertRegularFile(markerPath)

  const runtimeManifest = ffmpegRuntimeManifestSchema.parse(
    JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  )
  const trustedFiles = normalizePinnedFiles(trustedArtifactManifest.runtimeFiles)
  const runtimeFiles = normalizePinnedFiles(runtimeManifest.files)

  if (
    runtimeManifest.version !== trustedArtifactManifest.version ||
    runtimeManifest.platform !== trustedArtifactManifest.platform ||
    runtimeManifest.variant !== trustedArtifactManifest.variant ||
    runtimeManifest.license !== trustedArtifactManifest.license ||
    runtimeManifest.archiveSha256 !== trustedArtifactManifest.sha256 ||
    JSON.stringify(runtimeFiles) !== JSON.stringify(trustedFiles)
  ) {
    throw new Error('FFmpeg runtime manifest does not match the trusted build manifest')
  }

  const executableName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const probeName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  for (const requiredFile of [executableName, probeName, 'LICENSE.txt']) {
    if (!trustedFiles.some((entry) => entry.path === requiredFile)) {
      throw new Error(`FFmpeg runtime manifest is missing ${requiredFile}`)
    }
  }
  if (!trustedFiles.some((entry) => entry.path.toLowerCase().endsWith('.dll'))) {
    throw new Error('FFmpeg runtime manifest is missing shared-library DLLs')
  }

  const expectedEntryNames = [
    ...trustedFiles.map((entry) => entry.path),
    ...METADATA_FILENAMES
  ].sort((left, right) => left.localeCompare(right))
  const actualEntries = fs
    .readdirSync(realDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
  if (
    actualEntries.length !== expectedEntryNames.length ||
    actualEntries.some(
      (entry, index) =>
        entry.name !== expectedEntryNames[index] || !entry.isFile() || entry.isSymbolicLink()
    )
  ) {
    throw new Error('FFmpeg runtime directory is not exactly covered by its trusted manifest')
  }

  if (fs.readFileSync(markerPath, 'utf8').trim() !== trustedArtifactManifest.sha256) {
    throw new Error('FFmpeg runtime artifact marker does not match the trusted build manifest')
  }

  const trustedManifestFingerprint = createHash('sha256')
    .update(JSON.stringify(trustedArtifactManifest))
    .digest('hex')
  const cacheKey = `${realDirectory}\0${trustedManifestFingerprint}\0${platform}`
  const fingerprint = createRuntimeFingerprint(realDirectory, actualEntries)
  const cached = verificationCache.get(cacheKey)
  if (cached?.fingerprint === fingerprint) {
    return cached.paths
  }

  for (const entry of trustedFiles) {
    const filePath = path.join(realDirectory, entry.path)
    assertRegularFile(filePath)
    const stat = fs.statSync(filePath)
    if (stat.size !== entry.size || sha256File(filePath) !== entry.sha256) {
      throw new Error(`FFmpeg runtime file failed integrity validation: ${entry.path}`)
    }
  }

  const paths: FfmpegRuntimePaths = {
    directory: realDirectory,
    ffmpeg: path.join(realDirectory, executableName),
    ffprobe: path.join(realDirectory, probeName),
    license: path.join(realDirectory, 'LICENSE.txt')
  }
  verificationCache.set(cacheKey, { fingerprint, paths })
  return paths
}

function parseTrustedArtifactManifest(
  value: unknown,
  platform: NodeJS.Platform,
  arch: string
): FfmpegArtifactManifest {
  const manifest = ffmpegArtifactManifestSchema.parse(value)
  if (manifest.platform !== `${platform}-${arch}`) {
    throw new Error('FFmpeg runtime platform is incompatible with this process')
  }
  normalizePinnedFiles(manifest.runtimeFiles)
  return manifest
}

function normalizePinnedFiles(files: FfmpegArtifactManifest['runtimeFiles']) {
  const seen = new Set<string>()
  return [...files]
    .map((entry) => {
      if (
        entry.path !== path.basename(entry.path) ||
        entry.path.includes('/') ||
        entry.path.includes('\\') ||
        METADATA_FILENAMES.has(entry.path) ||
        seen.has(entry.path)
      ) {
        throw new Error('FFmpeg runtime manifest contains an unsafe or duplicate file path')
      }
      seen.add(entry.path)
      return { ...entry, sha256: entry.sha256.toLowerCase() }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

function assertRegularFile(filePath: string) {
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('FFmpeg runtime contains a non-regular file')
  }
}

function createRuntimeFingerprint(directory: string, entries: fs.Dirent[]) {
  const metadata = entries.map((entry) => {
    const stat = fs.lstatSync(path.join(directory, entry.name))
    return [entry.name, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode].join(':')
  })
  return createHash('sha256').update(metadata.join('\n')).digest('hex')
}

function sha256File(filePath: string) {
  const hash = createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}
