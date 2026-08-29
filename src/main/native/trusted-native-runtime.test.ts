import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearTrustedNativeRuntimeVerificationCacheForTesting,
  loadTrustedNativeRuntime,
  resolveTrustedNativeRuntimeRoot,
  verifyTrustedNativeRuntime
} from './trusted-native-runtime'

const sourceRuntimeRoot = path.resolve(__dirname, '../../../native/win32-x64')
const temporaryDirectories: string[] = []

function createRuntimeFixture(): string {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-native-runtime-'))
  temporaryDirectories.push(temporaryRoot)
  const runtimeRoot = path.join(temporaryRoot, 'runtime')
  fs.mkdirSync(runtimeRoot)
  fs.cpSync(path.join(sourceRuntimeRoot, 'addons'), path.join(runtimeRoot, 'addons'), {
    recursive: true
  })
  fs.cpSync(path.join(sourceRuntimeRoot, 'dist'), path.join(runtimeRoot, 'dist'), {
    recursive: true
  })
  fs.copyFileSync(
    path.join(sourceRuntimeRoot, 'package.json'),
    path.join(runtimeRoot, 'package.json')
  )
  return runtimeRoot
}

function mutateFileWithoutChangingSize(filePath: string): void {
  const bytes = fs.readFileSync(filePath)
  bytes[0] = bytes[0] ^ 0xff
  fs.writeFileSync(filePath, bytes)
}

