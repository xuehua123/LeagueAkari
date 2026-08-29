import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import trustedManifestSource from '../../../native/win32-x64/dist/runtime-manifest.json'

const NATIVE_COMPONENT = 'league-akari-native-win32'
const NATIVE_PROTOCOL_VERSION = '1.0.0'
const NATIVE_PLATFORM = 'win32-x64'
const NATIVE_LICENSE = 'MIT'
const NATIVE_ENTRY_PATH = 'dist/index.js'
const RUNTIME_MANIFEST_PATH = 'dist/runtime-manifest.json'
const REQUIRED_ADDONS = [
  'addons/akari-capture-win64.node',
  'addons/akari-input-win64.node',
  'addons/akari-speech-win64.node',
  'addons/akari-tools-win64.node'
] as const

interface NativeRuntimeFilePin {
  path: string
  size: number
  sha256: string
}

interface NativeRuntimeManifest {
  schemaVersion: 1
  component: typeof NATIVE_COMPONENT
  version: string
  liveCoachProtocolVersion: typeof NATIVE_PROTOCOL_VERSION
  platform: typeof NATIVE_PLATFORM
  license: typeof NATIVE_LICENSE
  files: NativeRuntimeFilePin[]
}

interface CachedRuntimeVerification {
  metadataByPath: Map<string, string>
  entryPath: string
}

export interface TrustedNativeRuntimeResolutionOptions {
  isPackaged?: boolean
  resourcesPath?: string
  moduleDirectory?: string
  workingDirectory?: string
}

export interface TrustedNativeRuntimeLoadOptions extends TrustedNativeRuntimeResolutionOptions {
  runtimeRoot?: string
  moduleLoader?: (entryPath: string) => unknown
}

const verificationCache = new Map<string, CachedRuntimeVerification>()

