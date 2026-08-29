import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type FfmpegArtifactManifest,
  resolveFfmpegRuntime,
  verifyFfmpegRuntimeDirectory
} from './ffmpeg-runtime'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe('resolveFfmpegRuntime', () => {
  it('uses only an explicit runtime covered exactly by trusted hashes and metadata', () => {
    const { directory, manifest } = createRuntime()

    expect(
      resolveFfmpegRuntime({
        isPackaged: false,
        appPath: 'Z:\\missing',
        resourcesPath: 'Z:\\missing',
        overrideDirectory: directory,
        trustedArtifactManifest: manifest,
        platform: 'win32',
        arch: 'x64'
      })
    ).toEqual({
      directory: fs.realpathSync.native(directory),
      ffmpeg: path.join(fs.realpathSync.native(directory), 'ffmpeg.exe'),
      ffprobe: path.join(fs.realpathSync.native(directory), 'ffprobe.exe'),
      license: path.join(fs.realpathSync.native(directory), 'LICENSE.txt')
    })
  })

  it('detects a same-name executable replaced after a previously cached verification', () => {
    const { directory, manifest } = createRuntime()
    expect(() => verifyFfmpegRuntimeDirectory(directory, manifest, 'win32')).not.toThrow()

    fs.writeFileSync(path.join(directory, 'ffmpeg.exe'), 'tampered executable with same filename')

    expect(() => verifyFfmpegRuntimeDirectory(directory, manifest, 'win32')).toThrow(
      'integrity validation'
    )
  })

  it.each([
    [
      'protocol',
      (runtime: Record<string, unknown>) => (runtime.liveCoachProtocolVersion = '9.9.9')
    ],
    ['license', (runtime: Record<string, unknown>) => (runtime.license = 'unknown')],
    ['component', (runtime: Record<string, unknown>) => (runtime.component = 'other')]
  ])('rejects a runtime manifest with incompatible %s metadata', (_name, mutate) => {
    const { directory, manifest, runtimeManifest } = createRuntime()
    mutate(runtimeManifest)
    fs.writeFileSync(path.join(directory, 'runtime-manifest.json'), JSON.stringify(runtimeManifest))

    expect(() => verifyFfmpegRuntimeDirectory(directory, manifest, 'win32')).toThrow()
  })

  it('rejects extra files and a runtime manifest altered together with the executable', () => {
    const { directory, manifest, runtimeManifest } = createRuntime()
    fs.writeFileSync(path.join(directory, 'unexpected.dll'), 'unexpected')
    const replacement = Buffer.from('replacement')
    fs.writeFileSync(path.join(directory, 'ffmpeg.exe'), replacement)
    const files = runtimeManifest.files as Array<Record<string, unknown>>
    const entry = files.find((candidate) => candidate.path === 'ffmpeg.exe')!
    entry.size = replacement.length
    entry.sha256 = sha256(replacement)
    fs.writeFileSync(path.join(directory, 'runtime-manifest.json'), JSON.stringify(runtimeManifest))

    expect(() => verifyFfmpegRuntimeDirectory(directory, manifest, 'win32')).toThrow()
  })

  it('fails closed instead of searching the machine PATH or falling back from an override', () => {
    const { manifest } = createRuntime()
    expect(() =>
      resolveFfmpegRuntime({
        isPackaged: false,
        appPath: 'Z:\\missing',
        resourcesPath: 'Z:\\missing',
        overrideDirectory: 'Z:\\missing',
        trustedArtifactManifest: manifest,
        platform: 'win32',
        arch: 'x64'
      })
    ).toThrow('内置 FFmpeg 运行时缺失、损坏或不兼容')
  })
})

function createRuntime() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-ffmpeg-runtime-test-'))
  tempDirectories.push(directory)
  const contents = {
    'avcodec-test.dll': Buffer.from('dll'),
    'ffmpeg.exe': Buffer.from('ffmpeg'),
    'ffprobe.exe': Buffer.from('ffprobe'),
    'LICENSE.txt': Buffer.from('LGPL')
  }
  const runtimeFiles = Object.entries(contents)
    .map(([file, content]) => {
      fs.writeFileSync(path.join(directory, file), content)
      return { path: file, size: content.length, sha256: sha256(content) }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  const artifactSha256 = sha256(Buffer.from('archive'))
  const manifest: FfmpegArtifactManifest = {
    artifact: 'ffmpeg.zip',
    version: 'test-version',
    platform: 'win32-x64',
    variant: 'lgpl-shared',
    license: 'LGPL-3.0-or-later',
    sha256: artifactSha256,
    downloadUrl: 'https://example.test/ffmpeg.zip',
    sourceOfferUrl: 'https://example.test/source',
    buildSourceUrl: 'https://example.test/build',
    runtimeFiles
  }
  const runtimeManifest: Record<string, unknown> = {
    schemaVersion: 1,
    component: 'ffmpeg',
    liveCoachProtocolVersion: '1.0.0',
    version: manifest.version,
    platform: manifest.platform,
    variant: manifest.variant,
    license: manifest.license,
    archiveSha256: manifest.sha256,
    files: structuredClone(runtimeFiles)
  }
  fs.writeFileSync(path.join(directory, '.artifact-sha256'), artifactSha256)
  fs.writeFileSync(path.join(directory, 'runtime-manifest.json'), JSON.stringify(runtimeManifest))
  return { directory, manifest, runtimeManifest }
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}