function resealExternalManifest(runtimeRoot: string, relativePath: string): void {
  const manifestPath = path.join(runtimeRoot, 'dist', 'runtime-manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const filePath = path.join(runtimeRoot, ...relativePath.split('/'))
  const pin = manifest.files.find((entry: { path: string }) => entry.path === relativePath)
  pin.size = fs.statSync(filePath).size
  pin.sha256 = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

afterEach(() => {
  clearTrustedNativeRuntimeVerificationCacheForTesting()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe('trusted Windows native runtime', () => {
  it('loads only the verified absolute dist entry point', () => {
    const runtimeRoot = createRuntimeFixture()
    const moduleValue = { trusted: true }
    const moduleLoader = vi.fn(() => moduleValue)

    expect(loadTrustedNativeRuntime({ runtimeRoot, moduleLoader })).toBe(moduleValue)
    expect(moduleLoader).toHaveBeenCalledOnce()
    expect(moduleLoader).toHaveBeenCalledWith(
      fs.realpathSync.native(path.join(runtimeRoot, 'dist', 'index.js'))
    )
  })

  it.each(['addons/akari-capture-win64.node', 'dist/index.js'])(
    'rejects coordinated manifest and runtime tampering for %s before loading',
    (relativePath) => {
      const runtimeRoot = createRuntimeFixture()
      mutateFileWithoutChangingSize(path.join(runtimeRoot, ...relativePath.split('/')))
      resealExternalManifest(runtimeRoot, relativePath)
      const moduleLoader = vi.fn()

      expect(() => loadTrustedNativeRuntime({ runtimeRoot, moduleLoader })).toThrow(
        /does not match the embedded pins/
      )
      expect(moduleLoader).not.toHaveBeenCalled()
    }
  )

  it('rejects an extra executable runtime file before loading', () => {
    const runtimeRoot = createRuntimeFixture()
    fs.writeFileSync(path.join(runtimeRoot, 'dist', 'injected.js'), 'module.exports = {}\n')
    const moduleLoader = vi.fn()

    expect(() => loadTrustedNativeRuntime({ runtimeRoot, moduleLoader })).toThrow(
      /file set does not exactly match/
    )
    expect(moduleLoader).not.toHaveBeenCalled()
  })

  it('rejects a missing runtime file before loading', () => {
    const runtimeRoot = createRuntimeFixture()
    fs.rmSync(path.join(runtimeRoot, 'dist', 'index.js'))
    const moduleLoader = vi.fn()

    expect(() => loadTrustedNativeRuntime({ runtimeRoot, moduleLoader })).toThrow(
      /file set does not exactly match/
    )
    expect(moduleLoader).not.toHaveBeenCalled()
  })

  it('rejects a file hash mismatch before loading', () => {
    const runtimeRoot = createRuntimeFixture()
    mutateFileWithoutChangingSize(path.join(runtimeRoot, 'dist', 'index.js'))
    const moduleLoader = vi.fn()

    expect(() => loadTrustedNativeRuntime({ runtimeRoot, moduleLoader })).toThrow(
      /file integrity mismatch/
    )
    expect(moduleLoader).not.toHaveBeenCalled()
  })

  it('revalidates a replaced file after a cached successful verification', () => {
    const runtimeRoot = createRuntimeFixture()
    const moduleLoader = vi.fn(() => ({}))
    loadTrustedNativeRuntime({ runtimeRoot, moduleLoader })

    const entryPath = path.join(runtimeRoot, 'dist', 'index.js')
    const replacementPath = path.join(runtimeRoot, 'dist', 'replacement.tmp')
    fs.copyFileSync(entryPath, replacementPath)
    mutateFileWithoutChangingSize(replacementPath)
    fs.renameSync(replacementPath, entryPath)

    expect(() => loadTrustedNativeRuntime({ runtimeRoot, moduleLoader })).toThrow(
      /file integrity mismatch/
    )
    expect(moduleLoader).toHaveBeenCalledOnce()
  })

  it('rejects path traversal in the external manifest before loading', () => {
    const runtimeRoot = createRuntimeFixture()
    const manifestPath = path.join(runtimeRoot, 'dist', 'runtime-manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.files[0].path = '../outside.node'
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    const moduleLoader = vi.fn()

    expect(() => loadTrustedNativeRuntime({ runtimeRoot, moduleLoader })).toThrow(/unsafe path/)
    expect(moduleLoader).not.toHaveBeenCalled()
  })

  it('allows the development root itself to be a junction but rejects an internal junction', () => {
    const runtimeRoot = createRuntimeFixture()
    const temporaryRoot = path.dirname(runtimeRoot)
    const rootJunction = path.join(temporaryRoot, 'runtime-junction')
    fs.symlinkSync(runtimeRoot, rootJunction, 'junction')
    expect(verifyTrustedNativeRuntime(rootJunction).runtimeRoot).toBe(
      fs.realpathSync.native(runtimeRoot)
    )

    const captureDirectory = path.join(runtimeRoot, 'dist', 'capture')
    const externalCaptureDirectory = path.join(temporaryRoot, 'capture-target')
    fs.renameSync(captureDirectory, externalCaptureDirectory)
    fs.symlinkSync(externalCaptureDirectory, captureDirectory, 'junction')
    clearTrustedNativeRuntimeVerificationCacheForTesting()

    expect(() => verifyTrustedNativeRuntime(runtimeRoot)).toThrow(/symbolic links are forbidden/)
  })

  it('rejects a packaged runtime root that is a junction before loading', () => {
    const runtimeRoot = createRuntimeFixture()
    const rootJunction = path.join(path.dirname(runtimeRoot), 'packaged-runtime-junction')
    fs.symlinkSync(runtimeRoot, rootJunction, 'junction')
    const moduleLoader = vi.fn()

    expect(() =>
      loadTrustedNativeRuntime({
        runtimeRoot: rootJunction,
        isPackaged: true,
        moduleLoader
      })
    ).toThrow(/packaged runtime root cannot be a symbolic link or junction/)
    expect(moduleLoader).not.toHaveBeenCalled()
  })

  it('never falls back to a development working directory for packaged resolution', () => {
    const runtimeRoot = createRuntimeFixture()
    const resourcesPath = path.join(path.dirname(runtimeRoot), 'missing-resources')
    const moduleLoader = vi.fn()

    const resolved = resolveTrustedNativeRuntimeRoot({
      isPackaged: true,
      resourcesPath,
      workingDirectory: path.dirname(runtimeRoot)
    })
    expect(resolved).toBe(
      path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'league-akari-native-win32')
    )
    expect(() =>
      loadTrustedNativeRuntime({
        isPackaged: true,
        resourcesPath,
        workingDirectory: path.dirname(runtimeRoot),
        moduleLoader
      })
    ).toThrow(/runtime root is missing/)
    expect(moduleLoader).not.toHaveBeenCalled()
  })
})
