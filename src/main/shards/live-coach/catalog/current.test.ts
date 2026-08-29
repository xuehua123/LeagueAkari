import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CURRENT_LIVE_COACH_PATCH,
  CURRENT_OFFICIAL_CHAMPION_CATALOG,
  CURRENT_RIOT_ITEM_CATALOG,
  SUPPORTED_LIVE_COACH_PATCH_CATALOGS
} from './current'

describe('current live coach patch catalog', () => {
  it('registers exactly the current official catalog patch', () => {
    expect(CURRENT_LIVE_COACH_PATCH).toBe('16.17.1')
    expect(CURRENT_RIOT_ITEM_CATALOG.version).toBe(CURRENT_LIVE_COACH_PATCH)
    expect(Object.keys(CURRENT_OFFICIAL_CHAMPION_CATALOG)).toHaveLength(173)
    expect([...SUPPORTED_LIVE_COACH_PATCH_CATALOGS]).toEqual([CURRENT_LIVE_COACH_PATCH])
    expect(SUPPORTED_LIVE_COACH_PATCH_CATALOGS.has('16.16.1')).toBe(false)

    const modelManifest = JSON.parse(
      fs.readFileSync(path.resolve('resources/live-coach/models/manifest.json'), 'utf8')
    )
    expect(modelManifest.releasePatch).toBe(CURRENT_LIVE_COACH_PATCH)
  })
})
