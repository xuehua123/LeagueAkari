import { CURRENT_RIOT_ITEM_CATALOG } from './catalog/current'

const ITEM_FIELD_PATTERN = /^(recommendedItemDefaults|itemSets?|items?|itemIds?)$/i
const DIRECT_ID_FIELD_PATTERN = /^(id|itemId|itemID|value)$/

function collectItemIds(
  value: unknown,
  output: number[],
  insideItemField = false,
  acceptScalar = false
): void {
  if (typeof value === 'number') {
    if (acceptScalar && Number.isSafeInteger(value)) output.push(value)
    return
  }

  if (typeof value === 'string') {
    if (acceptScalar && /^\d+$/.test(value)) output.push(Number(value))
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) collectItemIds(entry, output, insideItemField, acceptScalar)
    return
  }

  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const explicitMapId = record.mapId
  if (
    (typeof explicitMapId === 'number' || typeof explicitMapId === 'string') &&
    Number.isFinite(Number(explicitMapId)) &&
    Number(explicitMapId) !== 11
  ) {
    return
  }

  for (const [key, entry] of Object.entries(record)) {
    if (ITEM_FIELD_PATTERN.test(key)) {
      collectItemIds(entry, output, true, true)
    } else if (insideItemField && DIRECT_ID_FIELD_PATTERN.test(key)) {
      collectItemIds(entry, output, true, true)
    } else {
      // Keep traversing item containers, but never reinterpret unrelated numeric metadata as IDs.
      collectItemIds(entry, output, insideItemField, false)
    }
  }
}

/**
 * Reads Riot Client's champion `recommendedItemDefaults` payload without depending on its
 * undocumented nesting shape. Only valid, purchasable Summoner's Rift catalog items survive.
 */
export function extractSystemRecommendedItemIds(payload: unknown): number[] {
  const collected: number[] = []
  collectItemIds(payload, collected)

  const seen = new Set<number>()
  return collected.filter((itemId) => {
    if (seen.has(itemId)) return false

    const item = CURRENT_RIOT_ITEM_CATALOG.items[itemId]
    if (!item || !item.purchasable || itemId >= 100000) return false
    if (item.tags.includes('Trinket') || item.tags.includes('Consumable')) return false

    seen.add(itemId)
    return true
  })
}
