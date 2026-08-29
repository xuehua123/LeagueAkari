const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const packageRoot = path.resolve(__dirname, '..')
const stageRoot = fs.mkdtempSync(path.join(packageRoot, '.native-build-stage-'))
const stagedAddons = path.join(stageRoot, 'addons')
const stagedDist = path.join(stageRoot, 'dist')
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function listFilesRecursively(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Native build output contains a symbolic link: ${entryPath}`)
    }
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(entryPath))
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Native build output contains an unsupported entry: ${entryPath}`)
    }
    files.push(entryPath)
  }
  return files
}

function writeRuntimeManifest(requiredAddons) {
  const runtimeFiles = [
    ...requiredAddons.map((file) => ({
      manifestPath: `addons/${file}`,
      filePath: path.join(stagedAddons, file)
    })),
    ...listFilesRecursively(stagedDist)
      .filter((filePath) => filePath.endsWith('.js'))
      .map((filePath) => ({
        manifestPath: `dist/${path.relative(stagedDist, filePath).split(path.sep).join('/')}`,
        filePath
      })),
    {
      manifestPath: 'package.json',
      filePath: path.join(packageRoot, 'package.json')
    }
  ]
  const files = runtimeFiles
    .map(({ manifestPath, filePath }) => ({
      path: manifestPath,
      size: fs.statSync(filePath).size,
      sha256: sha256File(filePath)
    }))
    .sort((left, right) => left.path.localeCompare(right.path))

  if (!files.some((entry) => entry.path === 'dist/index.js')) {
    throw new Error('Native build did not produce the dist/index.js runtime entry point')
  }

  fs.writeFileSync(
    path.join(stagedDist, 'runtime-manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        component: packageJson.name,
        version: packageJson.version,
        liveCoachProtocolVersion: '1.0.0',
        platform: 'win32-x64',
        license: packageJson.license,
        files
      },
      null,
      2
    )}\n`
  )
}

function replaceBuildOutputs() {
  const replacements = [
    { staged: stagedAddons, target: path.join(packageRoot, 'addons') },
    { staged: stagedDist, target: path.join(packageRoot, 'dist') }
  ].map((entry) => ({
    ...entry,
    backup: `${entry.target}.backup-${process.pid}`,
    installed: false,
    backedUp: false
  }))

  try {
    for (const entry of replacements) {
      fs.rmSync(entry.backup, { force: true, recursive: true })
      if (fs.existsSync(entry.target)) {
        fs.renameSync(entry.target, entry.backup)
        entry.backedUp = true
      }
    }
    for (const entry of replacements) {
      fs.renameSync(entry.staged, entry.target)
      entry.installed = true
    }
    for (const entry of replacements) {
      fs.rmSync(entry.backup, { force: true, recursive: true })
    }
  } catch (error) {
    for (const entry of replacements.slice().reverse()) {
      if (entry.installed && fs.existsSync(entry.target)) {
        fs.rmSync(entry.target, { force: true, recursive: true })
      }
      if (entry.backedUp && fs.existsSync(entry.backup)) {
        fs.renameSync(entry.backup, entry.target)
      }
    }
    throw error
  }
}

try {
  // Build and validate every artifact before replacing the last known-good checked-in outputs.
  execFileSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild'], {
    cwd: packageRoot,
    stdio: 'inherit'
  })

  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '--noEmit',
      '--composite',
      'false',
      '-p',
      'tsconfig.json'
    ],
    {
      cwd: packageRoot,
      stdio: 'inherit'
    }
  )

  fs.mkdirSync(stagedAddons)
  const releaseDir = path.join(packageRoot, 'build/Release')
  const addonFiles = fs.readdirSync(releaseDir).filter((file) => file.endsWith('.node'))
  const requiredAddons = [
    'akari-input-win64.node',
    'akari-capture-win64.node',
    'akari-tools-win64.node',
    'akari-speech-win64.node'
  ]
  for (const required of requiredAddons) {
    if (!addonFiles.includes(required)) {
      throw new Error(`Native build did not produce required addon: ${required}`)
    }
  }
  const unexpectedAddons = addonFiles.filter((file) => !requiredAddons.includes(file))
  if (unexpectedAddons.length > 0) {
    throw new Error(`Native build produced unexpected addons: ${unexpectedAddons.join(', ')}`)
  }
  for (const file of requiredAddons) {
    fs.copyFileSync(path.join(releaseDir, file), path.join(stagedAddons, file))
  }

  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '-p',
      'tsconfig.json',
      '--outDir',
      stagedDist,
      '--tsBuildInfoFile',
      path.join(stagedDist, 'tsconfig.tsbuildinfo')
    ],
    {
      cwd: packageRoot,
      stdio: 'inherit'
    }
  )

  writeRuntimeManifest(requiredAddons)

  replaceBuildOutputs()
} finally {
  fs.rmSync(stageRoot, { force: true, recursive: true })
}
