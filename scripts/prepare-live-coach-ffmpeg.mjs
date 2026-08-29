import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const ffmpegResourceDir = path.join(projectRoot, 'resources', 'live-coach', 'ffmpeg')
const runtimeDir = path.join(ffmpegResourceDir, 'runtime')
const manifest = JSON.parse(fs.readFileSync(path.join(ffmpegResourceDir, 'manifest.json'), 'utf8'))

const markerPath = path.join(runtimeDir, '.artifact-sha256')
const expectedFiles = ['ffmpeg.exe', 'ffprobe.exe', 'LICENSE.txt']
const metadataFiles = new Set(['.artifact-sha256', 'runtime-manifest.json'])

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function validatePinnedRuntimeFiles() {
  if (!Array.isArray(manifest.runtimeFiles) || manifest.runtimeFiles.length === 0) {
    throw new Error('FFmpeg artifact manifest must pin every extracted runtime file')
  }
  const seen = new Set()
  for (const entry of manifest.runtimeFiles) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      entry.path !== path.basename(entry.path) ||
      metadataFiles.has(entry.path) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f\d]{64}$/.test(entry.sha256)
    ) {
      throw new Error('FFmpeg artifact manifest contains an invalid runtime file entry')
    }
    if (seen.has(entry.path)) {
      throw new Error(`FFmpeg artifact manifest contains duplicate runtime file ${entry.path}`)
    }
    seen.add(entry.path)
  }
  for (const expectedFile of expectedFiles) {
    if (!seen.has(expectedFile)) {
      throw new Error(`FFmpeg artifact manifest is missing ${expectedFile}`)
    }
  }
  if (![...seen].some((filename) => filename.toLowerCase().endsWith('.dll'))) {
    throw new Error('FFmpeg artifact manifest does not pin shared-library DLLs')
  }
  return [...manifest.runtimeFiles].sort((left, right) => left.path.localeCompare(right.path))
}

const pinnedRuntimeFiles = validatePinnedRuntimeFiles()

function readRuntimeFiles(directory) {
  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !metadataFiles.has(entry.name))
    .map((entry) => {
      if (!entry.isFile()) {
        throw new Error(`Prepared FFmpeg runtime contains non-file entry ${entry.name}`)
      }
      const filePath = path.join(directory, entry.name)
      return {
        path: entry.name,
        size: fs.statSync(filePath).size,
        sha256: sha256File(filePath)
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))

  return files
}

function assertRuntimeMatchesPins(directory) {
  const files = readRuntimeFiles(directory)
  if (files.length !== pinnedRuntimeFiles.length) {
    throw new Error('Prepared FFmpeg runtime file set does not match the pinned artifact manifest')
  }
  for (let index = 0; index < pinnedRuntimeFiles.length; index += 1) {
    const actual = files[index]
    const expected = pinnedRuntimeFiles[index]
    if (
      actual.path !== expected.path ||
      actual.size !== expected.size ||
      actual.sha256 !== expected.sha256
    ) {
      throw new Error(`Prepared FFmpeg runtime does not match pinned file ${expected.path}`)
    }
  }
  return files
}

function writeRuntimeManifest(directory) {
  const files = assertRuntimeMatchesPins(directory)

  const runtimeManifest = {
    schemaVersion: 1,
    component: 'ffmpeg',
    liveCoachProtocolVersion: '1.0.0',
    version: manifest.version,
    platform: manifest.platform,
    variant: manifest.variant,
    license: manifest.license,
    archiveSha256: manifest.sha256,
    files
  }
  const targetPath = path.join(directory, 'runtime-manifest.json')
  const temporaryPath = `${targetPath}.tmp-${process.pid}`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`, {
    flag: 'wx'
  })
  fs.renameSync(temporaryPath, targetPath)
}

function isPinnedRuntimePrepared() {
  try {
    if (
      !fs.existsSync(markerPath) ||
      fs.readFileSync(markerPath, 'utf8').trim() !== manifest.sha256
    ) {
      return false
    }
    assertRuntimeMatchesPins(runtimeDir)
    return true
  } catch {
    return false
  }
}

if (isPinnedRuntimePrepared()) {
  writeRuntimeManifest(runtimeDir)
  process.stdout.write(`FFmpeg ${manifest.version} is already prepared.\n`)
  process.exit(0)
}

if (process.platform !== 'win32') {
  throw new Error('The Phase 1 bundled FFmpeg runtime currently supports Windows x64 only.')
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'league-akari-ffmpeg-'))
const archivePath = path.join(tempRoot, manifest.artifact)
const extractDir = path.join(tempRoot, 'extract')
const stagedRuntimeDir = fs.mkdtempSync(path.join(ffmpegResourceDir, '.runtime-stage-'))

try {
  process.stdout.write(`Downloading pinned FFmpeg ${manifest.version}...\n`)
  const response = await fetch(manifest.downloadUrl, { redirect: 'follow' })
  if (!response.ok) throw new Error(`FFmpeg download failed with HTTP ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  const actualSha256 = createHash('sha256').update(archive).digest('hex')
  if (actualSha256 !== manifest.sha256) {
    throw new Error(
      `FFmpeg SHA-256 mismatch: expected ${manifest.sha256}, received ${actualSha256}`
    )
  }
  fs.writeFileSync(archivePath, archive)
  fs.mkdirSync(extractDir)

  const extraction = spawnSync('tar', ['-xf', archivePath, '-C', extractDir], {
    stdio: 'inherit',
    windowsHide: true
  })
  if (extraction.status !== 0)
    throw new Error(`Unable to extract FFmpeg archive (${extraction.status})`)

  const roots = fs
    .readdirSync(extractDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
  if (roots.length !== 1) throw new Error('Unexpected FFmpeg archive layout')
  const extractedRoot = path.join(extractDir, roots[0].name)
  const binDir = path.join(extractedRoot, 'bin')

  for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      (entry.name.endsWith('.dll') || entry.name === 'ffmpeg.exe' || entry.name === 'ffprobe.exe')
    ) {
      fs.copyFileSync(path.join(binDir, entry.name), path.join(stagedRuntimeDir, entry.name))
    }
  }
  fs.copyFileSync(
    path.join(extractedRoot, 'LICENSE.txt'),
    path.join(stagedRuntimeDir, 'LICENSE.txt')
  )
  fs.writeFileSync(path.join(stagedRuntimeDir, '.artifact-sha256'), `${manifest.sha256}\n`)
  writeRuntimeManifest(stagedRuntimeDir)

  const backupRuntimeDir = `${runtimeDir}.backup-${process.pid}`
  fs.rmSync(backupRuntimeDir, { force: true, recursive: true })
  if (fs.existsSync(runtimeDir)) fs.renameSync(runtimeDir, backupRuntimeDir)
  try {
    fs.renameSync(stagedRuntimeDir, runtimeDir)
    fs.rmSync(backupRuntimeDir, { force: true, recursive: true })
  } catch (error) {
    if (fs.existsSync(backupRuntimeDir) && !fs.existsSync(runtimeDir)) {
      fs.renameSync(backupRuntimeDir, runtimeDir)
    }
    throw error
  }
  process.stdout.write(`Prepared FFmpeg runtime at ${runtimeDir}\n`)
} finally {
  fs.rmSync(tempRoot, { force: true, recursive: true })
  fs.rmSync(stagedRuntimeDir, { force: true, recursive: true })
}
