import type {
  CoachCapabilityId,
  LiveCoachCapabilityPayload,
  LiveCoachCapabilityRule
} from '@shared/types/live-coach'

import { CURRENT_LIVE_COACH_PATCH } from './catalog/current'

export const PHASE_ONE_CAPABILITY_IDS: readonly CoachCapabilityId[] = Object.freeze([
  'coach.offline-review',
  'coach.capture.screen',
  'coach.analyze.minimap-basic',
  'coach.analyze.minimap-advanced',
  'coach.analyze.minimap-identity',
  'coach.analyze.fog-inference',
  'coach.guidance.item-purchase',
  'coach.guidance.micro',
  'coach.track.cooldowns',
  'coach.communication.ping',
  'coach.communication.chat',
  'coach.output.subtitle',
  'coach.output.sound',
  'coach.output.tts'
])

const INTERNAL_SUMMONERS_RIFT_QUEUES = Object.freeze([0, 400, 420, 430, 440])
const PATCH_LOCKED_CAPABILITIES = new Set<CoachCapabilityId>([
  'coach.analyze.minimap-identity',
  'coach.analyze.fog-inference',
  'coach.guidance.item-purchase',
  'coach.guidance.micro',
  'coach.track.cooldowns'
])

function createInternalRule(id: CoachCapabilityId): LiveCoachCapabilityRule {
  if (id === 'coach.offline-review') {
    return { id, version: '1', enabled: true, supportedPlatforms: ['win32'] }
  }

  return {
    id,
    version: '1',
    enabled: true,
    supportedPlatforms: ['win32'],
    supportedMaps: [11],
    supportedQueues: [...INTERNAL_SUMMONERS_RIFT_QUEUES],
    ...(PATCH_LOCKED_CAPABILITIES.has(id)
      ? { minPatch: CURRENT_LIVE_COACH_PATCH, maxPatch: CURRENT_LIVE_COACH_PATCH }
      : {})
  }
}

/**
 * Development builds bypass only external distribution approval. They still
 * consume a single explicit policy and therefore keep the same map, queue,
 * patch, runtime-health and user-consent boundaries as public builds.
 */
export const INTERNAL_LIVE_COACH_CAPABILITY_POLICY: LiveCoachCapabilityPayload = Object.freeze({
  schemaVersion: 1,
  generation: 0,
  issuedAt: '2026-08-27T00:00:00.000Z',
  expiresAt: '9999-12-31T23:59:59.999Z',
  killSwitch: false,
  rules: PHASE_ONE_CAPABILITY_IDS.map(createInternalRule),
  models: {}
})
