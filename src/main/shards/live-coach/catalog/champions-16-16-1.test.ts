import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CHAMPION_CATALOG_SOURCE_SHA256,
  CHAMPION_CATALOG_VERSION,
  CHAMPION_CLEAN_NAME_TO_ROLE_MAP,
  CHAMPION_ID_TO_ROLE_MAP,
  OFFICIAL_CHAMPION_CATALOG_16_16_1,
  getChampionRole
} from './champions-16-16-1'

describe('Official Champion Catalog 16.16.1 Authority & Integrity Test', () => {
  it('matches official CommunityDragon 16.16 fixture SHA-256 checksum', () => {
    const fixturePath = path.resolve(__dirname, 'champion-summary-16-16-raw.json')
    const fileBuf = fs.readFileSync(fixturePath)
    const computedSha256 = crypto.createHash('sha256').update(fileBuf).digest('hex')

    expect(computedSha256).toBe('a02f4eb2c8f39d160706529fc18c5aa2ffac440bf451f832bc05892009463614')
    expect(CHAMPION_CATALOG_SOURCE_SHA256).toBe(computedSha256)
    expect(CHAMPION_CATALOG_VERSION).toBe('16.16.1')
  })

  it('contains exactly 173 official Summoners Rift champions', () => {
    const ids = Object.keys(OFFICIAL_CHAMPION_CATALOG_16_16_1)
    expect(ids.length).toBe(173)
    expect(Object.keys(CHAMPION_ID_TO_ROLE_MAP).length).toBe(173)
    expect(Object.keys(CHAMPION_CLEAN_NAME_TO_ROLE_MAP).length).toBe(173)
  })

  it('correctly maps specific build profiles (Kayle, Nilah, Diana, Kayn, Nocturne)', () => {
    // 1. 争议流派英雄纠偏（通用 tag 虽与主流出装存在出入，profile 必须准确匹配装备路线）
    expect(getChampionRole(10, 'Kayle')).toBe('mage') // 凯尔：AP 核心
    expect(getChampionRole(895, 'Nilah')).toBe('marksman') // 尼菈：暴击射手（严禁套用战士挺进/黑切）
    expect(getChampionRole(131, 'Diana')).toBe('mage') // 黛安娜：AP 刺客
    expect(getChampionRole(141, 'Kayn')).toBe('fighter') // 凯隐：战士/刺客
    expect(getChampionRole(56, 'Nocturne')).toBe('assassin') // 梦魇：穿甲刺客

    // 2. 特殊法系上单/打野
    expect(getChampionRole(17, 'Teemo')).toBe('mage')
    expect(getChampionRole(68, 'Rumble')).toBe('mage')
    expect(getChampionRole(887, 'Gwen')).toBe('mage')
    expect(getChampionRole(25, 'Morgana')).toBe('mage')
    expect(getChampionRole(82, 'Mordekaiser')).toBe('mage')
    expect(getChampionRole(85, 'Kennen')).toBe('mage')
    expect(getChampionRole(27, 'Singed')).toBe('tank')

    // 3. 之前缺失的典型英雄
    expect(getChampionRole(893, 'Aurora')).toBe('mage')
    expect(getChampionRole(200, 'Belveth')).toBe('fighter')
    expect(getChampionRole(53, 'Blitzcrank')).toBe('tank')
    expect(getChampionRole(42, 'Corki')).toBe('marksman')
    expect(getChampionRole(9, 'Fiddlesticks')).toBe('mage')
    expect(getChampionRole(104, 'Graves')).toBe('marksman')
    expect(getChampionRole(64, 'LeeSin')).toBe('fighter')
    expect(getChampionRole(234, 'Viego')).toBe('fighter')
    expect(getChampionRole(804, 'Yunara')).toBe('marksman')
    expect(getChampionRole(904, 'Zaahen')).toBe('fighter')
  })

  it('resolves champion by ID first, then by cleanName, and returns null for unknown champions', () => {
    expect(getChampionRole(86)).toBe('fighter')
    expect(getChampionRole(103, 'Ahri')).toBe('mage')
    expect(getChampionRole(null, "K'Sante")).toBe('tank')
    expect(getChampionRole(null, "Cho'Gath")).toBe('tank')
    expect(getChampionRole(null, 'Miss Fortune')).toBe('marksman')

    // 未知英雄 fail-closed
    expect(getChampionRole(99999, 'NonExistentHero')).toBeNull()
    expect(getChampionRole(null, 'UnknownXYZ')).toBeNull()
    expect(getChampionRole(null, null)).toBeNull()
  })
})