function fail(message: string): never {
  throw new Error(`Untrusted Windows native runtime: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string
) {
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    fail(`${label} has unsupported fields`)
  }
}

function parseManifest(value: unknown, label: string): NativeRuntimeManifest {
  if (!isRecord(value)) fail(`${label} must be an object`)
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'component',
      'version',
      'liveCoachProtocolVersion',
      'platform',
      'license',
      'files'
    ],
    label
  )
  if (value.schemaVersion !== 1) fail(`${label} schemaVersion must be 1`)
  if (value.component !== NATIVE_COMPONENT) fail(`${label} component is invalid`)
  if (typeof value.version !== 'string' || value.version.length === 0) {
    fail(`${label} version is invalid`)
  }
  if (value.liveCoachProtocolVersion !== NATIVE_PROTOCOL_VERSION) {
    fail(`${label} protocol version is incompatible`)
  }
  if (value.platform !== NATIVE_PLATFORM) fail(`${label} platform is invalid`)
  if (value.license !== NATIVE_LICENSE) fail(`${label} license is invalid`)
  if (!Array.isArray(value.files) || value.files.length === 0) {
    fail(`${label} files must be a non-empty array`)
  }

  const files: NativeRuntimeFilePin[] = []
  const seenPaths = new Set<string>()
  for (const [index, file] of value.files.entries()) {
    if (!isRecord(file)) fail(`${label} file ${index} must be an object`)
    assertExactKeys(file, ['path', 'size', 'sha256'], `${label} file ${index}`)
    if (
      typeof file.path !== 'string' ||
      file.path.length === 0 ||
      path.posix.isAbsolute(file.path) ||
      file.path.includes('\\') ||
      path.posix.normalize(file.path) !== file.path ||
      file.path.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      fail(`${label} contains an unsafe path`)
    }
    if (seenPaths.has(file.path)) fail(`${label} contains a duplicate path: ${file.path}`)
    if (!Number.isSafeInteger(file.size) || (file.size as number) <= 0) {
      fail(`${label} contains an invalid size: ${file.path}`)
    }
    if (typeof file.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(file.sha256)) {
      fail(`${label} contains an invalid SHA-256: ${file.path}`)
    }
    seenPaths.add(file.path)
    files.push({ path: file.path, size: file.size as number, sha256: file.sha256 })
  }

  const expectedCategories = files.every(
    (file) =>
      file.path === 'package.json' ||
      (file.path.startsWith('addons/') && file.path.toLowerCase().endsWith('.node')) ||
      (file.path.startsWith('dist/') && file.path.toLowerCase().endsWith('.js'))
  )
  if (!expectedCategories) fail(`${label} contains an unsupported runtime path`)
  const addonPaths = files
    .filter((file) => file.path.startsWith('addons/'))
    .map((file) => file.path)
    .sort()
  if (
    addonPaths.length !== REQUIRED_ADDONS.length ||
    addonPaths.some((file, index) => file !== [...REQUIRED_ADDONS].sort()[index])
  ) {
    fail(`${label} does not pin the exact required addon set`)
  }
  if (!seenPaths.has('package.json') || !seenPaths.has(NATIVE_ENTRY_PATH)) {
    fail(`${label} is missing package.json or ${NATIVE_ENTRY_PATH}`)
  }

  return {
    schemaVersion: 1,
    component: NATIVE_COMPONENT,
    version: value.version,
    liveCoachProtocolVersion: NATIVE_PROTOCOL_VERSION,
    platform: NATIVE_PLATFORM,
    license: NATIVE_LICENSE,
    files
  }
}

const trustedManifest = parseManifest(trustedManifestSource, 'embedded runtime manifest')
const trustedManifestCanonical = JSON.stringify(trustedManifest)

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
}

function resolveRuntimeRoot(runtimeRoot: string, allowRootLink: boolean): string {
  const absoluteRoot = path.resolve(runtimeRoot)
  let unresolvedRootStat: fs.Stats
  try {
    unresolvedRootStat = fs.lstatSync(absoluteRoot)
  } catch {
    fail('runtime root is missing')
  }
  if (!allowRootLink && unresolvedRootStat.isSymbolicLink()) {
    fail('packaged runtime root cannot be a symbolic link or junction')
  }
  let resolvedRoot: string
  try {
    resolvedRoot = fs.realpathSync.native(absoluteRoot)
  } catch {
    fail('runtime root is missing')
  }
  if (!fs.statSync(resolvedRoot).isDirectory()) fail('runtime root is not a directory')
  return resolvedRoot
}

function getSafeFilePath(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split('/'))
  if (!isContainedPath(root, candidate)) fail(`path escapes runtime root: ${relativePath}`)
  let current = root
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(current)
    } catch {
      fail(`file is missing: ${relativePath}`)
    }
    if (stat.isSymbolicLink()) fail(`symbolic links are forbidden: ${relativePath}`)
  }
  const stat = fs.lstatSync(candidate)
  if (!stat.isFile()) fail(`runtime entry is not a file: ${relativePath}`)
  const realPath = fs.realpathSync.native(candidate)
  if (!isContainedPath(root, realPath)) fail(`file resolves outside runtime root: ${relativePath}`)
  return realPath
}

function listFilesRecursively(root: string, relativeDirectory: 'addons' | 'dist'): string[] {
  const directory = path.join(root, relativeDirectory)
  const directoryStat = fs.lstatSync(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    fail(`${relativeDirectory} is not a trusted directory`)
  }

  const files: string[] = []
  const visit = (absoluteDirectory: string, relativePrefix: string) => {
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const absolutePath = path.join(absoluteDirectory, entry.name)
      const relativePath = `${relativePrefix}/${entry.name}`
      const stat = fs.lstatSync(absolutePath)
      if (stat.isSymbolicLink()) fail(`symbolic links are forbidden: ${relativePath}`)
      if (stat.isDirectory()) {
        visit(absolutePath, relativePath)
        continue
      }
      if (!stat.isFile()) fail(`unsupported filesystem entry: ${relativePath}`)
      files.push(relativePath.split(path.sep).join('/'))
    }
  }
  visit(directory, relativeDirectory)
  return files.sort()
}

function metadataKey(filePath: string): string {
  const stat = fs.statSync(filePath, { bigint: true })
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function assertExactRuntimeFileSet(root: string, expectedPaths: readonly string[]) {
  const actualPaths = [
    'package.json',
    ...listFilesRecursively(root, 'addons').filter((file) => file.toLowerCase().endsWith('.node')),
    ...listFilesRecursively(root, 'dist').filter((file) => file.toLowerCase().endsWith('.js'))
  ].sort()
  const sortedExpectedPaths = [...expectedPaths].sort()
  if (
    actualPaths.length !== sortedExpectedPaths.length ||
    actualPaths.some((file, index) => file !== sortedExpectedPaths[index])
  ) {
    fail('runtime file set does not exactly match the embedded manifest')
  }
}

function assertPackageMetadata(packagePath: string) {
  let packageJson: unknown
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  } catch {
    fail('package.json is not valid JSON')
  }
  if (!isRecord(packageJson)) fail('package.json must be an object')
  if (
    packageJson.name !== trustedManifest.component ||
    packageJson.version !== trustedManifest.version ||
    packageJson.license !== trustedManifest.license ||
    packageJson.private !== true ||
    packageJson.main !== NATIVE_ENTRY_PATH ||
    packageJson.types !== 'dist/index.d.ts' ||
    !Array.isArray(packageJson.os) ||
    packageJson.os.length !== 1 ||
    packageJson.os[0] !== 'win32' ||
    !Array.isArray(packageJson.cpu) ||
    packageJson.cpu.length !== 1 ||
    packageJson.cpu[0] !== 'x64'
  ) {
    fail('package.json metadata does not match the trusted package contract')
  }
}

export function verifyTrustedNativeRuntime(
  runtimeRoot: string,
  options: { allowRootLink?: boolean } = {}
): {
  runtimeRoot: string
  entryPath: string
} {
  const root = resolveRuntimeRoot(runtimeRoot, options.allowRootLink ?? true)
  const expectedPaths = trustedManifest.files.map((file) => file.path)
  assertExactRuntimeFileSet(root, expectedPaths)

  const manifestPath = getSafeFilePath(root, RUNTIME_MANIFEST_PATH)
  let externalManifest: NativeRuntimeManifest
  try {
    externalManifest = parseManifest(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
      'runtime manifest'
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Untrusted Windows native runtime:')) {
      throw error
    }
    fail('runtime manifest is not valid JSON')
  }
  if (JSON.stringify(externalManifest) !== trustedManifestCanonical) {
    fail('runtime manifest does not match the embedded pins')
  }

  const filePaths = new Map<string, string>([
    [RUNTIME_MANIFEST_PATH, manifestPath],
    ...trustedManifest.files.map((pin) => [pin.path, getSafeFilePath(root, pin.path)] as const)
  ])
  const currentMetadata = new Map(
    [...filePaths].map(([relativePath, filePath]) => [relativePath, metadataKey(filePath)])
  )
  const cached = verificationCache.get(root)
  if (
    cached &&
    cached.metadataByPath.size === currentMetadata.size &&
    [...currentMetadata].every(([file, metadata]) => cached.metadataByPath.get(file) === metadata)
  ) {
    return { runtimeRoot: root, entryPath: cached.entryPath }
  }
  verificationCache.delete(root)

  for (const pin of trustedManifest.files) {
    const filePath = filePaths.get(pin.path)!
    const before = metadataKey(filePath)
    const stat = fs.statSync(filePath)
    if (stat.size !== pin.size || sha256File(filePath) !== pin.sha256) {
      fail(`file integrity mismatch: ${pin.path}`)
    }
    if (metadataKey(filePath) !== before) fail(`file changed during verification: ${pin.path}`)
  }
  assertPackageMetadata(filePaths.get('package.json')!)

  const entryPath = filePaths.get(NATIVE_ENTRY_PATH)!
  verificationCache.set(root, { metadataByPath: currentMetadata, entryPath })
  return { runtimeRoot: root, entryPath }
}

export function resolveTrustedNativeRuntimeRoot(
  options: TrustedNativeRuntimeResolutionOptions = {}
): string {
  const isPackaged =
    options.isPackaged ?? Boolean(process.versions.electron && process.defaultApp !== true)
  const resourcesPath = options.resourcesPath ?? process.resourcesPath
  if (isPackaged) {
    if (!resourcesPath) fail('packaged resources path is unavailable')
    return path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', NATIVE_COMPONENT)
  }

  const moduleDirectory = options.moduleDirectory ?? __dirname
  const workingDirectory = options.workingDirectory ?? process.cwd()
  const candidates = [
    path.resolve(moduleDirectory, '../../../native/win32-x64'),
    path.resolve(moduleDirectory, '../../native/win32-x64'),
    path.resolve(moduleDirectory, '../../../node_modules', NATIVE_COMPONENT),
    path.resolve(moduleDirectory, '../../node_modules', NATIVE_COMPONENT),
    path.resolve(workingDirectory, 'native/win32-x64'),
    path.resolve(workingDirectory, 'node_modules', NATIVE_COMPONENT)
  ]
  for (const candidate of [...new Set(candidates)]) {
    if (fs.existsSync(path.join(candidate, RUNTIME_MANIFEST_PATH))) return candidate
  }
  fail('development runtime root could not be resolved')
}

export function loadTrustedNativeRuntime<T = unknown>(
  options: TrustedNativeRuntimeLoadOptions = {}
): T {
  const isPackaged =
    options.isPackaged ?? Boolean(process.versions.electron && process.defaultApp !== true)
  const runtimeRoot = options.runtimeRoot ?? resolveTrustedNativeRuntimeRoot(options)
  const verified = verifyTrustedNativeRuntime(runtimeRoot, { allowRootLink: !isPackaged })
  const moduleLoader = options.moduleLoader ?? ((entryPath: string) => require(entryPath))
  return moduleLoader(verified.entryPath) as T
}

export function clearTrustedNativeRuntimeVerificationCacheForTesting(): void {
  verificationCache.clear()
}
