import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const PATCH = '16.17.1'
const PATCH_FILE_ID = '16-17-1'
const DATA_DRAGON_BASE_URL = `https://ddragon.leagueoflegends.com/cdn/${PATCH}/data/zh_CN`
const catalogDirectory = path.resolve(rootDir, 'src/main/shards/live-coach/catalog')

const SPECIFIC_ROLE_OVERRIDES = {
  10: 'mage',
  16: 'support',
  17: 'mage',
  25: 'mage',
  27: 'tank',
  37: 'support',
  40: 'support',
  42: 'marksman',
  43: 'mage',
  53: 'tank',
  56: 'assassin',
  64: 'fighter',
  68: 'mage',
  82: 'mage',
  85: 'mage',
  89: 'tank',
  104: 'marksman',
  111: 'tank',
  117: 'support',
  131: 'mage',
  141: 'fighter',
  200: 'fighter',
  201: 'tank',
  234: 'fighter',
  235: 'marksman',
  267: 'support',
  350: 'support',
  412: 'tank',
  432: 'support',
  497: 'support',
  555: 'assassin',
  799: 'fighter',
  800: 'mage',
  804: 'marksman',
  805: 'assassin',
  887: 'mage',
  888: 'support',
  893: 'mage',
  895: 'marksman',
  901: 'marksman',
  902: 'support',
  904: 'fighter',
  910: 'mage',
  950: 'assassin'
}

async function loadOfficialJson(kind) {
  const url = `${DATA_DRAGON_BASE_URL}/${kind}.json`
  const fixturePath = path.resolve(
    catalogDirectory,
    `data-dragon-${kind}s-${PATCH_FILE_ID}-raw.json`
  )

  let rawBuffer
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    rawBuffer = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    if (!fs.existsSync(fixturePath)) throw error
    console.warn(`Failed to fetch ${url}; using ${fixturePath}`)
    rawBuffer = fs.readFileSync(fixturePath)
  }

  const parsed = JSON.parse(rawBuffer.toString('utf8'))
  if (parsed.version !== PATCH || !parsed.data || typeof parsed.data !== 'object') {
    throw new Error(`${kind}.json does not match Data Dragon patch ${PATCH}`)
  }

  fs.writeFileSync(fixturePath, rawBuffer)
  return {
    url,
    parsed,
    sha256: crypto.createHash('sha256').update(rawBuffer).digest('hex')
  }
}

function generateItemCatalog(source) {
  const itemsMap = source.parsed.data
  const includedItems = new Map()

  for (const [idText, item] of Object.entries(itemsMap)) {
    const maps = item.maps ?? {}
    const isSummonersRift = maps['11'] === true || maps[11] === true
    if (isSummonersRift && item.gold?.purchasable !== false) {
      includedItems.set(Number(idText), item)
    }
  }

  const pendingItems = [...includedItems.values()]
  while (pendingItems.length > 0) {
    const item = pendingItems.shift()
    for (const componentIdText of item.from ?? []) {
      const componentId = Number(componentIdText)
      if (!includedItems.has(componentId) && itemsMap[componentIdText]) {
        const component = itemsMap[componentIdText]
        includedItems.set(componentId, component)
        pendingItems.push(component)
      }
    }
  }

  const catalogItems = {}
  for (const id of [...includedItems.keys()].sort((left, right) => left - right)) {
    const item = includedItems.get(id)
    catalogItems[id] = {
      id,
      name: item.name,
      totalCost: item.gold?.total ?? 0,
      baseCost: item.gold?.base ?? 0,
      purchasable: item.gold?.purchasable !== false,
      from: Array.isArray(item.from) ? item.from.map(Number) : [],
      into: Array.isArray(item.into) ? item.into.map(Number) : [],
      tags: item.tags ?? []
    }
  }

  const output = `/**
 * AUTO-GENERATED FILE FROM RIOT DATA DRAGON ${PATCH}
 * Source URL: ${source.url}
 * Data Dragon Source SHA-256: ${source.sha256}
 * DO NOT MANUALLY EDIT THIS FILE! Use scripts/generate-live-coach-catalog-${PATCH_FILE_ID}.mjs instead.
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
  version: '${PATCH}'
  sourceSha256: string
  items: Record<number, CatalogItemDefinition>
}

export const RiotItemCatalog16_17_1: RiotItemCatalog = {
  version: '${PATCH}',
  sourceSha256: '${source.sha256}',
  items: ${JSON.stringify(catalogItems, null, 2)}
}
`

  fs.writeFileSync(path.resolve(catalogDirectory, `items-${PATCH_FILE_ID}.ts`), output, 'utf8')
  console.log(`Generated ${Object.keys(catalogItems).length} Summoner's Rift items for ${PATCH}`)
}

