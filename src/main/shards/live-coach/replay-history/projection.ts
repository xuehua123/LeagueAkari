import {
  REPLAY_HISTORY_MAX_TIMELINE_ITEMS,
  REPLAY_HISTORY_SCHEMA_VERSION,
  type ReplayAnalysisFingerprintInput,
  type ReplayAnalysisMetadata,
  type ReplayAnalysisSourceKind,
  type ReplayAnalysisStoredResult,
  replayAnalysisFingerprintInputSchema,
  replayAnalysisStoredResultSchema
} from '@shared/types/live-coach'
import { createHash } from 'node:crypto'

export interface ReplayAnalysisResultProjectionInput {
  historyId: string
  analysisFingerprint: string
  generatedAt?: string
  summary: {
    sourceKind: ReplayAnalysisSourceKind
    artifactSha256: string
    sidecarSha256: string | null
    metadata: ReplayAnalysisMetadata
    durationSeconds: number
    frameCount: number
    analysisFps: number
    totalCues: number
    totalEvidences: number
  }
  capabilityStatus: {
    available: string[]
    disabled: Array<{ capability: string; reason: string }>
    missingFields: string[]
  }
  timeline: Array<{
    gameTimeMs?: number
    gameTimeFormatted?: string
    category: string
    observation: string
    spokenText: string
    options: string[]
    evidenceIds: string[]
  }>
}

export function createReplayAnalysisFingerprint(input: ReplayAnalysisFingerprintInput): string {
  const validated = replayAnalysisFingerprintInputSchema.parse(input)
  return createHash('sha256').update(canonicalJson(validated)).digest('hex')
}

/**
 * Projects an in-memory replay result onto the persisted allowlist. The caller must
 * supply the fields explicitly; source paths, filenames, previews, frames and raw
 * sidecar payloads have no slot in the returned contract.
 */
export function projectReplayAnalysisResult(
  input: ReplayAnalysisResultProjectionInput
): ReplayAnalysisStoredResult {
  const result: ReplayAnalysisStoredResult = {
    schemaVersion: REPLAY_HISTORY_SCHEMA_VERSION,
    historyId: input.historyId,
    analysisFingerprint: input.analysisFingerprint,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary: {
      sourceKind: input.summary.sourceKind,
      artifactSha256: input.summary.artifactSha256,
      sidecarSha256: input.summary.sidecarSha256,
      metadata: input.summary.metadata,
      durationSeconds: input.summary.durationSeconds,
      frameCount: input.summary.frameCount,
      analysisFps: input.summary.analysisFps,
      totalCues: input.summary.totalCues,
      totalEvidences: input.summary.totalEvidences
    },
    capabilityStatus: {
      available: sanitizeIdentifierList(input.capabilityStatus.available),
      disabled: input.capabilityStatus.disabled.slice(0, 128).map((item) => ({
        capability: sanitizeIdentifier(item.capability),
        reason: sanitizeIdentifier(item.reason)
      })),
      missingFields: sanitizeIdentifierList(input.capabilityStatus.missingFields)
    },
    timeline: input.timeline.slice(0, REPLAY_HISTORY_MAX_TIMELINE_ITEMS).map((item) => ({
      gameTimeMs: resolveGameTimeMs(item),
      category: sanitizeRequiredText(item.category, 128, 'unknown'),
      observation: sanitizeRequiredText(item.observation, 2_048, 'unknown'),
      spokenText: sanitizeText(item.spokenText, 2_048),
      options: item.options
        .slice(0, 8)
        .map((option) => sanitizeRequiredText(option, 512, 'unknown')),
      evidenceHashes: Array.from(
        new Set(
          item.evidenceIds
            .slice(0, 32)
            .map((evidenceId) => createHash('sha256').update(evidenceId).digest('hex'))
        )
      )
    }))
  }

  return replayAnalysisStoredResultSchema.parse(result)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function resolveGameTimeMs(item: { gameTimeMs?: number; gameTimeFormatted?: string }): number {
  if (Number.isFinite(item.gameTimeMs)) {
    return Math.max(0, Math.min(4 * 60 * 60 * 1_000, Math.round(item.gameTimeMs!)))
  }

  const parts = item.gameTimeFormatted?.split(':').map(Number) ?? []
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return 0
  }
  const seconds =
    parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 60 * 60 + parts[1] * 60 + parts[2]
  return Math.max(0, Math.min(4 * 60 * 60 * 1_000, seconds * 1_000))
}

function sanitizeIdentifierList(values: string[]): string[] {
  return Array.from(new Set(values.slice(0, 128).map(sanitizeIdentifier)))
}

function sanitizeIdentifier(value: string): string {
  return sanitizeRequiredText(value, 128, 'unknown')
}

function sanitizeRequiredText(value: string, maximumLength: number, fallback: string): string {
  const sanitized = sanitizeText(value, maximumLength)
  return sanitized || fallback
}

function sanitizeText(value: string, maximumLength: number): string {
  return redactReplaySensitiveText(value).trim().slice(0, maximumLength)
}

export function redactReplaySensitiveText(value: string): string {
  return value
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;)"'<>|]*/g, '[local-path]')
    .replace(/(^|[\s("'`])\/[^\r\n,;)"'`<>]*/g, (_match, prefix: string) => `${prefix}[local-path]`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(
      /\b((?:access|auth|riot|api)[_-]?token|authorization)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    )
}
