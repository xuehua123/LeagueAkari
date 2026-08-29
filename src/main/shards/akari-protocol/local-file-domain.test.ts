import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createLocalFileDomainHandler } from './local-file-domain'
import { LocalFileGrantRegistry } from './local-file-grants'

describe('local file protocol byte ranges', () => {
  it('serves seekable single ranges and rejects invalid ranges', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-local-range-'))
    const filePath = path.join(directory, 'sample.mp4')
    fs.writeFileSync(filePath, Buffer.from('0123456789'))
    const grants = new LocalFileGrantRegistry()
    const grant = await grants.issue(filePath, 'live-coach-replay-video')
    const handler = createLocalFileDomainHandler(grants)
    const uri = grant.token

    try {
      const partial = await handler(
        `${uri}?v=artifact-sha`,
        new Request(`akari://local/${uri}?v=artifact-sha`, { headers: { range: 'bytes=2-5' } })
      )
      expect(partial.status).toBe(206)
      expect(partial.headers.get('accept-ranges')).toBe('bytes')
      expect(partial.headers.get('content-range')).toBe('bytes 2-5/10')
      expect(partial.headers.get('content-length')).toBe('4')
      expect(await partial.text()).toBe('2345')

      const suffix = await handler(
        uri,
        new Request(`akari://local/${uri}`, { headers: { range: 'bytes=-3' } })
      )
      expect(suffix.status).toBe(206)
      expect(await suffix.text()).toBe('789')

      const invalid = await handler(
        uri,
        new Request(`akari://local/${uri}`, { headers: { range: 'bytes=20-30' } })
      )
      expect(invalid.status).toBe(416)
      expect(invalid.headers.get('content-range')).toBe('bytes */10')
    } finally {
      fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  it('rejects raw paths and non-video grants without disclosing the bound path', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-local-grant-'))
    const filePath = path.join(directory, 'private-sidecar.json')
    fs.writeFileSync(filePath, '{}')
    const grants = new LocalFileGrantRegistry()
    const sidecarGrant = await grants.issue(filePath, 'live-coach-replay-sidecar')
    const handler = createLocalFileDomainHandler(grants)

    try {
      const rawPathResponse = await handler(
        encodeURIComponent(filePath),
        new Request(`akari://local/${encodeURIComponent(filePath)}`)
      )
      expect(rawPathResponse.status).toBe(404)
      expect(await rawPathResponse.text()).not.toContain(filePath)

      const wrongPurposeResponse = await handler(
        sidecarGrant.token,
        new Request(`akari://local/${sidecarGrant.token}`)
      )
      expect(wrongPurposeResponse.status).toBe(404)
      expect(await wrongPurposeResponse.text()).not.toContain(filePath)
    } finally {
      fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  it('expires grants and invalidates them when the selected file changes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-local-expiry-'))
    const filePath = path.join(directory, 'sample.mp4')
    fs.writeFileSync(filePath, 'first')
    let now = 1_000
    const grants = new LocalFileGrantRegistry(() => now)
    const expiring = await grants.issue(filePath, 'live-coach-replay-video', 100)

    try {
      now = 1_050
      await expect(
        grants.resolve(expiring.token, ['live-coach-replay-video'])
      ).resolves.toMatchObject({ descriptor: { expiresAt: 1_100 } })
      now = 1_101
      await expect(
        grants.resolve(expiring.token, ['live-coach-replay-video'])
      ).rejects.toMatchObject({ code: 'unavailable' })

      const changed = await grants.issue(filePath, 'live-coach-replay-video')
      fs.writeFileSync(filePath, 'changed-content')
      await expect(
        grants.resolve(changed.token, ['live-coach-replay-video'])
      ).rejects.toMatchObject({ code: 'unavailable' })
    } finally {
      fs.rmSync(directory, { force: true, recursive: true })
    }
  })
})
