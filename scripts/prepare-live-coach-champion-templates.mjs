import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PATCH = '16.17.1'
const cropRatios = [0, 0.08, 0.14]
const outputSize = 12

function requireOptionValue(argv, index, name) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export function parseCliOptions(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]
    if (name === '--help') return { help: true }
    if (!['--patch', '--catalog', '--output-directory', '--source-base-url'].includes(name)) {
      throw new Error(`Unsupported option: ${name}`)
    }
    values[name] = requireOptionValue(argv, index, name)
    index += 1
  }

  const patch = values['--patch'] ?? DEFAULT_PATCH
  if (!/^\d+\.\d+\.\d+$/.test(patch)) {
    throw new Error(`Patch must use X.Y.Z form: ${patch}`)
  }
  const communityDragonPatch = patch.split('.').slice(0, 2).join('.')
  const gameDataBaseUrl = `https://raw.communitydragon.org/${communityDragonPatch}/plugins/rcp-be-lol-game-data/global/default/v1`
  return {
    help: false,
    patch,
    catalogPath: values['--catalog'] ? path.resolve(values['--catalog']) : null,
    catalogUrl: `${gameDataBaseUrl}/champion-summary.json`,
    outputDirectory: path.resolve(
      values['--output-directory'] ?? path.join(projectRoot, 'resources/live-coach/models')
    ),
    sourceBaseUrl: values['--source-base-url'] ?? `${gameDataBaseUrl}/champion-icons/`
  }
}

function sampleBilinear(image, x, y, channel) {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)))
  const x1 = Math.min(image.width - 1, x0 + 1)
  const y1 = Math.min(image.height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const at = (px, py) => image.data[(py * image.width + px) * 4 + channel]
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx
  return Math.round(top * (1 - ty) + bottom * ty)
}

function createTemplate(image, cropRatio) {
  const cropX = image.width * cropRatio
  const cropY = image.height * cropRatio
  const cropWidth = image.width * (1 - cropRatio * 2)
  const cropHeight = image.height * (1 - cropRatio * 2)
  const pixels = []
  for (let y = 0; y < outputSize; y++) {
    for (let x = 0; x < outputSize; x++) {
      const sourceX = cropX + ((x + 0.5) / outputSize) * cropWidth - 0.5
      const sourceY = cropY + ((y + 0.5) / outputSize) * cropHeight - 0.5
      pixels.push(
        sampleBilinear(image, sourceX, sourceY, 0),
        sampleBilinear(image, sourceX, sourceY, 1),
        sampleBilinear(image, sourceX, sourceY, 2)
      )
    }
  }
  return pixels
}

async function download(url, attempts = 3) {
  if (url.startsWith('file:')) return fs.promises.readFile(fileURLToPath(url))

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 250))
    }
  }
  throw lastError
}

async function loadCatalog(options) {
  if (options.catalogPath) {
    return JSON.parse(await fs.promises.readFile(options.catalogPath, 'utf8'))
  }
  return JSON.parse((await download(options.catalogUrl)).toString('utf8'))
}

function appendPath(baseUrl, fileName) {
  return new URL(fileName, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

export async function prepareChampionTemplates(options) {
  const catalog = await loadCatalog(options)
  if (!Array.isArray(catalog)) throw new Error('Champion catalog must be an array')
  const champions = catalog
    // 60000+ entries are "Jade" mode compatibility aliases, not Summoner's Rift champions.
    .filter((entry) => Number.isInteger(entry.id) && entry.id > 0 && entry.id < 10_000)
    .sort((left, right) => left.id - right.id)
  if (champions.length === 0) throw new Error('Champion catalog contains no playable champions')

  const templates = {}
  for (const [index, champion] of champions.entries()) {
    const imageUrl = appendPath(options.sourceBaseUrl, `${champion.id}.png`)
    const image = PNG.sync.read(await download(imageUrl))
    templates[String(champion.id)] = cropRatios.map((ratio) => createTemplate(image, ratio))
    if ((index + 1) % 25 === 0 || index + 1 === champions.length) {
      process.stdout.write(`Prepared ${index + 1}/${champions.length} champion templates\n`)
    }
  }

  const artifact = {
    schemaVersion: 1,
    artifactKind: 'square-portrait-bootstrap',
    releaseEligible: false,
    modelName: 'champion-icon-template-ncc',
    version: `${options.patch}-template.1`,
    patch: options.patch,
    inputSize: outputSize,
    channels: 3,
    cropRatios,
    sourceBaseUrl: options.sourceBaseUrl,
    championCount: champions.length,
    templates
  }
  const contents = `${JSON.stringify(artifact)}\n`
  const sha256 = createHash('sha256').update(contents).digest('hex')
  const outputPath = path.join(
    options.outputDirectory,
    `champion-icons-${options.patch.replaceAll('.', '-')}.json`
  )

  fs.mkdirSync(options.outputDirectory, { recursive: true })
  fs.writeFileSync(outputPath, contents)
  process.stdout.write(`Wrote ${path.relative(projectRoot, outputPath)} (${sha256})\n`)
  process.stdout.write(
    'releaseEligible=false: runtime manifest was not modified; export a bootstrap ONNX separately.\n'
  )
  return { artifact, outputPath, sha256 }
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/prepare-live-coach-champion-templates.mjs [options]

Options:
  --patch X.Y.Z             Target patch (default: ${DEFAULT_PATCH})
  --catalog PATH            Optional local champion-summary JSON fixture
  --output-directory PATH   Artifact output directory
  --source-base-url URL     Champion square-portrait directory URL

This command creates bootstrap source templates only. It never writes manifest.json.
`)
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  await prepareChampionTemplates(options)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
