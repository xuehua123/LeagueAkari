import { describe, expect, it } from 'vitest'

import {
  CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION,
  hasCurrentLiveCoachPrivacyConsent,
  requiresLiveCoachPrivacyReconfirmation
} from './privacy-consent'

describe('Live Coach privacy consent version', () => {
  it('does not migrate a legacy boolean-only setting into current consent', () => {
    const legacySettings = { onboardingCompleted: true }

    expect(hasCurrentLiveCoachPrivacyConsent(legacySettings)).toBe(false)
    expect(requiresLiveCoachPrivacyReconfirmation(legacySettings)).toBe(true)
  })

  it('accepts only an affirmative consent for the exact current notice version', () => {
    expect(
      hasCurrentLiveCoachPrivacyConsent({
        onboardingCompleted: true,
        privacyConsentVersion: CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
      })
    ).toBe(true)
  })

  it.each([null, '', '0.9.0', '2.0.0', 'not-a-version'])(
    'rejects missing, older, future, or malformed notice version %j',
    (privacyConsentVersion) => {
      expect(
        hasCurrentLiveCoachPrivacyConsent({ onboardingCompleted: true, privacyConsentVersion })
      ).toBe(false)
    }
  )

  it('treats withdrawal as no consent even when the stored version is current', () => {
    const withdrawnSettings = {
      onboardingCompleted: false,
      privacyConsentVersion: CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
    }

    expect(hasCurrentLiveCoachPrivacyConsent(withdrawnSettings)).toBe(false)
    expect(requiresLiveCoachPrivacyReconfirmation(withdrawnSettings)).toBe(false)
  })
})
