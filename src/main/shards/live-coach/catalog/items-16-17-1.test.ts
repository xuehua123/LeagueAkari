import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import rawFixture from './data-dragon-items-16-17-1-raw.json'
import { RiotItemCatalog16_17_1 } from './items-16-17-1'

describe('Riot item catalog 16.17.1 authority and integrity', () => {
  it('matches the pinned official Data Dragon source', () => {
    const fixturePath = path.resolve(__dirname, 'data-dragon-items-16-17-1-raw.json')
    const computedSha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(fixturePath))
      .digest('hex')

    expect(computedSha256).toBe('aff335136e1dc3429655efc763460b9a55630ce8ba27522654070a6beb239973')
    expect(RiotItemCatalog16_17_1.sourceSha256).toBe(computedSha256)
    expect(RiotItemCatalog16_17_1.version).toBe('16.17.1')
  })

  it('matches every generated item against the pinned raw payload', () => {
    const rawItems = (rawFixture as any).data

    for (const [idText, item] of Object.entries(RiotItemCatalog16_17_1.items)) {
      const rawItem = rawItems[idText]
      expect(rawItem).toBeDefined()
      expect(item).toMatchObject({
        id: Number(idText),
        name: rawItem.name,
        totalCost: rawItem.gold.total,
        baseCost: rawItem.gold.base,
        purchasable: rawItem.gold.purchasable !== false,
        from: Array.isArray(rawItem.from) ? rawItem.from.map(Number) : [],
        into: Array.isArray(rawItem.into) ? rawItem.into.map(Number) : [],
        tags: rawItem.tags ?? []
      })
    }
  })

  it("contains current-patch Summoner's Rift changes and required recipe components", () => {
    const catalog = RiotItemCatalog16_17_1.items

    expect(catalog[3095]).toMatchObject({
      name: '岚切',
      totalCost: 3200,
      baseCost: 700,
      from: [1038, 1018, 3144]
    })
    expect(catalog[3133]).toMatchObject({
      totalCost: 1050,
      from: [1036, 2022, 1036]
    })
    expect(catalog[3156]).toMatchObject({
      totalCost: 3100,
      from: [3155, 3133]
    })
    expect(catalog[3077]).toMatchObject({
      totalCost: 1200,
      baseCost: 500,
      from: [1036, 1036]
    })

    for (const componentId of [2022, 1004, 1006, 2420, 6670, 3082, 3057, 4630, 1026]) {
      expect(catalog[componentId]?.id).toBe(componentId)
    }
  })
})
