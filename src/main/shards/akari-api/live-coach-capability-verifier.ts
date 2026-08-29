import {
  type LiveCoachCapabilityEnvelope,
  type LiveCoachCapabilityPayload,
  type LiveCoachCapabilitySnapshotStatus,
  liveCoachCapabilityEnvelopeSchema,
  liveCoachCapabilityPayloadSchema
} from '@shared/types/live-coach'
import { createPublicKey, verify } from 'node:crypto'
import { TextDecoder } from 'node:util'

export const LIVE_COACH_CAPABILITY_KEY_ID = 'league-akari-live-coach-2026-01'

/**
 * Only the public half is shipped. The matching private key belongs in the
 * capability publishing environment and must never be bundled with the app.
 */
export const LIVE_COACH_CAPABILITY_PUBLIC_KEYS: Readonly<Record<string, string>> = Object.freeze({
  [LIVE_COACH_CAPABILITY_KEY_ID]: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAN6QetVLuhnFgcLTjfyYe17TMHLHlPiwn81GC4FRLdRg=
-----END PUBLIC KEY-----`
})

export interface LiveCoachCapabilityVerificationOptions {
  nowMs?: number
  minimumGeneration?: number | null
  minimumIssuedAtMs?: number | null
  lastAcceptedAtMs?: number | null
  clockSkewToleranceMs?: number
  trustedPublicKeys?: Readonly<Record<string, string>>
}

export class LiveCoachCapabilityVerificationError extends Error {
  constructor(
    public readonly status: Exclude<LiveCoachCapabilitySnapshotStatus, 'unavailable' | 'valid'>,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'LiveCoachCapabilityVerificationError'
  }
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function decodeCanonicalBase64(value: string, fieldName: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new LiveCoachCapabilityVerificationError(
      'invalid-envelope',
      `${fieldName} is not canonical Base64`
    )
  }

  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new LiveCoachCapabilityVerificationError(
      'invalid-envelope',
      `${fieldName} is not canonical Base64`
    )
  }
  return decoded
}

export function verifyLiveCoachCapabilityEnvelope(
  input: LiveCoachCapabilityEnvelope | unknown,
  options: LiveCoachCapabilityVerificationOptions = {}
): LiveCoachCapabilityPayload {
  const envelopeResult = liveCoachCapabilityEnvelopeSchema.safeParse(input)
  if (!envelopeResult.success) {
    throw new LiveCoachCapabilityVerificationError(
      'invalid-envelope',
      'Live coach capability envelope has an invalid shape',
      { cause: envelopeResult.error }
    )
  }

  const envelope = envelopeResult.data
  const trustedPublicKeys = options.trustedPublicKeys ?? LIVE_COACH_CAPABILITY_PUBLIC_KEYS
  const publicKeyPem = trustedPublicKeys[envelope.keyId]
  if (!publicKeyPem) {
    throw new LiveCoachCapabilityVerificationError(
      'unknown-key',
      `Unknown live coach capability key: ${envelope.keyId}`
    )
  }

  const payloadBytes = decodeCanonicalBase64(envelope.payloadBase64, 'payloadBase64')
  const signatureBytes = decodeCanonicalBase64(envelope.signatureBase64, 'signatureBase64')
  if (signatureBytes.byteLength !== 64) {
    throw new LiveCoachCapabilityVerificationError(
      'invalid-envelope',
      'Ed25519 signatures must be exactly 64 bytes'
    )
  }

  let signatureValid = false
  try {
    signatureValid = verify(null, payloadBytes, createPublicKey(publicKeyPem), signatureBytes)
  } catch (error) {
    throw new LiveCoachCapabilityVerificationError(
      'unknown-key',
      `Invalid public key for live coach capability key: ${envelope.keyId}`,
      { cause: error }
    )
  }
  if (!signatureValid) {
    throw new LiveCoachCapabilityVerificationError(
      'invalid-signature',
      'Live coach capability signature verification failed'
    )
  }

  let decodedPayload: unknown
  try {
    decodedPayload = JSON.parse(utf8Decoder.decode(payloadBytes))
  } catch (error) {
    throw new LiveCoachCapabilityVerificationError(
      'invalid-payload',
      'Live coach capability payload is not valid UTF-8 JSON',
      { cause: error }
    )
  }

  const payloadResult = liveCoachCapabilityPayloadSchema.safeParse(decodedPayload)
  if (!payloadResult.success) {
    throw new LiveCoachCapabilityVerificationError(
      'invalid-payload',
      'Live coach capability payload failed schema validation',
      { cause: payloadResult.error }
    )
  }

  const payload = payloadResult.data
  const nowMs = options.nowMs ?? Date.now()
  const toleranceMs = options.clockSkewToleranceMs ?? 5 * 60 * 1000
  const issuedAtMs = Date.parse(payload.issuedAt)
  const expiresAtMs = Date.parse(payload.expiresAt)

  if (nowMs + toleranceMs < issuedAtMs) {
    throw new LiveCoachCapabilityVerificationError(
      'clock-anomaly',
      'System clock is earlier than capability issue time'
    )
  }
  if (
    options.lastAcceptedAtMs !== null &&
    options.lastAcceptedAtMs !== undefined &&
    nowMs + toleranceMs < options.lastAcceptedAtMs
  ) {
    throw new LiveCoachCapabilityVerificationError(
      'clock-anomaly',
      'System clock moved backwards after a capability snapshot was accepted'
    )
  }
  if (nowMs >= expiresAtMs) {
    throw new LiveCoachCapabilityVerificationError(
      'expired',
      'Live coach capability snapshot has expired'
    )
  }
  if (
    options.minimumGeneration !== null &&
    options.minimumGeneration !== undefined &&
    payload.generation < options.minimumGeneration
  ) {
    throw new LiveCoachCapabilityVerificationError(
      'generation-rollback',
      'Live coach capability generation moved backwards'
    )
  }
  if (
    options.minimumIssuedAtMs !== null &&
    options.minimumIssuedAtMs !== undefined &&
    issuedAtMs < options.minimumIssuedAtMs
  ) {
    throw new LiveCoachCapabilityVerificationError(
      'generation-rollback',
      'Live coach capability issue time moved backwards within the same generation'
    )
  }

  return payload
}

export function getLiveCoachCapabilityVerificationStatus(
  error: unknown
): Exclude<LiveCoachCapabilitySnapshotStatus, 'unavailable' | 'valid'> {
  return error instanceof LiveCoachCapabilityVerificationError ? error.status : 'invalid-payload'
}
