import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CHAMPION_CATALOG_SOURCE_SHA256,
  CHAMPION_CATALOG_VERSION,
  CHAMPION_CLEAN_NAME_TO_ROLE_MAP,
  CHAMPION_ID_TO_ROLE_MAP,
  OFFICIAL_CHAMPION_CATALOG_16_17_1,
  getChampionRole
} from './champions-16-17-1'
import rawFixture from './data-dragon-champions-16-17-1-raw.json'

describe('Riot champion catalog 16.17.1 authority and integrity', () => {
  it('matches the pinned official Data Dragon source', () => {
    const fixturePath = path.resolve(__dirname, 'data-dragon-champions-16-17-1-raw.json')
    const computedSha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(fixturePath))
      .digest('hex')

    expect(computedSha256).toBe('b8d685c8ed41f2db5c34b2d0d910f4b9138ee0045af22af61bd30a13c4761c34')
    expect(CHAMPION_CATALOG_SOURCE_SHA256).toBe(computedSha256)
    expect(CHAMPION_CATALOG_VERSION).toBe('16.17.1')
  })

  it('matches all 173 official champion identities against the pinned raw payload', () => {
    const rawChampions = (rawFixture as any).data

    expect(Object.keys(OFFICIAL_CHAMPION_CATALOG_16_17_1)).toHaveLength(173)
    expect(Object.keys(CHAMPION_ID_TO_ROLE_MAP)).toHaveLength(173)
    expect(Object.keys(CHAMPION_CLEAN_NAME_TO_ROLE_MAP)).toHaveLength(173)

    for (const champion of Object.values(OFFICIAL_CHAMPION_CATALOG_16_17_1)) {
      const rawChampion = rawChampions[champion.alias]
      expect(rawChampion).toBeDefined()
      expect(champion).toMatchObject({
        id: Number(rawChampion.key),
        alias: rawChampion.id,
        name: rawChampion.name,
        title: rawChampion.title
      })
    }
  })

  it('uses reviewed build profiles and fails closed for unknown champions', () => {
    expect(getChampionRole(10, 'Kayle')).toBe('mage')
    expect(getChampionRole(895, 'Nilah')).toBe('marksman')
    expect(getChampionRole(131, 'Diana')).toBe('mage')
    expect(getChampionRole(141, 'Kayn')).toBe('fighter')
    expect(getChampionRole(904, 'Zaahen')).toBe('fighter')
    expect(getChampionRole(null, "K'Sante")).toBe('tank')
    expect(getChampionRole(99999, 'NonExistentHero')).toBeNull()
    expect(getChampionRole(null, null)).toBeNull()
  })
})
