import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { type TrustedOnnxRuntimeManifest, verifyTrustedOnnxRuntime } from './trusted-onnx-runtime'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe('verifyTrustedOnnxRuntime', () => {
  it('accepts an exact hash-locked binary set', () => {
    const fixture = createFixture()

    expect(
      verifyTrustedOnnxRuntime({
        packageRoot: fixture.packageRoot,
        platform: 'win32',
        arch: 'x64',
        trustedManifest: fixture.manifest
      })
    ).toEqual({
      directory: fs.realpathSync.native(fixture.runtimeDirectory),
      version: '1.29.0'
    })
  })

  it('detects a binary replaced after a cached successful verification', () => {
    const fixture = createFixture()
    const options = {
      packageRoot: fixture.packageRoot,
      platform: 'win32' as const,
      arch: 'x64',
      trustedManifest: fixture.manifest
    }
    verifyTrustedOnnxRuntime(options)

    fs.writeFileSync(path.join(fixture.runtimeDirectory, 'onnxruntime.dll'), 'tampered')

    expect(() => verifyTrustedOnnxRuntime(options)).toThrow('integrity validation')
  })

  it('rejects extra files and manifest-plus-binary co-tampering', () => {
    const fixture = createFixture()
    const replacement = Buffer.from('replacement')
    fs.writeFileSync(path.join(fixture.runtimeDirectory, 'onnxruntime.dll'), replacement)
    fs.writeFileSync(path.join(fixture.runtimeDirectory, 'extra.dll'), 'extra')
    fixture.manifest.platforms['win32-x64'][0] = {
      path: 'onnxruntime.dll',
      size: replacement.length,
      sha256: sha256(replacement)
    }

    expect(() =>
      verifyTrustedOnnxRuntime({
        packageRoot: fixture.packageRoot,
        platform: 'win32',
        arch: 'x64',
        trustedManifest: fixture.manifest
      })
    ).toThrow()
  })

  it('rejects incompatible protocol, package version, and unknown platforms', () => {
    const fixture = createFixture()
    expect(() =>
      verifyTrustedOnnxRuntime({
        packageRoot: fixture.packageRoot,
        platform: 'linux',
        arch: 'x64',
        trustedManifest: fixture.manifest
      })
    ).toThrow('unsupported')

    fs.writeFileSync(
      path.join(fixture.packageRoot, 'package.json'),
      JSON.stringify({ name: 'onnxruntime-node', version: '9.9.9', license: 'MIT' })
    )
    expect(() =>
      verifyTrustedOnnxRuntime({
        packageRoot: fixture.packageRoot,
        platform: 'win32',
        arch: 'x64',
        trustedManifest: fixture.manifest
      })
    ).toThrow('metadata')

    expect(() =>
      verifyTrustedOnnxRuntime({
        packageRoot: fixture.packageRoot,
        platform: 'win32',
        arch: 'x64',
        trustedManifest: { ...fixture.manifest, liveCoachProtocolVersion: '9.9.9' }
      })
    ).toThrow()
  })
})

function createFixture() {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-onnx-runtime-test-'))
  temporaryDirectories.push(packageRoot)
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'onnxruntime-node', version: '1.29.0', license: 'MIT' })
  )
  const runtimeDirectory = path.join(packageRoot, 'bin', 'napi-v6', 'win32', 'x64')
  fs.mkdirSync(runtimeDirectory, { recursive: true })
  const contents = {
    'onnxruntime.dll': Buffer.from('runtime'),
    'onnxruntime_binding.node': Buffer.from('binding')
  }
  const files = Object.entries(contents)
    .map(([file, content]) => {
      fs.writeFileSync(path.join(runtimeDirectory, file), content)
      return { path: file, size: content.length, sha256: sha256(content) }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  const manifest: TrustedOnnxRuntimeManifest = {
    schemaVersion: 1,
    component: 'onnxruntime-node',
    version: '1.29.0',
    liveCoachProtocolVersion: '1.0.0',
    license: 'MIT',
    napiVersion: 6,
    platforms: { 'win32-x64': files }
  }
  return { packageRoot, runtimeDirectory, manifest }
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}
