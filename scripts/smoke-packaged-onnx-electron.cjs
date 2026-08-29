const fs = require('node:fs')
const path = require('node:path')
const { app, utilityProcess } = require('electron')
const {
  isBootstrapModel,
  selectPreferredModelSmokeEntry
} = require('./live-coach-model-release-gate.cjs')

function smokeNativeBindings(appOutDir) {
  const nativeRoot = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'league-akari-native-win32'
  )
  const capture = require(path.join(nativeRoot, 'dist', 'capture', 'index.js'))
  const input = require(path.join(nativeRoot, 'dist', 'input', 'index.js'))
  const speech = require(path.join(nativeRoot, 'dist', 'speech', 'index.js'))
  const tools = require(path.join(nativeRoot, 'dist', 'tools', 'index.js')).default

  capture.load()
  if (!capture.isLoaded()) throw new Error('Packaged native capture addon did not load')
  const wgcSupported = capture.isWgcSupported()
  const ddaSupported = capture.isDdaSupported()
  if (typeof wgcSupported !== 'boolean' || typeof ddaSupported !== 'boolean') {
    throw new Error('Packaged native capture support probe returned an invalid result')
  }

  input.load()
  if (!input.isLoaded()) throw new Error('Packaged native input addon did not load')
  const keyStates = input.instance.getKeyStates()
  if (!Array.isArray(keyStates)) {
    throw new Error('Packaged native input state probe returned an invalid result')
  }

  speech.load()
  if (!speech.isLoaded()) throw new Error('Packaged native speech addon did not load')
  const synthesizer = new speech.SpeechSynthesizer()
  try {
    const voices = synthesizer.listVoices()
    const outputDevices = synthesizer.listOutputDevices()
    if (!Array.isArray(voices) || !Array.isArray(outputDevices)) {
      throw new Error('Packaged native speech enumeration returned an invalid result')
    }

    tools.load()
    if (!tools.isLoaded()) throw new Error('Packaged native tools addon did not load')
    const elevated = tools.isElevated()
    if (typeof elevated !== 'boolean') {
      throw new Error('Packaged native tools elevation probe returned an invalid result')
    }

    return {
      capture: { wgcSupported, ddaSupported },
      input: { keyStates: keyStates.length },
      speech: { voices: voices.length, outputDevices: outputDevices.length },
      tools: { elevated }
    }
  } finally {
    synthesizer.dispose()
  }
}

