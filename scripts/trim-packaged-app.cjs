const fs = require('node:fs')
const path = require('node:path')

const PACKAGED_APP_REMOVALS = [
  path.join('resources', 'app.asar.unpacked', 'node_modules', 'league-akari-native-win32', 'src'),
  path.join(
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'league-akari-native-win32',
    'dist',
    'tsconfig.tsbuildinfo'
  )
]

const ONNX_RUNTIME_PLATFORM_DIRECTORIES = ['darwin', 'linux', 'win32']
const ELECTRON_BUILDER_ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
}

function resolveOnnxRuntimeRemovals(context) {
  const platform = context.electronPlatformName
  const targetArch = ELECTRON_BUILDER_ARCH_NAMES[context.arch]
  const binaryRoot = path.join(
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6'
  )
  const removals = ONNX_RUNTIME_PLATFORM_DIRECTORIES.filter(
    (candidate) => candidate !== platform
  ).map((candidate) => path.join(binaryRoot, candidate))

  if (targetArch && targetArch !== 'universal') {
    const platformRoot = path.join(context.appOutDir, binaryRoot, platform)
    if (fs.existsSync(platformRoot)) {
      for (const entry of fs.readdirSync(platformRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== targetArch) {
          removals.push(path.join(binaryRoot, platform, entry.name))
        }
      }
    }
  }

  return removals
}

module.exports = async function trimPackagedApp(context) {
  for (const relativePath of [...PACKAGED_APP_REMOVALS, ...resolveOnnxRuntimeRemovals(context)]) {
    fs.rmSync(path.join(context.appOutDir, relativePath), {
      force: true,
      recursive: true
    })
  }
}
