import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')

export function parseArchiveSmokeArguments(arguments_) {
  let archivePath
  let requireAcceptedModel = false

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--require-accepted-model') {
      requireAcceptedModel = true
      continue
    }
    if (argument === '--archive') {
      const value = arguments_[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--archive requires a path')
      if (archivePath) throw new Error('--archive may only be specified once')
      archivePath = value
      index += 1
      continue
    }
    throw new Error(`Unknown archive smoke option: ${argument}`)
  }

  return { archivePath, requireAcceptedModel }
}

export function resolveArchivePath(archiveOption, rootDirectory = projectRoot) {
  if (archiveOption) return path.resolve(rootDirectory, archiveOption)

  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDirectory, 'package.json'), 'utf8'))
  return path.join(
    rootDirectory,
    'dist',
    `${packageJson.productName ?? 'League Akari'}-${packageJson.version}-win.7z`
  )
}

export function smokePackagedWindowsArchive(arguments_ = process.argv.slice(2)) {
  const { archivePath: archiveOption, requireAcceptedModel } =
    parseArchiveSmokeArguments(arguments_)
  const archivePath = resolveArchivePath(archiveOption)
  const require = createRequire(import.meta.url)
  const electronExecutable = require('electron')

  if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
    throw new Error(`Final Windows archive is missing: ${path.basename(archivePath)}`)
  }

  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'league-akari-final-archive-'))
  try {
    run('tar', ['-xf', archivePath, '-C', extractionRoot], 'extract final Windows archive')
    if (!fs.existsSync(path.join(extractionRoot, 'LeagueAkari.exe'))) {
      throw new Error('Final Windows archive has an unexpected root layout')
    }

    const releaseFlag = requireAcceptedModel ? ['--require-accepted-model'] : []
    run(
      process.execPath,
      [
        path.join(projectRoot, 'scripts', 'smoke-packaged-model-gate.mjs'),
        extractionRoot,
        ...releaseFlag
      ],
      'verify final Windows archive transport'
    )
    run(
      electronExecutable,
      [
        path.join(projectRoot, 'scripts', 'smoke-packaged-onnx-electron.cjs'),
        extractionRoot,
        ...releaseFlag
      ],
      'verify final Windows archive Electron runtime'
    )
  } finally {
    fs.rmSync(extractionRoot, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 250
    })
  }

  process.stdout.write(`Final Windows archive smoke passed: ${path.basename(archivePath)}\n`)
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) smokePackagedWindowsArchive()

function run(command, arguments_, label) {
  const result = spawnSync(command, arguments_, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 120_000,
    windowsHide: true
  })
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${label} exited with status ${result.status}`)
}
