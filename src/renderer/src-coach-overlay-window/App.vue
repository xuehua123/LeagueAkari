<template>
  <div
    class="h-full w-full overflow-hidden p-2 select-none"
    :style="{ opacity: coachStore.settings.overlayOpacity }"
  >
    <div
      class="flex h-full w-full flex-col justify-between rounded-lg border p-3 shadow-lg backdrop-blur-md transition-all duration-300"
      :class="[
        coachStore.session.state === 'active'
          ? 'border-blue-500/40 bg-black/60 text-white'
          : 'border-gray-700/40 bg-black/40 text-gray-300'
      ]"
    >
      <!-- 顶栏：状态与模式 -->
      <div class="flex items-center justify-between border-b border-white/10 pb-1 text-xs">
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
          <span>{{
            coachStore.session.state === 'active'
              ? t('liveCoach.overlay.activeTitle', 'AI 教练实时监测中')
              : t('liveCoach.overlay.idleTitle', 'AI 教练空闲')
          }}</span>
        </div>
        <div class="font-mono text-[10px] text-white/50 uppercase">
          {{ coachStore.capture.backend || 'WGC' }} · {{ coachStore.capture.fps }} FPS
        </div>
      </div>

      <!-- 中间内容：提示与观察 -->
      <div class="my-1.5 flex flex-1 flex-col justify-center">
        <div v-if="coachStore.cue" class="space-y-1">
          <div class="flex items-center gap-1.5">
            <span
              class="rounded px-1.5 py-0.5 text-[10px] font-medium"
              :class="[
                coachStore.cue.category === 'warning'
                  ? 'bg-rose-500/80 text-white'
                  : coachStore.cue.category === 'opportunity'
                    ? 'bg-amber-500/80 text-white'
                    : 'bg-blue-500/80 text-white'
              ]"
            >
              {{ coachStore.cue.category.toUpperCase() }}
            </span>
            <span class="text-xs font-semibold tracking-wide">{{
              coachStore.cue.observationText
            }}</span>
          </div>

          <div class="text-xs leading-snug font-medium text-amber-200">
            {{ coachStore.cue.spokenText }}
          </div>

          <div class="flex flex-col gap-1 pt-0.5">
            <span
              v-for="opt of coachStore.cue.options"
              :key="opt.id"
              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import { useTranslation } from 'i18next-vue'

const { t } = useTranslation()
const coachStore = useLiveCoachStore()
</script>

<style scoped>
@reference '@renderer-shared/assets/css/tailwind.css';
</style>
