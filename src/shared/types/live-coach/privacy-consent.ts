export const CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION = '1.0.0' as const

export interface LiveCoachPrivacyConsentSettings {
  onboardingCompleted?: boolean
  privacyConsentVersion?: string | null
}

/**
 * Privacy consent is valid only for the exact notice version shown to the user.
 * A legacy boolean, an unknown version, or a version from a newer release must fail closed.
 */
export function hasCurrentLiveCoachPrivacyConsent(
  settings: LiveCoachPrivacyConsentSettings
): boolean {
  return (
    settings.onboardingCompleted === true &&
    settings.privacyConsentVersion === CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
  )
}

export function requiresLiveCoachPrivacyReconfirmation(
  settings: LiveCoachPrivacyConsentSettings
): boolean {
  return settings.onboardingCompleted === true && !hasCurrentLiveCoachPrivacyConsent(settings)
}
