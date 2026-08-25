<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.diagnostics.title', '运行诊断与状态监控')">
      <div class="space-y-3">
        <!-- 系统支持矩阵 -->
        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="mb-1 text-sm font-medium">
            {{ t('liveCoach.diagnostics.matrixTitle', '系统支持矩阵与能力检查') }}
          </div>
          <div class="space-y-1 text-xs text-gray-500">
            <div>
              {{ t('liveCoach.diagnostics.platform', '运行平台:') }}
              <span
                :class="as.isWindows ? 'font-medium text-emerald-600' : 'font-medium text-rose-500'"
              >
                {{ as.isWindows ? 'Windows' : 'Non-Windows' }}
              </span>
            </div>
            <div>
              {{ t('liveCoach.diagnostics.backend', '采集后端:') }}
              <span class="font-mono text-gray-700 dark:text-gray-300">
                {{ coachStore.capture.backend ? coachStore.capture.backend.toUpperCase() : 'N/A' }}
              </span>
            </div>
            <div>
              {{ t('liveCoach.diagnostics.features', '已启用能力特性:') }}
              <span class="font-mono text-gray-700 dark:text-gray-300">
                {{ coachStore.capability.enabledFeatureIds.join(', ') || 'None' }}
              </span>
            </div>
            <div
              v-if="Object.keys(coachStore.capability.unavailable).length > 0"
              class="text-amber-500"
            >
              {{ t('liveCoach.diagnostics.unavailable', '不可用原因:') }}
              {{ JSON.stringify(coachStore.capability.unavailable) }}
            </div>
          </div>
        </div>

        <!-- 实时性能指标 -->
        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="mb-1 text-sm font-medium">
            {{ t('liveCoach.diagnostics.metricsTitle', '实时性能指标与管道状态') }}
          </div>
          <div class="grid grid-cols-3 gap-2 text-xs text-gray-500">
            <div>
              {{ t('liveCoach.diagnostics.sampling', '视觉采样:') }}
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{ coachStore.capture.fps }} FPS
              </span>
            </div>
            <div>
              {{ t('liveCoach.diagnostics.latency', '帧延迟:') }}
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{
                  coachStore.capture.frameAgeMs !== null
                    ? `${coachStore.capture.frameAgeMs} ms`
                    : 'N/A'
                }}
              </span>
            </div>
            <div>
              {{ t('liveCoach.diagnostics.roi', 'ROI 标定状态:') }}
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{ coachStore.capture.roiState }}
              </span>
            </div>
            <div>
              {{ t('liveCoach.diagnostics.session', '会话状态:') }}
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{ coachStore.session.state }}
              </span>
            </div>
            <div>
              {{ t('liveCoach.diagnostics.speechState', '语音状态:') }}
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{ coachStore.speech.state }}
              </span>
            </div>
            <div>
              {{ t('liveCoach.diagnostics.heartbeat', '数据源心跳:') }}
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{
                  coachStore.liveData.lastSuccessAt
                    ? `${Math.round((Date.now() - coachStore.liveData.lastSuccessAt) / 1000)}s`
                    : 'Disconnected'
                }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </NCard>
  </div>
</template>

<script setup lang="ts">
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import { useTranslation } from 'i18next-vue'
import { NCard } from 'naive-ui'

const { t } = useTranslation()
const as = useAppCommonStore()
const coachStore = useLiveCoachStore()
</script>
