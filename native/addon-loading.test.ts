import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { initializeWin32Addons } from '../src/main/native/addons-win32'
import type { Win32Addons } from '../src/main/native/addons-win32'

const nativePackageEntry = path.resolve('native/win32-x64/dist/index.js')

function runNodeContract(scriptBody: string) {
  execFileSync(process.execPath, ['-e', scriptBody], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    stdio: 'pipe'
  })
}

describe('native addon facade contract', () => {
  it('keeps imports side-effect free and loads each addon explicitly', () => {
    runNodeContract(`
      const assert = require('node:assert/strict')
      const Module = require('node:module')
      const path = require('node:path')
      const loaded = []
      const originalNodeLoader = Module._extensions['.node']
      const originalResolveFilename = Module._resolveFilename

      Module._resolveFilename = function(request, parent, isMain, options) {
        if (
          typeof request === 'string' &&
          (request.endsWith('akari-capture-win64.node') ||
            request.endsWith('akari-speech-win64.node'))
        ) {
          return path.resolve('native/win32-x64/addons', path.basename(request))
        }
        return originalResolveFilename.call(this, request, parent, isMain, options)
      }

      Module._extensions['.node'] = (module, filename) => {
        loaded.push(path.basename(filename))
        if (filename.includes('capture')) {
          module.exports = {
            CaptureSession: class {
              captureFrame() { return null }
              dispose() {}
            },
            isWgcSupported() { return true },
            isDdaSupported() { return true },
            inspectTargetEnvironment(options) {
              return options.targetPid === 42
                ? {
                    targetPid: 42,
                    displayId: 'display-2',
                    windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
                    clientBounds: { x: 0, y: 0, width: 1920, height: 1080 },
                    monitorBounds: { x: 0, y: 0, width: 2560, height: 1440 },
                    dpiScale: 1.5,
                    hdr: null,
                    windowMode: 'unknown'
                  }
                : null
            }
          }
        } else if (filename.includes('speech')) {
          module.exports = {
            playEarcon() { return Promise.resolve(true) },
            SpeechSynthesizer: class {
              listVoices() {
                return [{ id: 'zh', name: 'Chinese', culture: 'zh-CN', gender: 'Female' }]
              }
              listOutputDevices() {
                return [{ id: 'speaker', name: 'Speaker', isDefault: true }]
              }
              speak() { return 'sapi-1' }
              getOperationState() { return 'completed' }
              cancel() { return true }
              pause() { return true }
              resume() { return true }
              dispose() {}
            }
          }
        } else if (filename.includes('input')) {
          module.exports = {
              install() {},
              uninstall() {},
              onKeyEvent() {},
              sendString() { return Promise.resolve() },
              sendKey() { return Promise.resolve() },
              getKeyStates() { return [] }
          }
        } else {
          module.exports = {
              fixWindowMethodA() { return true },
              isElevated() { return false },
              getLeagueClientWindowPlacementInfo() { return null },
              getCommandLine1() { return '' },
              getPidsByName() { return [] },
              terminateProcess() { return false },
              isProcessForeground() { return false },
              isProcessRunning() { return true }
          }
        }
      }

      try {
        const entry = ${JSON.stringify(nativePackageEntry)}
        const addons = require(entry)
        const capture = require(path.join(path.dirname(entry), 'capture/index.js'))
        const input = require(path.join(path.dirname(entry), 'input/index.js'))
        const speech = require(path.join(path.dirname(entry), 'speech/index.js'))
        const tools = require(path.join(path.dirname(entry), 'tools/index.js')).default

        assert.deepEqual(loaded, [])
        assert.equal(addons.capture, capture)
        assert.equal(addons.input, input)
        assert.equal(addons.speech, speech)
        assert.equal(addons.tools, tools)
        assert.equal(addons.capture.isLoaded(), false)
        assert.equal(addons.tools.isLoaded(), false)
        assert.equal(addons.input.isLoaded(), false)
        assert.equal(addons.speech.isLoaded(), false)
        assert.throws(
          () => addons.capture.isWgcSupported(),
          (error) => error instanceof addons.AddonNotLoadedError && error.feature === 'capture'
        )
        assert.throws(
          () => addons.tools.isElevated(),
          (error) => error instanceof addons.AddonNotLoadedError && error.feature === 'tools'
        )
        assert.throws(
          () => addons.input.instance.getKeyStates(),
          (error) => error instanceof addons.AddonNotLoadedError && error.feature === 'input'
        )

        addons.tools.load()
        addons.tools.load()
        assert.equal(addons.tools.isLoaded(), true)
        assert.deepEqual(loaded, ['akari-tools-win64.node'])
        assert.equal(addons.tools.isElevated(), false)

        addons.capture.load()
        addons.capture.load()
        assert.equal(addons.capture.isLoaded(), true)
        assert.equal(addons.capture.isWgcSupported(), true)
        assert.deepEqual(addons.capture.inspectTargetEnvironment({ targetPid: 42 }), {
          targetPid: 42,
          displayId: 'display-2',
          windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          clientBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          monitorBounds: { x: 0, y: 0, width: 2560, height: 1440 },
          dpiScale: 1.5,
          hdr: null,
          windowMode: 'unknown'
        })
        const captureSession = new addons.capture.CaptureSession({
          backend: 'wgc',
          targetPid: process.pid,
          roi: { x: 0, y: 0, width: 1, height: 1 }
        })
        assert.equal(captureSession.captureFrame(), null)
        captureSession.dispose()
        assert.deepEqual(loaded, ['akari-tools-win64.node', 'akari-capture-win64.node'])

        addons.speech.load()
        addons.speech.load()
        assert.equal(typeof addons.speech.playEarcon('warning', 0.8).then, 'function')
        const speechEngine = new addons.speech.SpeechSynthesizer()
        assert.equal(speechEngine.listVoices()[0].culture, 'zh-CN')
        assert.equal(speechEngine.listOutputDevices()[0].isDefault, true)
        const operationId = speechEngine.speak('test', { volume: 80, rate: 0 })
        assert.equal(speechEngine.getOperationState(operationId), 'completed')
        speechEngine.dispose()
        assert.deepEqual(loaded, [
          'akari-tools-win64.node',
          'akari-capture-win64.node',
          'akari-speech-win64.node'
        ])

        addons.input.load()
        addons.input.load()
        assert.equal(addons.input.isLoaded(), true)
        assert.deepEqual(loaded, [
          'akari-tools-win64.node',
          'akari-capture-win64.node',
          'akari-speech-win64.node',
          'akari-input-win64.node'
        ])
        assert.deepEqual(addons.input.instance.getKeyStates(), [])
      } finally {
        Module._extensions['.node'] = originalNodeLoader
        Module._resolveFilename = originalResolveFilename
      }
    `)
  })

  it('keeps failed loads uncached and exposes the original cause', () => {
    runNodeContract(`
      const assert = require('node:assert/strict')
      const Module = require('node:module')
      const originalNodeLoader = Module._extensions['.node']
      const loadFailure = new Error('simulated loader failure')
      let attempts = 0

      Module._extensions['.node'] = (module) => {
        attempts += 1
        if (attempts === 1) {
          throw loadFailure
        }
        module.exports = {
          fixWindowMethodA() { return true },
          isElevated() { return false },
          getLeagueClientWindowPlacementInfo() { return null },
          getCommandLine1() { return '' },
          getPidsByName() { return [] },
          terminateProcess() { return false },
          isProcessForeground() { return false },
          isProcessRunning() { return true }
        }
      }

      try {
        const addons = require(${JSON.stringify(nativePackageEntry)})
        assert.throws(
          () => addons.tools.load(),
          (error) =>
            error instanceof addons.AddonLoadError &&
            error.feature === 'tools' &&
            error.cause === loadFailure
        )
        assert.equal(addons.tools.isLoaded(), false)

        addons.tools.load()
        assert.equal(addons.tools.isLoaded(), true)
        assert.equal(attempts, 2)
      } finally {
        Module._extensions['.node'] = originalNodeLoader
      }
    `)
  })
})

