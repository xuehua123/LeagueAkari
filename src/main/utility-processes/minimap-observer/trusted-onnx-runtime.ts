import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

import trustedManifestJson from '../../../../resources/live-coach/onnx-runtime/manifest.json'

const sha256Schema = z.string().regex(/^[a-f\d]{64}$/)
const runtimeFileSchema = z
  .object({
    path: z.string().min(1),
    size: z.number().int().positive().safe(),
    sha256: sha256Schema
  })
  .strict()
const trustedOnnxRuntimeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    component: z.literal('onnxruntime-node'),
    version: z.string().min(1),
    liveCoachProtocolVersion: z.literal('1.0.0'),
    license: z.literal('MIT'),
    napiVersion: z.number().int().positive(),
    platforms: z.record(z.string().min(1), z.array(runtimeFileSchema).min(1))
  })
  .strict()

export type TrustedOnnxRuntimeManifest = z.infer<typeof trustedOnnxRuntimeManifestSchema>

export interface TrustedOnnxRuntimeVerificationOptions {
  packageRoot?: string
  platform?: NodeJS.Platform
  arch?: string
  trustedManifest?: unknown
}

interface CachedVerification {
  fingerprint: string
  version: string
}

const verificationCache = new Map<string, CachedVerification>()

export function verifyTrustedOnnxRuntime(options: TrustedOnnxRuntimeVerificationOptions = {}): {
  directory: string
  version: string
} {
  const manifest = trustedOnnxRuntimeManifestSchema.parse(
    options.trustedManifest ?? trustedManifestJson
  )
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const platformKey = `${platform}-${arch}`
  const expectedFiles = normalizeFiles(manifest.platforms[platformKey])
  if (!expectedFiles) {
    throw new Error(`ONNX Runtime platform is unsupported: ${platformKey}`)
  }

  const packageRoot = fs.realpathSync.native(
    options.packageRoot ?? path.dirname(require.resolve('onnxruntime-node/package.json'))
  )
  const packageRootStat = fs.lstatSync(packageRoot)
  if (!packageRootStat.isDirectory() || packageRootStat.isSymbolicLink()) {
    throw new Error('ONNX Runtime package root is not a regular directory')
  }
  const packageMetadataPath = path.join(packageRoot, 'package.json')
  assertRegularFile(packageMetadataPath)
  const packageMetadata = z
    .object({
      name: z.literal('onnxruntime-node'),
      version: z.string().min(1),
      license: z.string()
    })
    .passthrough()
    .parse(JSON.parse(fs.readFileSync(packageMetadataPath, 'utf8')))
  if (
    packageMetadata.version !== manifest.version ||
    packageMetadata.license !== manifest.license
  ) {
    throw new Error('ONNX Runtime package metadata does not match the trusted manifest')
  }

  const runtimeDirectory = path.join(
    packageRoot,
    'bin',
    `napi-v${manifest.napiVersion}`,
    platform,
    arch
  )
  const runtimeDirectoryStat = fs.lstatSync(runtimeDirectory)
  if (!runtimeDirectoryStat.isDirectory() || runtimeDirectoryStat.isSymbolicLink()) {
    throw new Error('ONNX Runtime binary directory is not a regular directory')
  }
  const realRuntimeDirectory = fs.realpathSync.native(runtimeDirectory)
  const entries = fs
    .readdirSync(realRuntimeDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
  if (
    entries.length !== expectedFiles.length ||
    entries.some(
      (entry, index) =>
        entry.name !== expectedFiles[index].path || !entry.isFile() || entry.isSymbolicLink()
    )
  ) {
    throw new Error('ONNX Runtime binary set is not exactly covered by the trusted manifest')
  }

  const trustedFingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
  const cacheKey = `${realRuntimeDirectory}\0${trustedFingerprint}`
  const fingerprint = createMetadataFingerprint(realRuntimeDirectory, entries)
  const cached = verificationCache.get(cacheKey)
  if (cached?.fingerprint === fingerprint) {
    return { directory: realRuntimeDirectory, version: cached.version }
  }

  for (const expected of expectedFiles) {
    const filePath = path.join(realRuntimeDirectory, expected.path)
    assertRegularFile(filePath)
    const stat = fs.statSync(filePath)
    if (stat.size !== expected.size || sha256File(filePath) !== expected.sha256) {
      throw new Error(`ONNX Runtime binary failed integrity validation: ${expected.path}`)
    }
  }

  verificationCache.set(cacheKey, { fingerprint, version: manifest.version })
  return { directory: realRuntimeDirectory, version: manifest.version }
}

function normalizeFiles(files: TrustedOnnxRuntimeManifest['platforms'][string] | undefined) {
  if (!files) return null
  const seen = new Set<string>()
  return [...files]
    .map((entry) => {
      if (
        entry.path !== path.basename(entry.path) ||
        entry.path.includes('/') ||
        entry.path.includes('\\') ||
        seen.has(entry.path)
      ) {
        throw new Error('ONNX Runtime manifest contains an unsafe or duplicate file path')
      }
      seen.add(entry.path)
      return { ...entry, sha256: entry.sha256.toLowerCase() }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

function assertRegularFile(filePath: string) {
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('ONNX Runtime contains a non-regular file')
  }
}

function createMetadataFingerprint(directory: string, entries: fs.Dirent[]) {
  return createHash('sha256')
    .update(
      entries
        .map((entry) => {
          const stat = fs.lstatSync(path.join(directory, entry.name))
          return [entry.name, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode].join(':')
        })
        .join('\n')
    )
    .digest('hex')
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
