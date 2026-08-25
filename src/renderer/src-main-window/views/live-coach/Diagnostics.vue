<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.diagnostics.title', '运行诊断与状态监控')">
      <div class="space-y-3">
        <!-- 系统支持矩阵 -->
        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="mb-1 text-sm font-medium">系统支持矩阵与能力检查</div>
          <div class="space-y-1 text-xs text-gray-500">
            <div>
              运行平台:
              <span
                :class="as.isWindows ? 'font-medium text-emerald-600' : 'font-medium text-rose-500'"
              >
                {{ as.isWindows ? 'Windows (已满足)' : '非 Windows 平台 (部分功能受限)' }}
              </span>
            </div>
            <div>
              采集后端:
              <span class="font-mono text-gray-700 dark:text-gray-300">
                {{
                  coachStore.capture.backend ? coachStore.capture.backend.toUpperCase() : '未激活'
                }}
              </span>
            </div>
            <div>
              已启用能力特性:
              <span class="font-mono text-gray-700 dark:text-gray-300">
                {{ coachStore.capability.enabledFeatureIds.join(', ') || '暂无已就绪特性' }}
              </span>
            </div>
            <div
              v-if="Object.keys(coachStore.capability.unavailable).length > 0"
              class="text-amber-500"
            >
              不可用原因: {{ JSON.stringify(coachStore.capability.unavailable) }}
            </div>
          </div>
        </div>

        <!-- 实时性能指标 -->
        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="mb-1 text-sm font-medium">实时性能指标与管道状态</div>
          <div class="grid grid-cols-3 gap-2 text-xs text-gray-500">
            <div>
              视觉采样:
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{ coachStore.capture.fps }} FPS
              </span>
            </div>
            <div>
              帧延迟:
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{
                  coachStore.capture.frameAgeMs !== null
                    ? `${coachStore.capture.frameAgeMs} ms`
                    : 'N/A'
                }}
              </span>
            </div>
            <div>
              ROI 标定状态:
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{ coachStore.capture.roiState }}
              </span>
            </div>
            <div>
              会话状态:
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{ coachStore.session.state }}
              </span>
            </div>
            <div>
              语音状态:
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{ coachStore.speech.state }}
              </span>
            </div>
            <div>
              数据源心跳:
              <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                {{
                  coachStore.liveData.lastSuccessAt
                    ? `${Math.round((Date.now() - coachStore.liveData.lastSuccessAt) / 1000)}s 前`
                    : '未连接'
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
