import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { finalizeReleaseAssets } from './finalize-release-assets.mjs'

const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'league-akari-release-assets-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('release asset finalization', () => {
  it('normalizes Windows assets and writes a deterministic SHA-256 manifest', () => {
    const directory = temporaryDirectory()
    fs.writeFileSync(path.join(directory, 'League Akari-1.2.3-win.7z'), 'archive')
    fs.writeFileSync(path.join(directory, 'ignored.blockmap'), 'blockmap')

    const result = finalizeReleaseAssets(directory, 'league-akari-win-x64')
    const finalName = 'league-akari-win-x64.7z'
    const expectedHash = createHash('sha256').update('archive').digest('hex')

    expect(result.finalizedFiles).toEqual([finalName])
    expect(fs.existsSync(path.join(directory, 'League Akari-1.2.3-win.7z'))).toBe(false)
    expect(fs.readFileSync(path.join(directory, finalName), 'utf8')).toBe('archive')
    expect(fs.readFileSync(result.checksumPath, 'utf8')).toBe(`${expectedHash}  ${finalName}\n`)
  })

  it('fails closed when the final Windows archive is absent', () => {
    const directory = temporaryDirectory()
    fs.writeFileSync(path.join(directory, 'LeagueAkari.exe'), 'executable')

    expect(() => finalizeReleaseAssets(directory, 'league-akari-win-x64')).toThrow(
      'final Windows 7z archive is missing'
    )
  })

  it('rejects ambiguous assets instead of hashing an arbitrary file', () => {
    const directory = temporaryDirectory()
    fs.writeFileSync(path.join(directory, 'one.7z'), 'one')
    fs.writeFileSync(path.join(directory, 'two.7z'), 'two')

    expect(() => finalizeReleaseAssets(directory, 'league-akari-win-x64')).toThrow(
      'Multiple .7z artifacts'
    )
  })

  it('rejects unsafe release prefixes', () => {
    const directory = temporaryDirectory()
    fs.writeFileSync(path.join(directory, 'one.7z'), 'one')

    expect(() => finalizeReleaseAssets(directory, '../release')).toThrow(
      'Invalid release asset prefix'
    )
  })
})
