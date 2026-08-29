import {
  type CoachPublicError,
  type WorkerToMainMessage,
  coachPublicErrorSchema
} from '@shared/types/live-coach'

type WorkerErrorMessage = Extract<WorkerToMainMessage, { type: 'error' }>

const WORKER_ERROR_POLICIES: Record<
  string,
  Pick<CoachPublicError, 'code' | 'stage' | 'details'>
> = {
  LC_ERR_NATIVE_CAPTURE_UNAVAILABLE: {
    code: 'capture-stalled',
    stage: 'minimap-capture',
    details: null
  },
  LC_ERR_NATIVE_CAPTURE_FAILED: {
    code: 'capture-stalled',
    stage: 'minimap-capture',
    details: null
  },
  LC_ERR_WGC_CAPTURE_FAILED_DDA_ACTIVE: {
    code: 'capture-stalled',
    stage: 'minimap-capture',
    details: null
  },
  LC_ERR_IDENTITY_MODEL_LOAD_FAILED: {
    code: 'internal-error',
    stage: 'minimap-identity-model',
    details: null
  },
  LC_ERR_CV_INFERENCE_FAIL: {
    code: 'internal-error',
    stage: 'minimap-inference',
    details: null
  },
  LC_ERR_REPLAY_CV_INFERENCE_FAIL: {
    code: 'internal-error',
    stage: 'replay-inference',
    details: null
  },
  LC_ERR_PROTOCOL_INVALID: {
    code: 'internal-error',
    stage: 'minimap-worker-protocol',
    details: null
  },
  LC_ERR_WORKER_MESSAGE_HANDLER_FAILED: {
    code: 'internal-error',
    stage: 'minimap-worker-protocol',
    details: null
  }
}

const DEFAULT_WORKER_ERROR_POLICY = {
  code: 'internal-error',
  stage: 'minimap-capture',
  details: null
} as const satisfies Pick<CoachPublicError, 'code' | 'stage' | 'details'>

export function createWorkerPublicError(
  message: WorkerErrorMessage,
  occurredAt: number = Date.now()
): CoachPublicError {
  const policy = WORKER_ERROR_POLICIES[message.code] ?? DEFAULT_WORKER_ERROR_POLICY
  return coachPublicErrorSchema.parse({
    ...policy,
    recoverable: message.recoverable,
    occurredAt
  })
}

export function createSanitizedPublicError(
  error: Omit<CoachPublicError, 'occurredAt'>,
  occurredAt: number = Date.now()
): CoachPublicError {
  return coachPublicErrorSchema.parse({
    ...error,
    stage: sanitizeStage(error.stage),
    details: sanitizePublicErrorDetails(error.details),
    occurredAt
  })
}

export function sanitizePublicErrorDetails(value: string | null | undefined): string | null {
  if (!value) return null

  const firstLine = value.split(/\r?\n/, 1)[0]
  const sanitized = firstLine
    .replace(/\bfile:\/\/\/?[^\s,;)"'<>]+/gi, '[local-path]')
    .replace(/\\\\[^\\\s]+\\[^\r\n,;)"'<>]*/g, '[local-path]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;)"'<>|]*/g, '[local-path]')
    .replace(
      /(^|[\s("'`])\/(?:Users|home|tmp|var|opt|private|Applications|Volumes)\/[^\r\n,;)"'`<>]*/gi,
      '$1[local-path]'
    )
    .replace(/\bhttps?:\/\/[^\s,;)"'<>]+/gi, '[url]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(
      /\b((?:access|auth|riot|api)[_-]?token|authorization)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    )
    .trim()
    .slice(0, 500)

  return sanitized || null
}

export function sanitizeCaughtErrorDetails(error: unknown): string | null {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : null
  return sanitizePublicErrorDetails(rawMessage)
}

export function formatSanitizedErrorLog(prefix: string, error: unknown): string {
  const details = sanitizeCaughtErrorDetails(error)
  return details ? `${prefix}: ${details}` : prefix
}

function sanitizeStage(stage: string): string {
  const sanitized = stage
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 128)
  return sanitized || 'internal'
}
