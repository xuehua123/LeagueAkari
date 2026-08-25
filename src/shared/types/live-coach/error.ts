export type CoachErrorCode =
  | 'unsupported-platform'
  | 'unsupported-map'
  | 'unsupported-queue'
  | 'unsupported-patch'
  | 'capability-disabled'
  | 'consent-required'
  | 'capture-target-not-found'
  | 'capture-permission-denied'
  | 'capture-black-frame'
  | 'capture-stalled'
  | 'capture-crash-loop'
  | 'calibration-required'
  | 'roi-occluded'
  | 'cv-overloaded'
  | 'live-data-unavailable'
  | 'speech-unavailable'
  | 'microphone-unavailable'
  | 'asr-low-confidence'
  | 'provider-credential-missing'
  | 'provider-timeout'
  | 'provider-rate-limited'
  | 'provider-region-unavailable'
  | 'budget-exhausted'
  | 'response-rejected'
  | 'storage-unavailable'
  | 'internal-error'

export interface CoachPublicError {
  code: CoachErrorCode
  stage: string
  recoverable: boolean
  occurredAt: number
  details?: string | null
}
