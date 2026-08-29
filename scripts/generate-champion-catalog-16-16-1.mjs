import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  const url =
    'https://raw.communitydragon.org/16.16/plugins/rcp-be-lol-game-data/global/zh_cn/v1/champion-summary.json'
  console.log(`Fetching official 16.16 champion summary data from ${url}...`)
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`Failed to fetch champion data: ${resp.statusText}`)
  }

  const rawBytes = await resp.arrayBuffer()
  const rawBuffer = Buffer.from(rawBytes)
  const sourceSha256 = crypto.createHash('sha256').update(rawBuffer).digest('hex')
  console.log(`Raw 16.16 fixture SHA-256: ${sourceSha256}`)

  const rawFixturePath = path.resolve(
    __dirname,
    '../src/main/shards/live-coach/catalog/champion-summary-16-16-raw.json'
  )
  fs.writeFileSync(rawFixturePath, rawBuffer)
  console.log(`Saved raw fixture to: ${rawFixturePath}`)

  const rawList = JSON.parse(rawBuffer.toString('utf-8'))
  // Filter valid Summoner's Rift / Arena playable champions
  const champions = rawList.filter((c) => c.id > 0 && c.id < 2000).sort((a, b) => a.id - b.id)

  console.log(`Found ${champions.length} official champions in 16.16 catalog.`)

  // 权威流派方案审核（解决通用标签与实际装备路线冲突问题）
  const SPECIFIC_ROLE_OVERRIDES = {
    10: 'mage', // Kayle: 凯尔（AP 超级后期核心，官方标签虽有变动，装备必须走 AP 攻速法师路线）
    895: 'marksman', // Nilah: 厄斐琉斯/尼菈（近战暴击 ADC，严禁套用战士重装挺进破坏者）
    131: 'mage', // Diana: 黛安娜（AP 刺客/法师出装）
    141: 'fighter', // Kayn: 凯隐（战士/刺客）
    56: 'assassin', // Nocturne: 梦魇（穿甲刺客）
    17: 'mage', // Teemo: 提莫（AP 纳什之牙面具）
    27: 'tank', // Singed: 辛吉德（法坦）
    68: 'mage', // Rumble: 兰博（法师）
    82: 'mage', // Mordekaiser: 莫德凯撒（法师重装）
    85: 'mage', // Kennen: 凯南（法师）
    104: 'marksman', // Graves: 格雷福斯（暴击/穿甲射手）
    42: 'marksman', // Corki: 库奇（暴击/物攻射手）
    887: 'mage', // Gwen: 格温（AP 峡谷制造者纳什）
    893: 'mage', // Aurora: 奥萝拉（法师）
    53: 'tank', // Blitzcrank: 布里茨（坦克辅助）
    412: 'tank', // Thresh: 锤石（坦克辅助）
    89: 'tank', // Leona: 蕾欧娜（坦克）
    111: 'tank', // Nautilus: 诺提勒斯（坦克）
    201: 'tank', // Braum: 布隆（坦克）
    555: 'assassin', // Pyke: 派克（穿甲刺客辅助）
    235: 'marksman', // Senna: 赛娜（射手辅助）
    350: 'support', // Yuumi: 悠米
    16: 'support', // Soraka: 索拉卡
    40: 'support', // Janna: 迦娜
    37: 'support', // Sona: 娑娜
    432: 'support', // Bard: 巴德
    497: 'support', // Rakan: 洛
    888: 'support', // Renata: 烈娜塔
    902: 'support', // Milio: 米利欧
    267: 'support', // Nami: 娜美
    117: 'support', // Lulu: 璐璐
    43: 'mage', // Karma: 卡尔玛
    25: 'mage', // Morgana: 莫甘娜
    64: 'fighter', // Lee Sin: 李青
    200: 'fighter', // Bel'Veth: 卑尔维斯
    234: 'fighter', // Viego: 佛耶戈
    799: 'fighter', // Ambessa: 安蓓萨
    904: 'fighter', // Zaahen: 扎汗
    804: 'marksman', // Yunara: 芸娜拉
    805: 'assassin', // Locke
    800: 'mage', // Mel: 梅尔
    910: 'mage', // Hwei: 彗
    950: 'assassin', // Naafiri: 纳亚菲利
    901: 'marksman' // Smolder: 斯莫德
  }

  const catalog = {}
  const idToRoleMap = {}
  const nameToRoleMap = {}

  for (const c of champions) {
    const id = c.id
    const alias = c.alias
    const cleanName = alias.toLowerCase().replace(/[^a-z]/g, '')
    const zhName = c.name
    const title = c.description

    let role = SPECIFIC_ROLE_OVERRIDES[id]
    if (!role) {
      const primaryTag = (c.roles && c.roles[0]) || 'fighter'
      if (['fighter', 'mage', 'marksman', 'tank', 'assassin', 'support'].includes(primaryTag)) {
        role = primaryTag
      } else {
        role = 'fighter'
      }
    }

    catalog[id] = {
      id,
      alias,
      cleanName,
      name: zhName,
      title,
      role
    }

    idToRoleMap[id] = role
    nameToRoleMap[cleanName] = role
  }

  const outputTsContent = `/**
 * AUTO-GENERATED OFFICIAL CHAMPION ROLES CATALOG (16.16.1)
 * Generated At: ${new Date().toISOString()}
 * Source URL: ${url}
 * Source SHA-256: ${sourceSha256}
 * Total Champions: ${champions.length}
 * DO NOT MANUALLY EDIT THIS FILE! Use scripts/generate-champion-catalog-16-16-1.mjs instead.
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

export const CHAMPION_CATALOG_VERSION = '16.16.1'
export const CHAMPION_CATALOG_SOURCE_SHA256 = '${sourceSha256}'

export const OFFICIAL_CHAMPION_CATALOG_16_16_1: Record<number, OfficialChampionDefinition> = ${JSON.stringify(catalog, null, 2)}

export const CHAMPION_ID_TO_ROLE_MAP: Record<number, ChampionArchetypeRole> = ${JSON.stringify(idToRoleMap, null, 2)}

export const CHAMPION_CLEAN_NAME_TO_ROLE_MAP: Record<string, ChampionArchetypeRole> = ${JSON.stringify(nameToRoleMap, null, 2)}

/**
 * 权威查找英雄流派（优先使用 championId，若无则使用 cleanName）
 */
export function getChampionRole(
  championId: number | null | undefined,
  championName?: string | null
): ChampionArchetypeRole | null {
  if (championId && championId > 0 && CHAMPION_ID_TO_ROLE_MAP[championId]) {
    return CHAMPION_ID_TO_ROLE_MAP[championId]
  }
  if (championName) {
    const clean = championName.toLowerCase().replace(/[^a-z]/g, '')
    if (CHAMPION_CLEAN_NAME_TO_ROLE_MAP[clean]) {
      return CHAMPION_CLEAN_NAME_TO_ROLE_MAP[clean]
    }
  }
  return null
}
`

  const targetPath = path.resolve(
    __dirname,
    '../src/main/shards/live-coach/catalog/champions-16-16-1.ts'
  )
  fs.writeFileSync(targetPath, outputTsContent, 'utf-8')
  console.log(`Successfully generated champion catalog at: ${targetPath}`)
}

main().catch((err) => {
  console.error('Error generating champion catalog:', err)
  process.exit(1)
})