async function main() {
  const cliArguments = process.argv.slice(2)
  const requireAcceptedModel =
    cliArguments.includes('--require-accepted-model') ||
    process.env.LIVE_COACH_REQUIRE_ACCEPTED_MODEL === '1'
  const unknownOptions = cliArguments.filter(
    (argument) => argument.startsWith('--') && argument !== '--require-accepted-model'
  )
  if (unknownOptions.length > 0) {
    throw new Error(`Unknown smoke options: ${unknownOptions.join(', ')}`)
  }
  const positionalArguments = cliArguments.filter((argument) => !argument.startsWith('--'))
  if (positionalArguments.length > 1) {
    throw new Error('Packaged runtime smoke accepts at most one app directory')
  }
  const appOutDir = path.resolve(positionalArguments[0] || path.join('dist', 'win-unpacked'))
  const nativeRuntime = smokeNativeBindings(appOutDir)
  const workerPath = path.join(
    appOutDir,
    'resources',
    'app.asar',
    'out',
    'main',
    'minimap-observer-worker.js'
  )
  const packagedModelRoot = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'resources',
    'live-coach',
    'models'
  )
  const packagedAsarModelRoot = path.join(
    appOutDir,
    'resources',
    'app.asar',
    'resources',
    'live-coach',
    'models'
  )
  if (!fs.existsSync(workerPath)) {
    throw new Error(`Packaged ONNX worker is missing under ${appOutDir}`)
  }
  const packagedManifestPath = path.join(packagedModelRoot, 'manifest.json')
  if (!fs.existsSync(packagedManifestPath)) {
    throw new Error(`Packaged model manifest is missing: ${packagedManifestPath}`)
  }
  const packagedManifest = JSON.parse(fs.readFileSync(packagedManifestPath, 'utf8'))
  if (
    packagedManifest.schemaVersion !== 2 ||
    !packagedManifest.models ||
    typeof packagedManifest.releasePatch !== 'string'
  ) {
    throw new Error('Packaged model manifest has an unsupported schema')
  }
  const modelRoot = path.resolve('resources', 'live-coach', 'models')
  const forbiddenArtifacts = new Set(
    fs.readdirSync(modelRoot).filter((file) => /^champion-icons-.*\.json$/i.test(file))
  )
  for (const model of Object.values(packagedManifest.models)) {
    if (isBootstrapModel(model) && typeof model.file === 'string') {
      forbiddenArtifacts.add(model.file)
    }
  }
  for (const forbiddenArtifact of forbiddenArtifacts) {
    for (const root of [packagedModelRoot, packagedAsarModelRoot]) {
      if (fs.existsSync(path.join(root, forbiddenArtifact))) {
        throw new Error(`Unvalidated bootstrap artifact was packaged: ${forbiddenArtifact}`)
      }
    }
  }

  const manifestPath = path.join(modelRoot, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Smoke manifest is missing: ${manifestPath}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const smokeSelection = selectPreferredModelSmokeEntry(packagedManifest, manifest)
  if (requireAcceptedModel && !smokeSelection?.currentPatchModelReleaseEligible) {
    throw new Error(
      `Official release requires an accepted model smoke for current patch ${packagedManifest.releasePatch}`
    )
  }
  if (!smokeSelection) {
    throw new Error('No bootstrap or accepted ONNX smoke descriptor is available')
  }
  const [patch, model] = smokeSelection.entry
  const usingAcceptedModel = smokeSelection.mode === 'accepted-packaged-model'
  const smokeModelRoot = usingAcceptedModel ? packagedModelRoot : modelRoot
  const {
    file,
    dataset: _dataset,
    validation: _validation,
    workerProtocolVersion: _workerProtocolVersion,
    license: _license,
    ...runtimeDescriptor
  } = model
  const child = utilityProcess.fork(workerPath, [], {
    serviceName: 'LeagueAkari Packaged ONNX Smoke'
  })

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Packaged ONNX worker did not become ready within 20 seconds'))
    }, 20_000)

    child.on('message', (message) => {
      if (message?.type === 'error') {
        clearTimeout(timeout)
        child.kill()
        reject(new Error(`${message.code}: ${message.details}`))
        return
      }
      if (message?.type !== 'ready') return

      if (message.protocolVersion !== '1.0.0') {
        clearTimeout(timeout)
        child.kill()
        reject(
          new Error(`Unexpected packaged worker protocol: ${message.protocolVersion || 'missing'}`)
        )
        return
      }

      const runtime = message.runtimeVersions?.onnxruntime
      if (!/^1\.29\.0\/(dml|cpu)$/.test(runtime || '')) {
        clearTimeout(timeout)
        child.kill()
        reject(new Error(`Unexpected packaged ONNX runtime: ${runtime || 'missing'}`))
        return
      }

      process.stdout.write(
        `${JSON.stringify({
          patch,
          modelSmokeMode: smokeSelection.mode,
          currentPatchModelReleaseEligible: smokeSelection.currentPatchModelReleaseEligible,
          runtime,
          supportedBackends: message.supportedBackends,
          nativeRuntime
        })}\n`
      )
      clearTimeout(timeout)
      child.kill()
      resolve()
    })

    child.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout)
        reject(new Error(`Packaged ONNX worker exited before ready (code ${code})`))
      }
    })

    child.postMessage({
      type: 'initialize',
      protocolVersion: '1.0.0',
      runtimePaths: {},
      modelManifest: {
        'champion-icon-onnx': {
          ...runtimeDescriptor,
          path: path.join(smokeModelRoot, file)
        }
      }
    })
  })
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`)
    process.exitCode = 1
  })
  .finally(() => app.quit())
