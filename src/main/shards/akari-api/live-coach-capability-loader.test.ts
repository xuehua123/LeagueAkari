import type { LiveCoachCapabilityPayload } from '@shared/types/live-coach'
import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LIVE_COACH_CAPABILITY_CACHED_RESOURCE as resource } from './cached-resources'
import { LiveCoachCapabilityLoader } from './live-coach-capability-loader'
import { verifyLiveCoachCapabilityEnvelope } from './live-coach-capability-verifier'
import { AkariApiState } from './state'

function createSignedEnvelope(payload: LiveCoachCapabilityPayload) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8')
  return {
    envelope: {
      keyId: 'test-key',
      payloadBase64: bytes.toString('base64'),
      signatureBase64: sign(null, bytes, privateKey).toString('base64')
    },
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}

function createPayload(overrides: Partial<LiveCoachCapabilityPayload> = {}) {
  return {
    schemaVersion: 1,
    generation: 4,
    issuedAt: '2026-08-27T00:00:00.000Z',
    expiresAt: '2026-08-28T00:00:00.000Z',
    killSwitch: false,
    rules: [],
    models: {},
    ...overrides
  } satisfies LiveCoachCapabilityPayload
}

function createHarness(
  initialFiles: Record<string, unknown>,
  remoteData: unknown,
  now = Date.parse('2026-08-27T12:00:00.000Z')
) {
  const files = new Map(Object.entries(initialFiles))
  const state = new AkariApiState()
  const context = {
    state,
    logger: {
      info: vi.fn(),
      warn: vi.fn()
    },
    settingService: {
      jsonConfigFileExists: vi.fn(async (path: string) => files.has(path)),
      readFromJsonConfigFile: vi.fn(async (path: string) => files.get(path)),
      writeToJsonConfigFile: vi.fn(async (path: string, data: unknown) => {
        files.set(path, data)
      }),
      deleteJsonConfigFile: vi.fn(async (path: string) => {
        files.delete(path)
      })
    },
    api: {
      getConfig: vi.fn(async () => ({ data: remoteData }))
    }
  } as any
  return { context, files, state, now }
}

const loaders: LiveCoachCapabilityLoader[] = []

afterEach(() => {
  for (const loader of loaders.splice(0)) {
    loader.dispose()
  }
})

