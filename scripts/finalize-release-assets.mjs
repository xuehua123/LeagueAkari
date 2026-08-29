import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE_EXTENSIONS = Object.freeze({
  mac: new Set(['.dmg', '.zip']),
  windows: new Set(['.7z', '.exe'])
})

export function finalizeReleaseAssets(distDirectory, releaseAssetPrefix) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(releaseAssetPrefix ?? '')) {
    throw new Error(`Invalid release asset prefix: ${releaseAssetPrefix || '(empty)'}`)
  }

  const platform = releaseAssetPrefix.includes('-win-')
    ? 'windows'
    : releaseAssetPrefix.includes('-mac-')
      ? 'mac'
      : null
  if (!platform) {
    throw new Error(`Release asset prefix has no supported platform: ${releaseAssetPrefix}`)
  }
  const packageExtensions = RELEASE_EXTENSIONS[platform]
  const absoluteDistDirectory = path.resolve(distDirectory)
  const filesByExtension = new Map()

  for (const entry of fs.readdirSync(absoluteDistDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith('.blockmap')) continue

    const extension = path.extname(entry.name).toLowerCase()
    if (!packageExtensions.has(extension)) continue
    if (filesByExtension.has(extension)) {
      throw new Error(`Multiple ${extension} artifacts found in ${absoluteDistDirectory}`)
    }
    filesByExtension.set(extension, entry.name)
  }

  if (!filesByExtension.size) {
    throw new Error(`No release artifacts found for ${releaseAssetPrefix}`)
  }
  if (platform === 'windows' && !filesByExtension.has('.7z')) {
    throw new Error('The final Windows 7z archive is missing')
  }

  const finalizedFiles = []
  for (const [extension, sourceName] of [...filesByExtension].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const targetName = `${releaseAssetPrefix}${extension}`
    const sourcePath = path.join(absoluteDistDirectory, sourceName)
    const targetPath = path.join(absoluteDistDirectory, targetName)

    if (sourcePath !== targetPath) fs.renameSync(sourcePath, targetPath)
    finalizedFiles.push(targetName)
    process.stdout.write(`${sourceName} -> ${targetName}\n`)
  }

  const checksumName = `${releaseAssetPrefix}-SHA256SUMS.txt`
  const checksumPath = path.join(absoluteDistDirectory, checksumName)
  const checksumContents = finalizedFiles
    .sort((left, right) => left.localeCompare(right))
    .map((name) => `${sha256File(path.join(absoluteDistDirectory, name))}  ${name}`)
    .join('\n')
  const temporaryChecksumPath = `${checksumPath}.tmp`
  fs.writeFileSync(temporaryChecksumPath, `${checksumContents}\n`, {
    encoding: 'utf8',
    mode: 0o644
  })
  fs.rmSync(checksumPath, { force: true })
  fs.renameSync(temporaryChecksumPath, checksumPath)
  process.stdout.write(`SHA-256 manifest -> ${checksumName}\n`)

  return { checksumPath, finalizedFiles }
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const [distDirectory, releaseAssetPrefix, ...unexpected] = process.argv.slice(2)
  if (!distDirectory || !releaseAssetPrefix || unexpected.length > 0) {
    throw new Error(
      'Usage: node scripts/finalize-release-assets.mjs <dist-directory> <release-asset-prefix>'
    )
  }
  finalizeReleaseAssets(distDirectory, releaseAssetPrefix)
}
