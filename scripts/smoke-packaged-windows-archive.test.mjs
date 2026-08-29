import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  parseArchiveSmokeArguments,
  resolveArchivePath
} from './smoke-packaged-windows-archive.mjs'

describe('packaged Windows archive smoke CLI', () => {
  it('selects the explicitly normalized final archive and release gate', () => {
    expect(
      parseArchiveSmokeArguments([
        '--archive',
        'dist/league-akari-win-x64.7z',
        '--require-accepted-model'
      ])
    ).toEqual({
      archivePath: 'dist/league-akari-win-x64.7z',
      requireAcceptedModel: true
    })
    expect(resolveArchivePath('dist/league-akari-win-x64.7z', 'C:\\workspace')).toBe(
      path.resolve('C:\\workspace', 'dist/league-akari-win-x64.7z')
    )
  })

  it('keeps unsigned internal archive smoke available without the release-only flag', () => {
    expect(parseArchiveSmokeArguments([])).toEqual({
      archivePath: undefined,
      requireAcceptedModel: false
    })
  })

  it('fails on unknown, missing, or duplicate archive options', () => {
    expect(() => parseArchiveSmokeArguments(['--unknown'])).toThrow('Unknown archive smoke option')
    expect(() => parseArchiveSmokeArguments(['--archive'])).toThrow('--archive requires a path')
    expect(() =>
      parseArchiveSmokeArguments(['--archive', 'one.7z', '--archive', 'two.7z'])
    ).toThrow('--archive may only be specified once')
  })
})
