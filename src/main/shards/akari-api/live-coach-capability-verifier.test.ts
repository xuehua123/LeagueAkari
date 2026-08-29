import type { LiveCoachCapabilityPayload } from '@shared/types/live-coach'
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  LiveCoachCapabilityVerificationError,
  verifyLiveCoachCapabilityEnvelope
} from './live-coach-capability-verifier'

function createFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const payload: LiveCoachCapabilityPayload = {
    schemaVersion: 1,
    generation: 7,
    issuedAt: '2026-08-27T00:00:00.000Z',
    expiresAt: '2026-08-28T00:00:00.000Z',
    killSwitch: false,
    rules: [
      {
        id: 'coach.capture.screen',
        version: '1',
        enabled: true,
        supportedPlatforms: ['win32'],
        supportedRegions: ['HN1'],
        supportedMaps: [11],
        supportedQueues: [420],
        minPatch: '16.16.1',
        maxPatch: '16.16.1',
        requiredModels: ['minimap-icons']
      }
    ],
    models: {
      'minimap-icons': {
        version: '16.16.1',
        sha256: 'a'.repeat(64),
        url: 'https://example.invalid/minimap-icons.onnx'
      }
    }
  }
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8')
  const envelope = {
    keyId: 'test-key',
    payloadBase64: payloadBytes.toString('base64'),
    signatureBase64: sign(null, payloadBytes, privateKey).toString('base64')
  }
  const options = {
    trustedPublicKeys: {
      'test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString()
    },
    nowMs: Date.parse('2026-08-27T12:00:00.000Z')
  }

  return { envelope, options, payload, privateKey }
}

describe('verifyLiveCoachCapabilityEnvelope', () => {
  it('accepts an authentic, current and monotonic capability snapshot', () => {
    const { envelope, options, payload } = createFixture()

    expect(
      verifyLiveCoachCapabilityEnvelope(envelope, {
        ...options,
        minimumGeneration: 7,
        minimumIssuedAtMs: Date.parse('2026-08-27T00:00:00.000Z'),
        lastAcceptedAtMs: Date.parse('2026-08-27T10:00:00.000Z')
      })
    ).toEqual(payload)
  })

  it.each([
    [
      'invalid-signature',
      (fixture: ReturnType<typeof createFixture>) => ({
        ...fixture.envelope,
        signatureBase64: Buffer.alloc(64).toString('base64')
      })
    ],
    [
      'unknown-key',
      (fixture: ReturnType<typeof createFixture>) => ({
        ...fixture.envelope,
        keyId: 'unknown'
      })
    ]
  ] as const)('fails closed with %s', (status, mutate) => {
    const fixture = createFixture()

    expect(() => verifyLiveCoachCapabilityEnvelope(mutate(fixture), fixture.options)).toThrowError(
      expect.objectContaining<Partial<LiveCoachCapabilityVerificationError>>({ status })
    )
  })

  it('rejects expired, future-clock and rolled-back snapshots', () => {
    const fixture = createFixture()

    expect(() =>
      verifyLiveCoachCapabilityEnvelope(fixture.envelope, {
        ...fixture.options,
        nowMs: Date.parse('2026-08-28T00:00:00.000Z')
      })
    ).toThrowError(expect.objectContaining({ status: 'expired' }))

    expect(() =>
      verifyLiveCoachCapabilityEnvelope(fixture.envelope, {
        ...fixture.options,
        nowMs: Date.parse('2026-08-26T23:00:00.000Z')
      })
    ).toThrowError(expect.objectContaining({ status: 'clock-anomaly' }))

    expect(() =>
      verifyLiveCoachCapabilityEnvelope(fixture.envelope, {
        ...fixture.options,
        minimumGeneration: 8
      })
    ).toThrowError(expect.objectContaining({ status: 'generation-rollback' }))
  })

  it('rejects signed payloads with duplicate rules, undeclared models or non-HTTPS model URLs', () => {
    const fixture = createFixture()
    const invalidPayload = {
      ...fixture.payload,
      rules: [fixture.payload.rules[0], fixture.payload.rules[0]],
      models: {
        'minimap-icons': {
          ...fixture.payload.models['minimap-icons'],
          url: 'http://example.invalid/model.onnx'
        }
      }
    }
    const bytes = Buffer.from(JSON.stringify(invalidPayload), 'utf8')
    const envelope = {
      keyId: fixture.envelope.keyId,
      payloadBase64: bytes.toString('base64'),
      signatureBase64: sign(null, bytes, fixture.privateKey).toString('base64')
    }

    expect(() => verifyLiveCoachCapabilityEnvelope(envelope, fixture.options)).toThrowError(
      expect.objectContaining({ status: 'invalid-payload' })
    )
  })
})
