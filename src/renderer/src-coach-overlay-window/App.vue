<template>
  <div class="box-border h-full w-full overflow-hidden p-1 select-none">
    <div
      class="overlay-shell box-border flex h-full w-full flex-col overflow-hidden rounded-md border"
      :class="[
        isAdjustmentMode
          ? 'overlay-adjusting border-amber-300/70 bg-black/85'
          : isVisualCoachPartial
            ? 'border-amber-300/35 bg-black/72'
            : coachStore.session.state === 'active'
              ? 'border-white/15 bg-black/70'
              : 'border-white/10 bg-black/55'
      ]"
    >
      <SetupInAppScope />

      <div class="overlay-header overlay-drag-handle">
        <template v-if="isAdjustmentMode">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="overlay-adjustment-badge">
              {{ t('liveCoach.overlay.adjustmentBadge') }}
            </span>
            <span class="truncate text-amber-100/85">
              {{ t('liveCoach.overlay.compactAdjustmentHint') }}
            </span>
          </div>
          <NButton
            class="overlay-interaction-control shrink-0"
            size="tiny"
            type="warning"
            :loading="finishingAdjustment"
            @click="handleFinishAdjustment"
          >
            {{ t('liveCoach.overlay.compactLock') }}
          </NButton>
        </template>
        <template v-else>
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="overlay-status-dot" :class="statusDotClass"></span>
            <span class="shrink-0 font-semibold text-white/90">AI</span>
            <span class="text-white/35">·</span>
            <span class="truncate text-white/65">{{ compactStatus }}</span>
          </div>
          <span v-if="compactHealth" class="ml-2 shrink-0" :class="compactHealthClass">
            {{ compactHealth }}
          </span>
        </template>
      </div>

      <OverlayFeed />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { LiveCoachRenderer } from '@renderer-shared/shards/live-coach'
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import { SetupInAppScope } from '@renderer-shared/shards/setup-in-app-scope/setup-in-app-scope-component'
import { useCoachOverlayWindowStore } from '@renderer-shared/shards/window-manager/store'
import { useTranslation } from 'i18next-vue'
import { NButton, useMessage } from 'naive-ui'
import { computed, ref } from 'vue'

import OverlayFeed from './overlay-feed/OverlayFeed.vue'

const { t } = useTranslation()
const message = useMessage()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)
const overlayWindowStore = useCoachOverlayWindowStore()
const isAdjustmentMode = computed(() => overlayWindowStore.interactive)
const visualErrorCodes = new Set([
  'capture-target-not-found',
  'capture-permission-denied',
  'capture-black-frame',
  'capture-stalled',
  'capture-crash-loop',
  'calibration-required',
  'roi-occluded',
  'cv-overloaded'
])
const isVisualCoachPartial = computed(() => {
  if (coachStore.session.state !== 'active') return false
  if (!coachStore.capability.enabledFeatureIds.includes('coach.analyze.minimap-basic')) return true
  if (coachStore.lastError && visualErrorCodes.has(coachStore.lastError.code)) return true
  return (
    !['running', 'replay'].includes(coachStore.capture.state) ||
    !coachStore.capture.backend ||
    coachStore.capture.backend === 'unavailable' ||
    coachStore.capture.roiState !== 'healthy'
  )
})
const finishingAdjustment = ref(false)

const compactStatus = computed(() => {
  if (isVisualCoachPartial.value) return t('liveCoach.overlay.compactState.partial')
  if (coachStore.session.state === 'active') return t('liveCoach.overlay.compactState.active')
  if (coachStore.session.state === 'paused') return t('liveCoach.overlay.compactState.paused')
  return t('liveCoach.overlay.compactState.idle')
})

const statusDotClass = computed(() => {
  if (isVisualCoachPartial.value || coachStore.session.state === 'paused') {
    return 'bg-amber-300 text-amber-300'
  }
  if (coachStore.session.state === 'active') return 'bg-emerald-400 text-emerald-400'
  return 'bg-white/35 text-white/35'
})

const compactHealth = computed(() => {
  if (isVisualCoachPartial.value) {
    return coachStore.lastError && !coachStore.lastError.recoverable
      ? t('liveCoach.overlay.attentionShort')
      : t('liveCoach.overlay.recovering')
  }
  if (coachStore.settings.muted) return t('liveCoach.overlay.mutedShort')
  return ''
})

const compactHealthClass = computed(() =>
  isVisualCoachPartial.value ? 'text-amber-200/80' : 'text-white/45'
)

async function handleFinishAdjustment() {
  if (finishingAdjustment.value) return
  finishingAdjustment.value = true
  try {
    await coachShard.finishOverlayAdjustment()
  } catch (error) {
    message.error(
      t('liveCoach.overlay.finishAdjustmentFailed', {
        error: error instanceof Error ? error.message : String(error)
      })
    )
  } finally {
    finishingAdjustment.value = false
  }
}
</script>

<style scoped>
.overlay-shell {
  padding: 5px 6px 6px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 28%);
  backdrop-filter: blur(6px);
}

.overlay-header {
  display: flex;
  min-height: 20px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
  padding-bottom: 3px;
  color: rgb(255 255 255 / 62%);
  font-size: 10px;
  line-height: 16px;
  -webkit-app-region: drag;
}

.overlay-adjusting {
  box-shadow: 0 4px 16px rgb(245 158 11 / 15%);
  -webkit-app-region: drag;
}

.overlay-interaction-control {
  -webkit-app-region: no-drag;
}

.overlay-adjustment-badge {
  flex-shrink: 0;
  border-radius: 3px;
  background: rgb(252 211 77 / 90%);
  padding: 0 4px;
  color: rgb(17 24 39);
  font-size: 9px;
  font-weight: 700;
}

.overlay-status-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 999px;
  box-shadow: 0 0 7px currentcolor;
}

@media (max-height: 155px) {
  .overlay-shell {
    padding: 4px 5px;
  }
}
</style>
