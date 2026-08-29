import type { CoachUnavailableReason } from '@shared/types/live-coach'

export {
  CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION,
  hasCurrentLiveCoachPrivacyConsent,
  requiresLiveCoachPrivacyReconfirmation
} from '@shared/types/live-coach'

export const LIVE_COACH_CONSENT_REQUIRED_REASON =
  'consent-required' satisfies CoachUnavailableReason