describe('LiveCoachCapabilityLoader', () => {
  it('redacts local paths, URLs, tokens, and stack lines from capability I/O logs', async () => {
    const harness = createHarness({ [resource.cachePath]: {} }, {})
    harness.context.settingService.readFromJsonConfigFile.mockRejectedValueOnce(
      new Error(
        'Authorization=private-token via https://example.test/private at C:\\Users\\private\\AkariConfig\\capabilities.json\n    at loader.js:1:1'
      )
    )
    const loader = new LiveCoachCapabilityLoader(harness.context, () => harness.now)
    loaders.push(loader)

    await loader.initFromLocal()

    const logged = JSON.stringify(harness.context.logger.warn.mock.calls)
    expect(logged).toContain('[redacted]')
    expect(logged).toContain('[local-path]')
    expect(logged).toContain('[url]')
    expect(logged).not.toContain('private-token')
    expect(logged).not.toContain('C:\\\\Users')
    expect(logged).not.toContain('example.test')
    expect(logged).not.toContain('loader.js')
  })

  it('loads only a verified payload from the signed cache and advances acceptance metadata', async () => {
    const payload = createPayload()
    const fixture = createSignedEnvelope(payload)
    const harness = createHarness({ [resource.cachePath]: fixture.envelope }, fixture.envelope)
    const loader = new LiveCoachCapabilityLoader(
      harness.context,
      () => harness.now,
      (input, options) =>
        verifyLiveCoachCapabilityEnvelope(input, {
          ...options,
          trustedPublicKeys: { 'test-key': fixture.publicKey }
        })
    )
    loaders.push(loader)

    await loader.initFromLocal()

    expect(harness.state.liveCoachCapabilities).toEqual(payload)
    expect(harness.state.liveCoachCapabilityStatus).toBe('valid')
    expect(harness.state.liveCoachCapabilities).not.toHaveProperty('payloadBase64')
    expect(harness.files.get(resource.metadataCachePath)).toEqual({
      generation: 4,
      issuedAt: payload.issuedAt,
      lastAcceptedAt: '2026-08-27T12:00:00.000Z'
    })
  })

  it('deletes an unauthentic cached envelope and fails closed', async () => {
    const payload = createPayload()
    const fixture = createSignedEnvelope(payload)
    const invalidEnvelope = {
      ...fixture.envelope,
      signatureBase64: Buffer.alloc(64).toString('base64')
    }
    const harness = createHarness({ [resource.cachePath]: invalidEnvelope }, invalidEnvelope)
    const loader = new LiveCoachCapabilityLoader(
      harness.context,
      () => harness.now,
      (input, options) =>
        verifyLiveCoachCapabilityEnvelope(input, {
          ...options,
          trustedPublicKeys: { 'test-key': fixture.publicKey }
        })
    )
    loaders.push(loader)

    await loader.initFromLocal()

    expect(harness.files.has(resource.cachePath)).toBe(false)
    expect(harness.state.liveCoachCapabilities).toBeNull()
    expect(harness.state.liveCoachCapabilityStatus).toBe('invalid-signature')
  })

  it('rejects a remotely signed generation rollback using persisted acceptance metadata', async () => {
    const rollback = createPayload({ generation: 4 })
    const fixture = createSignedEnvelope(rollback)
    const harness = createHarness(
      {
        [resource.metadataCachePath]: {
          generation: 5,
          issuedAt: '2026-08-27T01:00:00.000Z',
          lastAcceptedAt: '2026-08-27T10:00:00.000Z'
        }
      },
      fixture.envelope
    )
    const loader = new LiveCoachCapabilityLoader(
      harness.context,
      () => harness.now,
      (input, options) =>
        verifyLiveCoachCapabilityEnvelope(input, {
          ...options,
          trustedPublicKeys: { 'test-key': fixture.publicKey }
        })
    )
    loaders.push(loader)

    await loader.initFromLocal()
    await (loader as any)._updateAndSave()

    expect(harness.state.liveCoachCapabilities).toBeNull()
    expect(harness.state.liveCoachCapabilityStatus).toBe('generation-rollback')
    expect(harness.files.get(resource.metadataCachePath)).toEqual(
      expect.objectContaining({ generation: 5 })
    )
  })

  it('quarantines the last accepted snapshot after a bad remote signature across later polls', async () => {
    const payload = createPayload()
    const acceptedFixture = createSignedEnvelope(payload)
    const invalidEnvelope = {
      ...acceptedFixture.envelope,
      signatureBase64: Buffer.alloc(64).toString('base64')
    }
    const harness = createHarness(
      { [resource.cachePath]: acceptedFixture.envelope },
      invalidEnvelope
    )
    const loader = new LiveCoachCapabilityLoader(
      harness.context,
      () => harness.now,
      (input, options) =>
        verifyLiveCoachCapabilityEnvelope(input, {
          ...options,
          trustedPublicKeys: { 'test-key': acceptedFixture.publicKey }
        })
    )
    loaders.push(loader)

    await loader.initFromLocal()
    expect(harness.state.liveCoachCapabilityStatus).toBe('valid')

    await (loader as any)._updateAndSave()
    expect(harness.state.liveCoachCapabilities).toBeNull()
    expect(harness.state.liveCoachCapabilityStatus).toBe('invalid-signature')
    expect(harness.files.has(resource.cachePath)).toBe(false)

    let resolveRequest!: (value: { data: unknown }) => void
    harness.context.api.getConfig.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )
    const nextPoll = (loader as any)._updateAndSave()
    await vi.waitFor(() => expect(harness.context.api.getConfig).toHaveBeenCalledTimes(2))

    expect(harness.state.liveCoachCapabilities).toBeNull()
    expect(harness.state.liveCoachCapabilityStatus).toBe('invalid-signature')

    resolveRequest({ data: invalidEnvelope })
    await nextPoll
  })

  it('keeps a still-current cached snapshot on transport failure but closes it after expiry', async () => {
    const payload = createPayload()
    const fixture = createSignedEnvelope(payload)
    let now = Date.parse('2026-08-27T12:00:00.000Z')
    const harness = createHarness({ [resource.cachePath]: fixture.envelope }, fixture.envelope, now)
    harness.context.api.getConfig.mockRejectedValue(new Error('offline'))
    const loader = new LiveCoachCapabilityLoader(
      harness.context,
      () => now,
      (input, options) =>
        verifyLiveCoachCapabilityEnvelope(input, {
          ...options,
          trustedPublicKeys: { 'test-key': fixture.publicKey }
        })
    )
    loaders.push(loader)

    await loader.initFromLocal()
    await (loader as any)._updateAndSave()
    expect(harness.state.liveCoachCapabilityStatus).toBe('valid')

    now = Date.parse('2026-08-28T00:00:00.000Z')
    await (loader as any)._updateAndSave()
    expect(harness.state.liveCoachCapabilities).toBeNull()
    expect(harness.state.liveCoachCapabilityStatus).toBe('expired')
  })
})
