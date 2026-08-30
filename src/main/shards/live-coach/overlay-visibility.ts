import type { CoachSessionState } from '@shared/types/live-coach'

export interface CoachOverlayVisibilitySnapshot {
  coachEnabled: boolean
  overlayEnabled: boolean
  overlayInteractive: boolean
  sessionState: CoachSessionState
  windowReady: boolean
}

export function shouldShowCoachOverlay({
  coachEnabled,
  overlayEnabled,
  overlayInteractive,
  sessionState,
  windowReady
}: CoachOverlayVisibilitySnapshot): boolean {
  return (
    windowReady &&
    (overlayInteractive ||
      (coachEnabled && overlayEnabled && (sessionState === 'active' || sessionState === 'paused')))
  )
}
