import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import ts from 'typescript'

const { claimsReleaseEligibility, hasAcceptedCurrentPatchModel, isBootstrapModel } = createRequire(
  import.meta.url
)('./live-coach-model-release-gate.cjs')

const FUSE_DISABLED = '0'.charCodeAt(0)
const FUSE_ENABLED = '1'.charCodeAt(0)

function loadReleaseResolver() {
  const sourcePath = path.resolve(
    'src',
    'main',
    'shards',
    'minimap-observer',
    'champion-identity-model.ts'
  )
  const source = fs.readFileSync(sourcePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: sourcePath,
    reportDiagnostics: true
  })
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  )
  if (errors.length > 0) {
    throw new Error(
      `Could not load the release model resolver: ${errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('; ')}`
    )
  }

  const loadedModule = { exports: {} }
  const requireFromSource = createRequire(sourcePath)
  const execute = new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    transpiled.outputText
  )
  execute(
    requireFromSource,
    loadedModule,
    loadedModule.exports,
    sourcePath,
    path.dirname(sourcePath)
  )
  return loadedModule.exports.resolveChampionIdentityModelFromRoots
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function assertSameFile(sourcePath, packagedPath, label) {
  assert(fs.existsSync(sourcePath), `Source ${label} is missing: ${sourcePath}`)
  assert(fs.existsSync(packagedPath), `Packaged ${label} is missing: ${packagedPath}`)
  assert(
    fs.readFileSync(sourcePath).equals(fs.readFileSync(packagedPath)),
    `Packaged ${label} does not match the build input`
  )
}

