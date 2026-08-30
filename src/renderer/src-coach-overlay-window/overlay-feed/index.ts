import type {
  CoachCooldownRecord,
  CoachCuePublicDto,
  CoachPublicError,
  FogInference,
  ItemPurchaseGuidance
} from '@shared/types/live-coach'

export type OverlayFeedRow =
  | {
      id: string
      kind: 'error'
      error: CoachPublicError
    }
  | {
      id: string
      kind: 'cue'
      cue: CoachCuePublicDto
      message: string
      current: boolean
    }
  | {
      id: string
      kind: 'cooldown'
      cooldowns: CoachCooldownRecord[]
    }
  | {
      id: string
      kind: 'fog'
      inference: FogInference
    }
  | {
      id: string
      kind: 'item'
      guidance: ItemPurchaseGuidance
    }

export interface BuildOverlayFeedInput {
  now: number
  sessionId: string | null
  currentCue: CoachCuePublicDto | null
  recentCues: CoachCuePublicDto[]
  cooldowns: CoachCooldownRecord[]
  fogInferences: FogInference[]
  itemGuidance: ItemPurchaseGuidance | null
  lastError: CoachPublicError | null
  maxRows?: number
}

interface RankedRow {
  rank: number
  createdAt: number
  row: OverlayFeedRow
}

const DISPLAYABLE_CUE_STATUSES = new Set<CoachCuePublicDto['status']>([
  'pending',
  'speaking',
  'spoken'
])
const READY_COOLDOWN_LIFETIME_MS = 5_000
const MINIMUM_FOG_CONFIDENCE = 0.55

const COOLDOWN_KIND_WEIGHT: Record<CoachCooldownRecord['kind'], number> = {
  objective: 500,
  ultimate: 440,
  'summoner-spell': 420,
  'jungle-camp': 360,
  ability: 300,
  ward: 240
}

function belongsToSession(sessionId: string | null, candidateSessionId: string) {
  return sessionId !== null && candidateSessionId === sessionId
}

function isCueDisplayable(cue: CoachCuePublicDto, sessionId: string | null, now: number) {
  return (
    belongsToSession(sessionId, cue.sessionId) &&
    DISPLAYABLE_CUE_STATUSES.has(cue.status) &&
    now <= cue.expiresAt
  )
}

function cueMessage(cue: CoachCuePublicDto) {
  return (
    cue.options.find((option) => option.role === 'primary')?.label.trim() ||
    cue.spokenText.trim() ||
    cue.observationText.trim()
  )
}

function cooldownRank(cooldown: CoachCooldownRecord, now: number) {
  const secondsUntilReady = Math.max(0, (cooldown.earliestReadyAt - now) / 1000)
  const urgency = Math.max(0, 360 - Math.min(360, secondsUntilReady))
  const imminentBoost = secondsUntilReady <= 60 ? 300 : 0
  return 7_000 + COOLDOWN_KIND_WEIGHT[cooldown.kind] + urgency + imminentBoost
}

export function buildOverlayFeed(input: BuildOverlayFeedInput): OverlayFeedRow[] {
  const maxRows = Math.max(1, Math.min(8, input.maxRows ?? 5))
  const candidates: RankedRow[] = []

  if (input.lastError) {
    candidates.push({
      rank: 10_000,
      createdAt: input.lastError.occurredAt,
      row: {
        id: `error:${input.lastError.code}:${input.lastError.occurredAt}`,
        kind: 'error',
        error: input.lastError
      }
    })
  }

  const currentCueMessage = input.currentCue ? cueMessage(input.currentCue) : ''
  const hasCurrentCue = Boolean(
    input.currentCue &&
    currentCueMessage &&
    isCueDisplayable(input.currentCue, input.sessionId, input.now)
  )
  if (input.currentCue && hasCurrentCue) {
    candidates.push({
      rank: 9_200 + input.currentCue.priority,
      createdAt: input.currentCue.createdAt,
      row: {
        id: `cue:${input.currentCue.id}`,
        kind: 'cue',
        cue: input.currentCue,
        message: currentCueMessage,
        current: true
      }
    })
  }

  const recentCue = hasCurrentCue
    ? undefined
    : [...input.recentCues]
        .filter(
          (cue) => cueMessage(cue).length > 0 && isCueDisplayable(cue, input.sessionId, input.now)
        )
        .sort(
          (left, right) => right.priority - left.priority || right.createdAt - left.createdAt
        )[0]

  if (recentCue) {
    candidates.push({
      rank: 8_200 + recentCue.priority,
      createdAt: recentCue.createdAt,
      row: {
        id: `cue:${recentCue.id}`,
        kind: 'cue',
        cue: recentCue,
        message: cueMessage(recentCue),
        current: false
      }
    })
  }

  const cooldownCandidates = input.cooldowns
    .filter(
      (cooldown) =>
        belongsToSession(input.sessionId, cooldown.sessionId) &&
        cooldown.status !== 'cancelled' &&
        (cooldown.status === 'running'
          ? input.now <= cooldown.latestReadyAt
          : input.now <= cooldown.latestReadyAt + READY_COOLDOWN_LIFETIME_MS)
    )
    .map((cooldown) => ({
      cooldown,
      rank: cooldownRank(cooldown, input.now)
    }))
    .sort(
      (left, right) =>
        right.rank - left.rank || left.cooldown.earliestReadyAt - right.cooldown.earliestReadyAt
    )
    .slice(0, 2)

  if (cooldownCandidates.length > 0) {
    const cooldowns = cooldownCandidates.map(({ cooldown }) => cooldown)
    candidates.push({
      rank: cooldownCandidates[0].rank,
      createdAt: Math.max(...cooldowns.map((cooldown) => cooldown.observedAt)),
      row: {
        id: `cooldown:${cooldowns.map((cooldown) => cooldown.id).join(':')}`,
        kind: 'cooldown',
        cooldowns
      }
    })
  }

  const fogInference = input.fogInferences
    .filter(
      (inference) =>
        belongsToSession(input.sessionId, inference.sessionId) &&
        input.now <= inference.expiresAt &&
        inference.confidence >= MINIMUM_FOG_CONFIDENCE &&
        (inference.predictedRegions.length > 0 || inference.candidateRoutes.length > 0)
    )
    .sort(
      (left, right) => right.confidence - left.confidence || right.createdAt - left.createdAt
    )[0]

  if (fogInference) {
    candidates.push({
      rank: 6_000 + fogInference.confidence * 100,
      createdAt: fogInference.createdAt,
      row: {
        id: `fog:${fogInference.id}`,
        kind: 'fog',
        inference: fogInference
      }
    })
  }

  if (
    input.itemGuidance &&
    belongsToSession(input.sessionId, input.itemGuidance.sessionId) &&
    input.now <= input.itemGuidance.expiresAt
  ) {
    candidates.push({
      rank: 5_000 + (input.itemGuidance.primaryPlan.missingGold === 0 ? 200 : 0),
      createdAt: input.itemGuidance.createdAt,
      row: {
        id: `item:${input.itemGuidance.id}`,
        kind: 'item',
        guidance: input.itemGuidance
      }
    })
  }

  return candidates
    .sort((left, right) => right.rank - left.rank || right.createdAt - left.createdAt)
    .slice(0, maxRows)
    .map(({ row }) => row)
}
