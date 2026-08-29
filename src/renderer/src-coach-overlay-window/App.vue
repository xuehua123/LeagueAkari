<template>
  <div class="box-border h-full w-full overflow-hidden p-2 select-none">
    <div
      class="box-border flex h-full w-full flex-col justify-between rounded-lg border p-3 shadow-lg backdrop-blur-md transition-all duration-300"
      :class="[
        coachStore.session.state === 'active'
          ? 'border-blue-500/40 bg-black/60 text-white'
          : 'border-gray-700/40 bg-black/40 text-gray-300'
      ]"
    >
      <SetupInAppScope />
      <!-- 顶栏：状态与模式 -->
      <div
        class="overlay-drag-handle flex items-center justify-between border-b border-white/10 pb-1 text-xs"
      >
        <div class="flex items-center gap-1.5 font-medium">
          <span
            class="h-2 w-2 animate-pulse rounded-full"
            :class="[
              coachStore.session.state === 'active'
                ? 'bg-emerald-400'
                : coachStore.session.state === 'paused'
                  ? 'bg-amber-400'
                  : 'bg-gray-400'
            ]"
          ></span>
          <span>
            {{
              coachStore.session.state === 'active'
                ? t('liveCoach.overlay.activeTitle', 'AI 教练实时监测中')
                : coachStore.session.state === 'paused'
                  ? t('liveCoach.overlay.pausedTitle', 'AI 教练已暂停')
                  : t('liveCoach.overlay.idleTitle', 'AI 教练空闲')
            }}
            <template
              v-if="coachStore.session.state === 'paused' && coachStore.session.pauseReason"
            >
              ·
              {{
                t(
                  `liveCoach.overlay.pauseReason.${coachStore.session.pauseReason}`,
                  coachStore.session.pauseReason
                )
              }}
            </template>
          </span>
        </div>
        <div class="font-mono text-[10px] text-white/50 uppercase">
          {{
            coachStore.capture.backend || t('liveCoach.overlay.backendUnavailable', '采集不可用')
          }}
          · {{ coachStore.capture.fps }} FPS
        </div>
      </div>

      <!-- 中间内容：提示与观察 -->
      <div class="my-1 flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
        <div v-if="displayedCue" class="space-y-1">
          <div class="flex items-center gap-1.5">
            <span
              class="rounded px-1.5 py-0.5 text-[10px] font-medium"
              :class="[
                displayedCue.category === 'warning'
                  ? 'bg-rose-500/80 text-white'
                  : displayedCue.category === 'opportunity'
                    ? 'bg-amber-500/80 text-white'
                    : 'bg-blue-500/80 text-white'
              ]"
            >
              {{ displayedCue.category.toUpperCase() }}
            </span>
            <span v-if="!coachStore.cue" class="text-[10px] text-white/50">
              {{ t('liveCoach.overlay.recentCue', '最近') }}
            </span>
            <span class="truncate text-xs font-semibold tracking-wide">
              {{ displayedCue.observationText }}
            </span>
            <span v-if="cueRemainingSeconds > 0" class="ml-auto text-[10px] text-white/50">
              {{ cueRemainingSeconds }}s
            </span>
          </div>

          <div class="line-clamp-2 text-xs leading-snug font-medium text-amber-200">
            {{ displayedCue.spokenText }}
          </div>

          <div class="flex flex-col gap-0.5 pt-0.5">
            <span
              v-for="opt of displayedCue.options"
              :key="opt.id"
              class="flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px]"
              :class="[
                opt.role === 'primary'
                  ? 'border border-blue-400/40 bg-blue-500/20 font-medium text-blue-200'
                  : 'bg-white/10 text-white/80'
              ]"
            >
              <span
                v-if="opt.role === 'primary'"
                class="rounded bg-blue-500/80 px-1 text-[9px] text-white"
              >
                {{ t('liveCoach.overlay.rolePrimary', '首选') }}
              </span>
              <span
                v-else-if="opt.role === 'alternative'"
                class="rounded bg-white/20 px-1 text-[9px] text-white/80"
              >
                {{ t('liveCoach.overlay.roleAlternative', '备选') }}
              </span>
              <span>{{ opt.label }}</span>
            </span>
          </div>
        </div>

        <div v-else class="py-2 text-center text-xs text-white/40 italic">
          {{ t('liveCoach.overlay.waiting', '等待战术时机触发...') }}
        </div>
      </div>

      <div class="flex items-center gap-2 border-t border-white/10 pt-1 text-[10px] text-white/55">
        <span>
          ROI
          {{
            t(
              `liveCoach.overlay.roiState.${coachStore.capture.roiState}`,
              coachStore.capture.roiState
            )
          }}
        </span>
        <span>
          {{
            coachStore.capture.confidence === null
              ? '--'
              : `${Math.round(coachStore.capture.confidence * 100)}%`
          }}
        </span>
        <span class="truncate">
          {{ outputStatus }}
        </span>
        <span
          v-if="coachStore.lastError"
          class="ml-auto max-w-[42%] truncate text-rose-300"
          :title="coachStore.lastError.details || coachStore.lastError.code"
        >
          {{ coachStore.lastError.code }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import { SetupInAppScope } from '@renderer-shared/shards/setup-in-app-scope/setup-in-app-scope-component'
import { useTranslation } from 'i18next-vue'
import { computed, onBeforeUnmount, ref } from 'vue'

const { t } = useTranslation()
const coachStore = useLiveCoachStore()
const now = ref(Date.now())
const clockTimer = setInterval(() => {
  now.value = Date.now()
}, 1000)

const displayedCue = computed(() => {
  if (coachStore.cue) return coachStore.cue
  const recentCue = coachStore.recentCues.toReversed().find((cue) => cue.status === 'spoken')
  if (!recentCue || recentCue.sessionId !== coachStore.session.id) return null
  return now.value <= recentCue.expiresAt + 10_000 ? recentCue : null
})

const cueRemainingSeconds = computed(() =>
  displayedCue.value ? Math.max(0, Math.ceil((displayedCue.value.expiresAt - now.value) / 1000)) : 0
)

const outputStatus = computed(() => {
  if (coachStore.settings.muted) return t('liveCoach.overlay.outputMuted', '静音')
  const labels = coachStore.settings.outputMode.map((mode) =>
    t(`liveCoach.overlay.output.${mode}`, mode)
  )
  return labels.length ? labels.join('+') : t('liveCoach.overlay.outputOff', '无输出')
})

onBeforeUnmount(() => clearInterval(clockTimer))
</script>

<style scoped>
.overlay-drag-handle {
  -webkit-app-region: drag;
}
</style>