function listFilesRecursively(root, directory = root) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Runtime contains an unsupported symbolic link: ${entry.name}`)
    }
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(root, entryPath))
      continue
    }
    assert(entry.isFile(), `Runtime contains an unsupported filesystem entry: ${entry.name}`)
    files.push(path.relative(root, entryPath).split(path.sep).join('/'))
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function verifyRuntimeManifest({
  root,
  manifestPath,
  component,
  platform,
  license,
  requiredFiles,
  runtimeFilePredicate
}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert(manifest.schemaVersion === 1, `${component} runtime manifest schema must be 1`)
  assert(manifest.component === component, `${component} runtime manifest component mismatch`)
  assert(
    manifest.liveCoachProtocolVersion === '1.0.0',
    `${component} is not compatible with Live Coach protocol 1.0.0`
  )
  assert(manifest.platform === platform, `${component} runtime platform mismatch`)
  assert(manifest.license === license, `${component} runtime license metadata mismatch`)
  assert(
    typeof manifest.version === 'string' && manifest.version.length > 0,
    `${component} runtime version is missing`
  )
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, `${component} has no files`)

  const paths = new Set()
  for (const entry of manifest.files) {
    assert(entry && typeof entry.path === 'string', `${component} contains an invalid file entry`)
    assert(
      entry.path.length > 0 &&
        !path.isAbsolute(entry.path) &&
        !entry.path.includes('\\') &&
        path.posix.normalize(entry.path) === entry.path &&
        !entry.path.split('/').some((segment) => segment === '.' || segment === '..'),
      `${component} contains an unsafe file entry`
    )
    const filePath = path.resolve(root, entry.path)
    assert(
      filePath.startsWith(`${path.resolve(root)}${path.sep}`),
      `${component} contains a path-traversal file entry`
    )
    assert(!paths.has(entry.path), `${component} contains a duplicate file entry: ${entry.path}`)
    paths.add(entry.path)
    assert(
      Number.isSafeInteger(entry.size) && entry.size > 0,
      `${component} contains an invalid file size: ${entry.path}`
    )
    assert(
      fs.existsSync(filePath) && fs.lstatSync(filePath).isFile(),
      `${component} file is missing`
    )
    assert(
      fs.statSync(filePath).size === entry.size,
      `${component} file size mismatch: ${entry.path}`
    )
    assert(
      /^[a-f\d]{64}$/i.test(entry.sha256) &&
        sha256File(filePath).toLowerCase() === entry.sha256.toLowerCase(),
      `${component} file hash mismatch: ${entry.path}`
    )
  }
  for (const requiredFile of requiredFiles) {
    assert(paths.has(requiredFile), `${component} manifest is missing ${requiredFile}`)
  }
  const packagedRuntimeFiles = listFilesRecursively(root).filter(runtimeFilePredicate)
  assert(
    packagedRuntimeFiles.length === paths.size &&
      packagedRuntimeFiles.every((file) => paths.has(file)),
    `${component} packaged runtime file set is not exactly covered by its hash manifest`
  )
  return manifest
}

function assertPinnedRuntimeFiles(actualFiles, pinnedFiles, component) {
  assert(Array.isArray(pinnedFiles) && pinnedFiles.length > 0, `${component} has no pinned files`)
  const actualByPath = new Map(actualFiles.map((entry) => [entry.path, entry]))
  const pinnedByPath = new Map(pinnedFiles.map((entry) => [entry?.path, entry]))
  assert(
    pinnedByPath.size === pinnedFiles.length,
    `${component} contains duplicate pinned runtime paths`
  )
  assert(
    actualByPath.size === pinnedByPath.size &&
      [...actualByPath.keys()].every((file) => pinnedByPath.has(file)),
    `${component} pinned runtime file count does not match`
  )
  for (const [file, pinned] of pinnedByPath) {
    const actual = actualByPath.get(file)
    assert(actual, `${component} pinned runtime file is missing: ${file || 'invalid'}`)
    assert(
      actual.size === pinned.size && actual.sha256.toLowerCase() === pinned.sha256?.toLowerCase(),
      `${component} pinned runtime metadata mismatch: ${file}`
    )
  }
}

function verifyExecutable(executablePath, expectedVersion, label) {
  const result = spawnSync(executablePath, ['-hide_banner', '-version'], {
    encoding: 'utf8',
    timeout: 20_000,
    windowsHide: true
  })
  assert(!result.error, `${label} failed to start: ${result.error?.message}`)
  assert(result.status === 0, `${label} exited with status ${result.status}`)
  assert(
    `${result.stdout || ''}${result.stderr || ''}`.includes(expectedVersion),
    `${label} did not report pinned version ${expectedVersion}`
  )
}

const cliArguments = process.argv.slice(2)
const requireAcceptedModel =
  cliArguments.includes('--require-accepted-model') ||
  process.env.LIVE_COACH_REQUIRE_ACCEPTED_MODEL === '1'
const positionalArguments = cliArguments.filter((argument) => !argument.startsWith('--'))
const unknownOptions = cliArguments.filter(
  (argument) => argument.startsWith('--') && argument !== '--require-accepted-model'
)
assert(unknownOptions.length === 0, `Unknown smoke options: ${unknownOptions.join(', ')}`)
assert(positionalArguments.length <= 1, 'Packaged runtime smoke accepts at most one app directory')
const appOutDir = path.resolve(positionalArguments[0] || path.join('dist', 'win-unpacked'))
const appAsarPath = path.join(appOutDir, 'resources', 'app.asar')
const packagedExecutablePath = path.join(appOutDir, 'LeagueAkari.exe')
const packagedModelRoot = path.join(
  appOutDir,
  'resources',
  'app.asar.unpacked',
  'resources',
  'live-coach',
  'models'
)
const sourceModelRoot = path.resolve('resources', 'live-coach', 'models')
const sourceManifestPath = path.join(sourceModelRoot, 'manifest.json')
const packagedManifestPath = path.join(packagedModelRoot, 'manifest.json')
const sourceFfmpegRoot = path.resolve('resources', 'live-coach', 'ffmpeg', 'runtime')
const sourceFfmpegArtifactManifest = JSON.parse(
  fs.readFileSync(path.resolve('resources', 'live-coach', 'ffmpeg', 'manifest.json'), 'utf8')
)
const packagedFfmpegRoot = path.join(appOutDir, 'resources', 'live-coach', 'ffmpeg', 'runtime')
const sourceNativeRoot = path.resolve('native', 'win32-x64')
const sourceNativePackage = JSON.parse(
  fs.readFileSync(path.join(sourceNativeRoot, 'package.json'), 'utf8')
)
const sourceNativeManifestPath = path.join(sourceNativeRoot, 'dist', 'runtime-manifest.json')
const sourceNativeManifest = JSON.parse(fs.readFileSync(sourceNativeManifestPath, 'utf8'))
const packagedNativeRoot = path.join(
  appOutDir,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'league-akari-native-win32'
)
const packagedNativePackagePath = path.join(packagedNativeRoot, 'package.json')
const trustedOnnxManifest = JSON.parse(
  fs.readFileSync(path.resolve('resources', 'live-coach', 'onnx-runtime', 'manifest.json'), 'utf8')
)
const packagedOnnxPackageRoot = path.join(
  appOutDir,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'onnxruntime-node'
)

const resolveChampionIdentityModelFromRoots = loadReleaseResolver()
assert(
  typeof resolveChampionIdentityModelFromRoots === 'function',
  'Release model resolver could not be loaded'
)
assert(fs.existsSync(packagedExecutablePath), 'Packaged LeagueAkari.exe is missing')
const packagedFuseWire = await getCurrentFuseWire(packagedExecutablePath)
const packagedFuseIndexes = Object.keys(packagedFuseWire)
  .filter((key) => /^\d+$/.test(key))
  .map(Number)
  .sort((a, b) => a - b)
assert(
  packagedFuseWire.version === '1' &&
    packagedFuseIndexes.length === FuseV1Options.WasmTrapHandlers + 1 &&
    packagedFuseIndexes.every((index, position) => index === position),
  `Unexpected Electron fuse schema: expected V1 indexes 0-${FuseV1Options.WasmTrapHandlers}, received ${packagedFuseIndexes.join(',')}`
)
for (const [option, expectedState, label] of [
  [FuseV1Options.RunAsNode, FUSE_DISABLED, 'RunAsNode'],
  [FuseV1Options.EnableCookieEncryption, FUSE_DISABLED, 'EnableCookieEncryption'],
  [
    FuseV1Options.EnableNodeOptionsEnvironmentVariable,
    FUSE_DISABLED,
    'EnableNodeOptionsEnvironmentVariable'
  ],
  [FuseV1Options.EnableNodeCliInspectArguments, FUSE_DISABLED, 'EnableNodeCliInspectArguments'],
  [
    FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
    FUSE_ENABLED,
    'EnableEmbeddedAsarIntegrityValidation'
  ],
  [FuseV1Options.OnlyLoadAppFromAsar, FUSE_ENABLED, 'OnlyLoadAppFromAsar'],
  [
    FuseV1Options.LoadBrowserProcessSpecificV8Snapshot,
    FUSE_DISABLED,
    'LoadBrowserProcessSpecificV8Snapshot'
  ],
  [
    FuseV1Options.GrantFileProtocolExtraPrivileges,
    FUSE_ENABLED,
    'GrantFileProtocolExtraPrivileges'
  ],
  [FuseV1Options.WasmTrapHandlers, FUSE_ENABLED, 'WasmTrapHandlers']
]) {
  assert(packagedFuseWire[option] === expectedState, `Unsafe packaged Electron fuse: ${label}`)
}
assert(fs.existsSync(sourceManifestPath), `Source model manifest is missing: ${sourceManifestPath}`)
const sourceManifestBytes = fs.readFileSync(sourceManifestPath)
const manifest = JSON.parse(sourceManifestBytes.toString('utf8'))
assert(manifest.schemaVersion === 2, 'Source model manifest must use schema version 2')
assert(
  typeof manifest.releasePatch === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.releasePatch),
  'Source model manifest must declare the current releasePatch'
)
assert(
  manifest.models && typeof manifest.models === 'object' && !Array.isArray(manifest.models),
  'Source model manifest must contain a models object'
)
for (const [patch, entry] of Object.entries(manifest.models)) {
  if (!isBootstrapModel(entry)) continue
  assert(
    !resolveChampionIdentityModelFromRoots(patch, [sourceModelRoot]),
    `Bootstrap model bypassed the release validation gate for patch ${patch}`
  )
}

assert(fs.existsSync(appAsarPath), `Packaged app.asar is missing: ${appAsarPath}`)
assert(
  fs.existsSync(packagedManifestPath),
  `Packaged model manifest is missing: ${packagedManifestPath}`
)

const packagedManifestBytes = fs.readFileSync(packagedManifestPath)
assert(
  sourceManifestBytes.equals(packagedManifestBytes),
  'Packaged model manifest does not match the source manifest'
)

const bootstrapArtifacts = new Set(
  fs.readdirSync(sourceModelRoot).filter((file) => /^champion-icons-.*\.json$/i.test(file))
)
for (const entry of Object.values(manifest.models)) {
  if (isBootstrapModel(entry) && typeof entry.file === 'string') {
    bootstrapArtifacts.add(entry.file)
  }
}
for (const file of bootstrapArtifacts) {
  assert(
    !fs.existsSync(path.join(packagedModelRoot, file)),
    `Bootstrap artifact was packaged: ${file}`
  )
}

let acceptedModelCount = 0
let rejectedModelCount = 0
const acceptedModelPatches = []
for (const [patch, entry] of Object.entries(manifest.models)) {
  const resolved = resolveChampionIdentityModelFromRoots(patch, [packagedModelRoot])
  const claimsRelease = claimsReleaseEligibility(entry)

  if (claimsRelease) {
    assert(
      entry.workerProtocolVersion === '1.0.0',
      `Accepted model has an incompatible worker protocol for patch ${patch}`
    )
    assert(
      entry.license?.status === 'approved' && entry.license.identifier,
      `Accepted model is missing approved license metadata for patch ${patch}`
    )
    assert(resolved, `Accepted model is not release-resolvable for patch ${patch}`)
    assert(
      resolved.path.startsWith(`${packagedModelRoot}${path.sep}`),
      `Accepted model resolved outside the packaged model root for patch ${patch}`
    )
    acceptedModelCount += 1
    acceptedModelPatches.push(patch)
  } else {
    assert(!resolved, `Non-release model resolved for patch ${patch}`)
    rejectedModelCount += 1
  }
}
const currentPatchModelReleaseEligible = hasAcceptedCurrentPatchModel(
  manifest.releasePatch,
  acceptedModelPatches
)
if (requireAcceptedModel) {
  assert(
    currentPatchModelReleaseEligible,
    `Official release requires an accepted, packaged model for current patch ${manifest.releasePatch}`
  )
}

const sourceFfmpegManifestPath = path.join(sourceFfmpegRoot, 'runtime-manifest.json')
const packagedFfmpegManifestPath = path.join(packagedFfmpegRoot, 'runtime-manifest.json')
assertSameFile(sourceFfmpegManifestPath, packagedFfmpegManifestPath, 'FFmpeg runtime manifest')
const ffmpegManifest = verifyRuntimeManifest({
  root: packagedFfmpegRoot,
  manifestPath: packagedFfmpegManifestPath,
  component: 'ffmpeg',
  platform: 'win32-x64',
  license: 'LGPL-3.0-or-later',
  requiredFiles: sourceFfmpegArtifactManifest.runtimeFiles.map((entry) => entry.path),
  runtimeFilePredicate: (file) => !['.artifact-sha256', 'runtime-manifest.json'].includes(file)
})
assertPinnedRuntimeFiles(ffmpegManifest.files, sourceFfmpegArtifactManifest.runtimeFiles, 'ffmpeg')
assert(ffmpegManifest.version === sourceFfmpegArtifactManifest.version, 'FFmpeg version mismatch')
assert(
  ffmpegManifest.variant === sourceFfmpegArtifactManifest.variant,
  'FFmpeg distribution variant mismatch'
)
assert(
  ffmpegManifest.archiveSha256 === sourceFfmpegArtifactManifest.sha256,
  'FFmpeg source archive hash mismatch'
)
assert(
  fs.readFileSync(path.join(packagedFfmpegRoot, '.artifact-sha256'), 'utf8').trim() ===
    sourceFfmpegArtifactManifest.sha256,
  'FFmpeg source archive marker mismatch'
)
assert(
  ffmpegManifest.files.some((entry) => entry.path.toLowerCase().endsWith('.dll')),
  'FFmpeg runtime manifest does not contain shared-library DLLs'
)
verifyExecutable(path.join(packagedFfmpegRoot, 'ffmpeg.exe'), ffmpegManifest.version, 'FFmpeg')
verifyExecutable(path.join(packagedFfmpegRoot, 'ffprobe.exe'), ffmpegManifest.version, 'FFprobe')

const packagedNativeManifestPath = path.join(packagedNativeRoot, 'dist', 'runtime-manifest.json')
assert(
  sourceNativeManifest.schemaVersion === 1 &&
    sourceNativeManifest.component === 'league-akari-native-win32' &&
    sourceNativeManifest.version === sourceNativePackage.version &&
    sourceNativeManifest.liveCoachProtocolVersion === '1.0.0' &&
    sourceNativeManifest.platform === 'win32-x64' &&
    sourceNativeManifest.license === 'MIT' &&
    Array.isArray(sourceNativeManifest.files) &&
    sourceNativeManifest.files.length > 0,
  'Source native runtime pins have invalid metadata'
)
assert(
  Object.keys(sourceNativeManifest).sort().join(',') ===
    [
      'component',
      'files',
      'license',
      'liveCoachProtocolVersion',
      'platform',
      'schemaVersion',
      'version'
    ].join(','),
  'Source native runtime pins have unsupported metadata fields'
)
for (const entry of sourceNativeManifest.files) {
  assert(
    entry &&
      Object.keys(entry).sort().join(',') === 'path,sha256,size' &&
      typeof entry.path === 'string' &&
      (entry.path === 'package.json' ||
        (entry.path.startsWith('addons/') && entry.path.toLowerCase().endsWith('.node')) ||
        (entry.path.startsWith('dist/') && entry.path.toLowerCase().endsWith('.js'))) &&
      Number.isSafeInteger(entry.size) &&
      entry.size > 0 &&
      /^[a-f\d]{64}$/.test(entry.sha256),
    'Source native runtime contains an invalid file pin'
  )
}
const nativeManifest = verifyRuntimeManifest({
  root: packagedNativeRoot,
  manifestPath: packagedNativeManifestPath,
  component: 'league-akari-native-win32',
  platform: 'win32-x64',
  license: 'MIT',
  requiredFiles: sourceNativeManifest.files.map((entry) => entry.path),
  runtimeFilePredicate: (file) =>
    file === 'package.json' ||
    (file.startsWith('addons/') && file.toLowerCase().endsWith('.node')) ||
    (file.startsWith('dist/') && file.toLowerCase().endsWith('.js'))
})
assertPinnedRuntimeFiles(nativeManifest.files, sourceNativeManifest.files, 'native runtime')
assertSameFile(sourceNativeManifestPath, packagedNativeManifestPath, 'native runtime manifest')
assert(nativeManifest.version === sourceNativePackage.version, 'Native runtime version mismatch')
assert(fs.existsSync(packagedNativePackagePath), 'Packaged native package metadata is missing')
const packagedNativePackage = JSON.parse(fs.readFileSync(packagedNativePackagePath, 'utf8'))
assert(
  packagedNativePackage.name === sourceNativePackage.name &&
    packagedNativePackage.version === sourceNativePackage.version &&
    packagedNativePackage.license === sourceNativePackage.license,
  'Packaged native package name/version/license metadata mismatch'
)

assert(
  trustedOnnxManifest.schemaVersion === 1 &&
    trustedOnnxManifest.component === 'onnxruntime-node' &&
    trustedOnnxManifest.liveCoachProtocolVersion === '1.0.0' &&
    trustedOnnxManifest.license === 'MIT' &&
    trustedOnnxManifest.napiVersion === 6,
  'Trusted ONNX Runtime manifest metadata is invalid'
)
const pinnedOnnxFiles = trustedOnnxManifest.platforms?.['win32-x64']
assert(Array.isArray(pinnedOnnxFiles) && pinnedOnnxFiles.length > 0, 'ONNX Runtime pins missing')
const packagedOnnxRuntimeRoot = path.join(
  packagedOnnxPackageRoot,
  'bin',
  `napi-v${trustedOnnxManifest.napiVersion}`,
  'win32',
  'x64'
)
const packagedOnnxFiles = listFilesRecursively(packagedOnnxRuntimeRoot).map((file) => {
  const filePath = path.join(packagedOnnxRuntimeRoot, file)
  return { path: file, size: fs.statSync(filePath).size, sha256: sha256File(filePath) }
})
assertPinnedRuntimeFiles(packagedOnnxFiles, pinnedOnnxFiles, 'onnxruntime-node')
const packagedOnnxPackage = JSON.parse(
  fs.readFileSync(path.join(packagedOnnxPackageRoot, 'package.json'), 'utf8')
)
assert(
  packagedOnnxPackage.name === trustedOnnxManifest.component &&
    packagedOnnxPackage.version === trustedOnnxManifest.version &&
    packagedOnnxPackage.license === trustedOnnxManifest.license,
  'Packaged ONNX Runtime package metadata does not match the trusted manifest'
)

process.stdout.write(
  `${JSON.stringify({
    packagedManifest: packagedManifestPath,
    acceptedModelCount,
    acceptedModelPatches,
    rejectedModelCount,
    modelReleaseGate: {
      required: requireAcceptedModel,
      releasePatch: manifest.releasePatch,
      currentPatchModelReleaseEligible,
      mode: currentPatchModelReleaseEligible ? 'accepted-model' : 'transport-only'
    },
    bootstrapArtifacts: [...bootstrapArtifacts],
    ffmpeg: { version: ffmpegManifest.version, files: ffmpegManifest.files.length },
    native: { version: nativeManifest.version, files: nativeManifest.files.length }
  })}\n`
)
