import { OFFICIAL_CHAMPION_CATALOG_16_17_1, getChampionRole } from './champions-16-17-1'
import { RiotItemCatalog16_17_1 } from './items-16-17-1'

export type { ChampionArchetypeRole, OfficialChampionDefinition } from './champions-16-17-1'
export type { CatalogItemDefinition, RiotItemCatalog } from './items-16-17-1'

export const CURRENT_LIVE_COACH_PATCH = '16.17.1' as const
export const SUPPORTED_LIVE_COACH_PATCH_CATALOGS = new Set<string>([CURRENT_LIVE_COACH_PATCH])

export const CURRENT_OFFICIAL_CHAMPION_CATALOG = OFFICIAL_CHAMPION_CATALOG_16_17_1
export const CURRENT_RIOT_ITEM_CATALOG = RiotItemCatalog16_17_1
export { getChampionRole }
