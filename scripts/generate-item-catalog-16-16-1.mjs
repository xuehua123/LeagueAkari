import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const DATA_DRAGON_URL = 'https://ddragon.leagueoflegends.com/cdn/16.16.1/data/zh_CN/item.json'
const rawFixturePath = path.resolve(
  rootDir,
  'src/main/shards/live-coach/catalog/data-dragon-16-16-1-raw.json'
)
const generatedCatalogPath = path.resolve(
  rootDir,
  'src/main/shards/live-coach/catalog/items-16-16-1.ts'
)

async function main() {
  console.log('Fetching official Data Dragon 16.16.1 item.json...')
  let rawJsonText = ''
  try {
    const res = await fetch(DATA_DRAGON_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    rawJsonText = await res.text()
  } catch (err) {
    console.warn(
      `Failed to fetch from remote (${err.message}), falling back to local file if present`
    )
    if (fs.existsSync(rawFixturePath)) {
      rawJsonText = fs.readFileSync(rawFixturePath, 'utf8')
    } else {
      throw err
    }
  }

  // Save raw fixture for programmatic test verification
  fs.writeFileSync(rawFixturePath, rawJsonText, 'utf8')
  const sha256 = crypto.createHash('sha256').update(rawJsonText).digest('hex')
  console.log(`Saved raw fixture. SHA-256: ${sha256}`)

  const parsed = JSON.parse(rawJsonText)
  const itemsMap = parsed.data || {}

  // We want all items purchasable on Summoner's Rift (map 11) or component items
  const itemsToInclude = new Map()

  for (const [idStr, rawItem] of Object.entries(itemsMap)) {
    const id = Number(idStr)
    const maps = rawItem.maps || {}
    const isSR = maps['11'] === true || maps[11] === true
    const gold = rawItem.gold || {}
    const purchasable = gold.purchasable !== false

    // Include SR purchasable items
    if (isSR && purchasable) {
      itemsToInclude.set(id, rawItem)
    }
  }

  // Also recursively include any 'from' items referenced by included items
  const queue = Array.from(itemsToInclude.values())
  while (queue.length > 0) {
    const current = queue.shift()
    if (current.from && Array.isArray(current.from)) {
      for (const compIdStr of current.from) {
        const compId = Number(compIdStr)
        if (!itemsToInclude.has(compId) && itemsMap[compIdStr]) {
          const compItem = itemsMap[compIdStr]
          itemsToInclude.set(compId, compItem)
          queue.push(compItem)
        }
      }
    }
  }

  const catalogItems = {}
  const sortedIds = Array.from(itemsToInclude.keys()).sort((a, b) => a - b)

  for (const id of sortedIds) {
    const raw = itemsToInclude.get(id)
    const gold = raw.gold || {}
    catalogItems[id] = {
      id,
      name: raw.name,
      totalCost: gold.total ?? 0,
      baseCost: gold.base ?? 0,
      purchasable: gold.purchasable !== false,
      from: Array.isArray(raw.from) ? raw.from.map(Number) : [],
      into: Array.isArray(raw.into) ? raw.into.map(Number) : [],
      tags: raw.tags || []
    }
  }

  const generatedTs = `/**
 * AUTO-GENERATED FILE FROM RIOT DATA DRAGON 16.16.1
 * Generated At: ${new Date().toISOString()}
 * Data Dragon Source SHA-256: ${sha256}
 * DO NOT MANUALLY EDIT THIS FILE! Use scripts/generate-item-catalog-16-16-1.mjs instead.
 */

export interface CatalogItemDefinition {
  id: number
  name: string
  totalCost: number
  baseCost: number
  purchasable: boolean
  from: number[]
  into: number[]
  tags: string[]
}

export interface RiotItemCatalog {
  version: '16.16.1'
  sourceSha256: string
  items: Record<number, CatalogItemDefinition>
}

export const RiotItemCatalog16_16_1: RiotItemCatalog = {
  version: '16.16.1',
  sourceSha256: '${sha256}',
  items: ${JSON.stringify(catalogItems, null, 2)}
}
`

  fs.writeFileSync(generatedCatalogPath, generatedTs, 'utf8')
  console.log(`Successfully generated ${generatedCatalogPath} with ${sortedIds.length} items.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
