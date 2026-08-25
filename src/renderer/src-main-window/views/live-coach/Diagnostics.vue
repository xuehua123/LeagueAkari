<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.diagnostics.title', '运行诊断与状态监控')">
      <div class="space-y-3">
        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="mb-1 text-sm font-medium">系统支持矩阵</div>
          <div class="text-xs text-gray-500">
            运行平台: {{ as.isWindows ? 'Windows x64 (支持)' : 'macOS (不受支持)' }} | WGC 采集支持:
            正常 | DirectML 加速: 可用
          </div>
        </div>

        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="mb-1 text-sm font-medium">实时性能指标</div>
          <div class="text-xs text-gray-500">
            视觉采样 FPS: {{ coachStore.capture.fps }} | 帧延迟:
            {{
              coachStore.capture.frameAgeMs !== null ? `${coachStore.capture.frameAgeMs} ms` : 'N/A'
            }}
            | ROI 状态: {{ coachStore.capture.roiState }}
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