describe.skipIf(process.platform !== 'win32')('Windows native addon integration', () => {
  it('initializes real addons according to the current process privileges', () => {
    const require = createRequire(__filename)
    const addons = require(nativePackageEntry) as Win32Addons
    const exitListeners: Array<() => void> = []

    expect(addons.tools.isLoaded()).toBe(false)
    expect(addons.input.isLoaded()).toBe(false)
    expect(addons.capture.isLoaded()).toBe(false)

    const result = initializeWin32Addons(addons, (listener) => exitListeners.push(listener))

    try {
      expect(addons.tools.isLoaded()).toBe(true)
      expect(addons.tools.isProcessRunning(process.pid)).toBe(true)
      expect(result.isElevated).toBe(addons.tools.isElevated())

      addons.capture.load()
      expect(addons.capture.inspectTargetEnvironment({ targetPid: 0 })).toBeNull()

      if (result.isElevated) {
        expect(result.inputInitializationError).toBeUndefined()
        expect(addons.input.isLoaded()).toBe(true)
        expect(addons.input.instance.isInstalled).toBe(true)
        expect(addons.input.instance.getKeyStates()).toHaveLength(256)
        expect(exitListeners).toHaveLength(1)
      } else {
        expect(addons.input.isLoaded()).toBe(false)
        expect(addons.input.instance.isInstalled).toBe(false)
        expect(exitListeners).toHaveLength(0)
      }
    } finally {
      for (const listener of exitListeners) {
        listener()
      }
    }

    expect(addons.input.instance.isInstalled).toBe(false)
  })
})
