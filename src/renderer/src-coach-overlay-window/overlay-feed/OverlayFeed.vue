<template>
  <TransitionGroup v-if="feedRows.length" name="overlay-row" tag="div" class="overlay-feed">
    <div
      v-for="row of feedRows"
      :key="row.id"
      class="overlay-feed-row"
      :class="[
        rowToneClass(row),
        row.kind === 'cue' && row.current ? 'overlay-feed-row-primary' : ''
      ]"
    >
      <span class="overlay-row-badge">{{ rowBadge(row) }}</span>
      <span class="overlay-row-text" :title="rowText(row)">{{ rowText(row) }}</span>
      <span v-if="rowMeta(row)" class="overlay-row-meta">{{ rowMeta(row) }}</span>
    </div>
  </TransitionGroup>

  <div v-else class="overlay-empty">
    <span class="overlay-empty-line"></span>
    <span>
      {{
        coachStore.session.state === 'active'
          ? t('liveCoach.overlay.observing')
          : t('liveCoach.overlay.waitingMatch')
      }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import { useTranslation } from 'i18next-vue'
import { computed, onBeforeUnmount, ref } from 'vue'

import { buildOverlayFeed } from '.'
import type { OverlayFeedRow } from '.'

const { t } = useTranslation()
const coachStore = useLiveCoachStore()
const now = ref(Date.now())
const clockTimer = setInterval(() => {
  now.value = Date.now()
}, 1_000)

const feedRows = computed(() =>
  buildOverlayFeed({
    now: now.value,
    sessionId: coachStore.session.id,
    currentCue: coachStore.cue,
    recentCues: coachStore.recentCues,
    cooldowns: coachStore.cooldowns,
    fogInferences: coachStore.fogInferences,
    itemGuidance: coachStore.itemGuidance,
    lastError: coachStore.lastError,
    maxRows: 5
  })
)

function rowBadge(row: OverlayFeedRow) {
  if (row.kind === 'cue') {
    return t(`liveCoach.overlay.badge.${row.cue.category}`)
  }
  return t(`liveCoach.overlay.badge.${row.kind}`)
}

function rowText(row: OverlayFeedRow) {
  switch (row.kind) {
    case 'error':
      return t(
        `liveCoach.diagnostics.unavailableReasons.${row.error.code}`,
        row.error.recoverable
          ? t('liveCoach.overlay.recovering')
          : t('liveCoach.overlay.attentionRequired')
      )
    case 'cue':
      return row.message
    case 'cooldown':
      return row.cooldowns
        .map((cooldown) => `${cooldown.label} ${cooldownTimeText(cooldown)}`)
        .join(' · ')
    case 'fog': {
      const regionId =
        row.inference.predictedRegions[0]?.regionId ??
        row.inference.candidateRoutes[0]?.regionIds.at(-1)
      return regionId
        ? `${enemyTrackLabel(row.inference.enemyTrackId)} → ${regionLabel(regionId)}`
        : enemyTrackLabel(row.inference.enemyTrackId)
    }
    case 'item':
      return row.guidance.primaryPlan.conditions[0] || t('liveCoach.overlay.itemGuidance')
  }
}

function rowMeta(row: OverlayFeedRow) {
  switch (row.kind) {
    case 'error':
      return row.error.recoverable
        ? t('liveCoach.overlay.recoveringShort')
        : t('liveCoach.overlay.attentionShort')
    case 'cue': {
      const seconds = Math.max(0, Math.ceil((row.cue.expiresAt - now.value) / 1_000))
      return seconds > 0 ? `${seconds}s` : ''
    }
    case 'cooldown':
      return ''
    case 'fog':
      return fogMetaText(row.inference)
    case 'item':
      return row.guidance.primaryPlan.missingGold > 0
        ? t('liveCoach.overlay.missingGoldShort', {
            gold: row.guidance.primaryPlan.missingGold
          })
        : t('liveCoach.overlay.affordableShort')
  }
}

function rowToneClass(row: OverlayFeedRow) {
  if (row.kind === 'error') return 'overlay-tone-danger'
  if (row.kind === 'cue') {
    if (row.cue.category === 'warning') return 'overlay-tone-danger'
    if (row.cue.category === 'opportunity') return 'overlay-tone-opportunity'
    if (row.cue.category === 'review') return 'overlay-tone-review'
    if (row.cue.category === 'system') return 'overlay-tone-system'
    return 'overlay-tone-information'
  }
  if (row.kind === 'cooldown') {
    const firstCooldown = row.cooldowns[0]
    return firstCooldown &&
      (firstCooldown.status === 'ready' || firstCooldown.latestReadyAt <= now.value)
      ? 'overlay-tone-ready'
      : 'overlay-tone-timer'
  }
  if (row.kind === 'fog') return 'overlay-tone-opportunity'
  return row.guidance.primaryPlan.missingGold === 0
    ? 'overlay-tone-ready'
    : 'overlay-tone-information'
}

function enemyTrackLabel(trackId: string) {
  const numberedEnemy = /^enemy[-_ ]?(\d+)$/i.exec(trackId)
  if (numberedEnemy) {
    return t('liveCoach.overlay.enemyTrack', { number: numberedEnemy[1] })
  }
  return trackId
}

function regionLabel(regionId: string) {
  return t(`liveCoach.overview.region.${regionId}`, regionId.replaceAll('_', ' '))
}

function cooldownTimeText(
  cooldown: Extract<OverlayFeedRow, { kind: 'cooldown' }>['cooldowns'][number]
) {
  if (cooldown.status === 'ready' || cooldown.latestReadyAt <= now.value) {
    return t('liveCoach.overlay.readyShort')
  }
  const earliest = Math.max(0, Math.ceil((cooldown.earliestReadyAt - now.value) / 1_000))
  const latest = Math.max(earliest, Math.ceil((cooldown.latestReadyAt - now.value) / 1_000))
  return earliest === latest
    ? formatCountdown(earliest)
    : `${formatCountdown(earliest)}–${formatCountdown(latest)}`
}

function fogMetaText(inference: Extract<OverlayFeedRow, { kind: 'fog' }>['inference']) {
  const probability = inference.predictedRegions[0]?.probability ?? inference.confidence
  const confidence = `${Math.round(probability * 100)}%`
  if (!inference.arrivalWindow || inference.arrivalWindow.latestAt <= now.value) return confidence

  const earliest = Math.max(0, Math.ceil((inference.arrivalWindow.earliestAt - now.value) / 1_000))
  const latest = Math.max(
    earliest,
    Math.ceil((inference.arrivalWindow.latestAt - now.value) / 1_000)
  )
  const arrival =
    earliest === latest
      ? formatCountdown(earliest)
      : `${formatCountdown(earliest)}–${formatCountdown(latest)}`
  return `${confidence} · ${arrival}`
}

function formatCountdown(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

onBeforeUnmount(() => clearInterval(clockTimer))
</script>

<style scoped>
.overlay-feed {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding-top: 3px;
}

.overlay-feed-row {
  display: grid;
  min-height: 20px;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 5px;
  border-radius: 3px;
  border-left: 2px solid var(--row-accent);
  background: linear-gradient(90deg, var(--row-surface), transparent 78%);
  padding: 1px 4px 1px 3px;
  color: rgb(255 255 255 / 78%);
}

.overlay-feed-row-primary {
  min-height: 22px;
  color: rgb(255 255 255 / 96%);
}

.overlay-row-badge {
  border-radius: 3px;
  background: var(--row-badge);
  color: var(--row-accent-text);
  font-size: 9px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}

.overlay-row-text {
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  font-weight: 550;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlay-feed-row-primary .overlay-row-text {
  font-size: 12px;
  font-weight: 650;
}

.overlay-row-meta {
  max-width: 92px;
  overflow: hidden;
  color: var(--row-meta);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlay-tone-danger {
  --row-accent: rgb(251 113 133 / 90%);
  --row-badge: rgb(244 63 94 / 24%);
  --row-accent-text: rgb(254 205 211);
  --row-meta: rgb(253 164 175);
  --row-surface: rgb(244 63 94 / 13%);
}

.overlay-tone-opportunity {
  --row-accent: rgb(251 191 36 / 90%);
  --row-badge: rgb(245 158 11 / 22%);
  --row-accent-text: rgb(253 230 138);
  --row-meta: rgb(252 211 77);
  --row-surface: rgb(245 158 11 / 11%);
}

.overlay-tone-information {
  --row-accent: rgb(96 165 250 / 90%);
  --row-badge: rgb(59 130 246 / 22%);
  --row-accent-text: rgb(191 219 254);
  --row-meta: rgb(147 197 253);
  --row-surface: rgb(59 130 246 / 11%);
}

.overlay-tone-timer,
.overlay-tone-system {
  --row-accent: rgb(167 139 250 / 90%);
  --row-badge: rgb(139 92 246 / 22%);
  --row-accent-text: rgb(221 214 254);
  --row-meta: rgb(196 181 253);
  --row-surface: rgb(139 92 246 / 11%);
}

.overlay-tone-review {
  --row-accent: rgb(34 211 238 / 90%);
  --row-badge: rgb(6 182 212 / 22%);
  --row-accent-text: rgb(207 250 254);
  --row-meta: rgb(103 232 249);
  --row-surface: rgb(6 182 212 / 11%);
}

.overlay-tone-ready {
  --row-accent: rgb(52 211 153 / 90%);
  --row-badge: rgb(16 185 129 / 22%);
  --row-accent-text: rgb(167 243 208);
  --row-meta: rgb(110 231 183);
  --row-surface: rgb(16 185 129 / 11%);
}

.overlay-empty {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  gap: 6px;
  color: rgb(255 255 255 / 32%);
  font-size: 11px;
}

.overlay-empty-line {
  width: 14px;
  height: 1px;
  background: rgb(255 255 255 / 18%);
}

.overlay-row-enter-active,
.overlay-row-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.overlay-row-enter-from,
.overlay-row-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@media (max-height: 155px) {
  .overlay-feed-row:nth-child(n + 4) {
    display: none;
  }

  .overlay-feed-row,
  .overlay-feed-row-primary {
    min-height: 19px;
  }

  .overlay-feed-row-primary .overlay-row-text {
    font-size: 11px;
  }
}

@media (max-width: 340px) {
  .overlay-row-meta {
    max-width: 70px;
  }
}
</style>