function generateChampionCatalog(source) {
  const champions = Object.values(source.parsed.data)
    .map((champion) => ({ ...champion, numericId: Number(champion.key) }))
    .filter((champion) => Number.isInteger(champion.numericId) && champion.numericId > 0)
    .sort((left, right) => left.numericId - right.numericId)

  if (champions.length !== 173) {
    throw new Error(`Expected 173 champions for ${PATCH}, received ${champions.length}`)
  }

  const catalog = {}
  const idToRoleMap = {}
  const nameToRoleMap = {}
  const validRoles = new Set(['fighter', 'mage', 'marksman', 'tank', 'assassin', 'support'])

  for (const champion of champions) {
    const id = champion.numericId
    const alias = champion.id
    const cleanName = alias.toLowerCase().replace(/[^a-z]/g, '')
    const dataDragonRole = String(champion.tags?.[0] ?? 'fighter').toLowerCase()
    const role =
      SPECIFIC_ROLE_OVERRIDES[id] ?? (validRoles.has(dataDragonRole) ? dataDragonRole : 'fighter')

    catalog[id] = {
      id,
      alias,
      cleanName,
      name: champion.name,
      title: champion.title,
      role
    }
    idToRoleMap[id] = role
    nameToRoleMap[cleanName] = role
  }

  const output = `/**
 * AUTO-GENERATED OFFICIAL RIOT DATA DRAGON CHAMPION CATALOG (${PATCH})
 * Source URL: ${source.url}
 * Source SHA-256: ${source.sha256}
 * Total Champions: ${champions.length}
 * DO NOT MANUALLY EDIT THIS FILE! Use scripts/generate-live-coach-catalog-${PATCH_FILE_ID}.mjs instead.
 */

export type ChampionArchetypeRole = 'fighter' | 'mage' | 'marksman' | 'tank' | 'assassin' | 'support'

export interface OfficialChampionDefinition {
  id: number
  alias: string
  cleanName: string
  name: string
  title: string
  role: ChampionArchetypeRole
}

export const CHAMPION_CATALOG_VERSION = '${PATCH}'
export const CHAMPION_CATALOG_SOURCE_SHA256 = '${source.sha256}'

export const OFFICIAL_CHAMPION_CATALOG_16_17_1: Record<number, OfficialChampionDefinition> = ${JSON.stringify(catalog, null, 2)}

export const CHAMPION_ID_TO_ROLE_MAP: Record<number, ChampionArchetypeRole> = ${JSON.stringify(idToRoleMap, null, 2)}

export const CHAMPION_CLEAN_NAME_TO_ROLE_MAP: Record<string, ChampionArchetypeRole> = ${JSON.stringify(nameToRoleMap, null, 2)}

export function getChampionRole(
  championId: number | null | undefined,
  championName?: string | null
): ChampionArchetypeRole | null {
  if (championId && championId > 0 && CHAMPION_ID_TO_ROLE_MAP[championId]) {
    return CHAMPION_ID_TO_ROLE_MAP[championId]
  }
  if (championName) {
    const cleanName = championName.toLowerCase().replace(/[^a-z]/g, '')
    if (CHAMPION_CLEAN_NAME_TO_ROLE_MAP[cleanName]) {
      return CHAMPION_CLEAN_NAME_TO_ROLE_MAP[cleanName]
    }
  }
  return null
}
`

  fs.writeFileSync(path.resolve(catalogDirectory, `champions-${PATCH_FILE_ID}.ts`), output, 'utf8')
  console.log(`Generated ${champions.length} champions for ${PATCH}`)
}

const [itemSource, championSource] = await Promise.all([
  loadOfficialJson('item'),
  loadOfficialJson('champion')
])
generateItemCatalog(itemSource)
generateChampionCatalog(championSource)
