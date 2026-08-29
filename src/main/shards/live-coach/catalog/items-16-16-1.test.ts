import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import rawFixture from './data-dragon-16-16-1-raw.json'
import { RiotItemCatalog16_16_1 } from './items-16-16-1'

describe('RiotItemCatalog16_16_1 Authority & Integrity Test', () => {
  it('matches official Data Dragon 16.16.1 SHA-256 fixture checksum', () => {
    // 真实计算 fixture 文件字节的 SHA-256
    const fixturePath = path.resolve(__dirname, 'data-dragon-16-16-1-raw.json')
    const fileBuf = fs.readFileSync(fixturePath)
    const computedSha256 = crypto.createHash('sha256').update(fileBuf).digest('hex')

    expect(computedSha256).toBe('257d2bb4182917d3700a46246444ab058e122c7ba97e10768cc74515790b39d7')
    expect(RiotItemCatalog16_16_1.sourceSha256).toBe(computedSha256)
    expect(RiotItemCatalog16_16_1.version).toBe('16.16.1')
  })

  it('matches official costs and recipes for disputed patch items', () => {
    const catalog = RiotItemCatalog16_16_1.items

    // 1. 蓝水晶 (1027): 官方 300g
    expect(catalog[1027].totalCost).toBe(300)

    // 2. 轻灵之靴 (3009): 官方 1000g
    expect(catalog[3009].totalCost).toBe(1000)

    // 3. 考尔菲德战锤 (3133): 官方 1050g, 配方两把长剑加发光微粒 [1036, 2022, 1036]
    expect(catalog[3133].totalCost).toBe(1050)
    expect(catalog[3133].from).toEqual([1036, 2022, 1036])

    // 4. 海克斯饮魔刀 (3155): 两把长剑 + 抗魔斗篷 [1036, 1033, 1036]
    expect(catalog[3155].from).toEqual([1036, 1033, 1036])
    expect(catalog[3155].totalCost).toBe(1300)

    // 5. 玛莫提乌斯之噬 (3156): 海克斯饮魔刀 + 考尔菲德战锤 [3155, 3133]
    expect(catalog[3156].from).toEqual([3155, 3133])
    expect(catalog[3156].totalCost).toBe(3100)

    // 6. 翠绿屏障 (4632): 两本增幅典籍 + 抗魔斗篷 [1052, 1033, 1052]
    expect(catalog[4632].from).toEqual([1052, 1033, 1052])
    expect(catalog[4632].totalCost).toBe(1600)

    // 7. 幽魂斗篷 (3211): 红水晶 + 抗魔斗篷 + 治疗宝珠 [1028, 1033, 1006]
    expect(catalog[3211].from).toEqual([1028, 1033, 1006])
    expect(catalog[3211].totalCost).toBe(1250)

    // 8. 提亚马特 (3077): 两把长剑 [1036, 1036], baseCost: 500
    expect(catalog[3077].totalCost).toBe(1200)
    expect(catalog[3077].from).toEqual([1036, 1036])
    expect(catalog[3077].baseCost).toBe(500)

    // 9. 包含 2022, 1004, 1006, 2420, 6670, 3082, 3057, 4630, 1026 等所有下级组件
    const requiredComponentIds = [2022, 1004, 1006, 2420, 6670, 3082, 3057, 4630, 1026]
    for (const compId of requiredComponentIds) {
      expect(catalog[compId]).toBeDefined()
      expect(catalog[compId].id).toBe(compId)
    }

    // 10. 3191 (旧探索者的护臂) 在 16.16.1 正式装备数据中不存在
    expect(catalog[3191]).toBeUndefined()
  })

  it('matches all generated items with Data Dragon raw JSON data structure', () => {
    const rawData = (rawFixture as any).data
    for (const [idStr, item] of Object.entries(RiotItemCatalog16_16_1.items)) {
      const raw = rawData[idStr]
      expect(raw).toBeDefined()
      expect(item.name).toBe(raw.name)
      expect(item.totalCost).toBe(raw.gold.total)
      expect(item.baseCost).toBe(raw.gold.base)
      if (raw.from) {
        expect(item.from).toEqual(raw.from.map(Number))
      } else {
        expect(item.from).toEqual([])
      }
    }
  })
})
