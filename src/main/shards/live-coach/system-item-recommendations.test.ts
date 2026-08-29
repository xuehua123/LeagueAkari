import { describe, expect, it } from 'vitest'

import { extractSystemRecommendedItemIds } from './system-item-recommendations'

describe('extractSystemRecommendedItemIds', () => {
  it('extracts ordered unique item ids from Riot recommended item payloads', () => {
    expect(
      extractSystemRecommendedItemIds([
        {
          mapId: 11,
          itemSets: [
            { items: [{ id: 6655 }, { itemId: '3020' }, 4645] },
            { itemIds: [6655, 2055, 3340] }
          ]
        }
      ])
    ).toEqual([6655, 3020, 4645])
  })

  it('does not interpret unrelated numeric metadata as item ids', () => {
    expect(extractSystemRecommendedItemIds([{ mapId: 1001, priority: 6655 }])).toEqual([])
  })

  it('does not reinterpret valid-looking metadata numbers inside item containers as item ids', () => {
    expect(
      extractSystemRecommendedItemIds([
        {
          itemSets: [
            {
              mapId: 11,
              priority: 3047,
              items: [{ id: 6655, cost: 3020, count: 1 }]
            }
          ]
        }
      ])
    ).toEqual([6655])
  })

  it('ignores recommendation branches that explicitly target another map', () => {
    expect(
      extractSystemRecommendedItemIds([
        { mapId: 12, items: [{ id: 3142 }] },
        { mapId: 11, items: [{ id: 6655 }] }
      ])
    ).toEqual([6655])
  })
})
