<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.calibration.title', '小地图 ROI 标定与环境指纹')">
      <div class="space-y-3">
        <div class="text-sm text-gray-500">
          {{
            t(
              'liveCoach.calibration.desc',
              '为了确保小地图视觉观察的准确性，系统会自动检测游戏窗口分辨率与小地图位置。你也可以在右侧或左侧小地图布局中进行手动微调。'
            )
          }}
        </div>

        <div
          class="flex items-center justify-between rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div>
            <div class="text-sm font-medium">
              {{ t('liveCoach.calibration.sideTitle', '小地图屏幕位置') }}
            </div>
            <div class="text-xs text-gray-400">
              {{ t('liveCoach.calibration.sideDesc', '选择游戏内 HUD 设置中的小地图左右侧布局') }}
            </div>
          </div>
          <NRadioGroup
            :value="coachStore.settings.minimapSide"
            @update:value="(val) => coachShard.setMinimapSide(val)"
            size="small"
          >
            <NRadioButton value="auto">{{
              t('liveCoach.calibration.autoSide', '自动检测')
            }}</NRadioButton>
            <NRadioButton value="right">{{
              t('liveCoach.calibration.rightSide', '右下角（默认）')
            }}</NRadioButton>
            <NRadioButton value="left">{{
              t('liveCoach.calibration.leftSide', '左下角')
            }}</NRadioButton>
          </NRadioGroup>
        </div>

        <div
          class="flex items-center justify-between rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div>
            <div class="text-sm font-medium">
              {{ t('liveCoach.calibration.backendTitle', '采集后端选择') }}
            </div>
            <div class="text-xs text-gray-400">
              {{
                t(
                  'liveCoach.calibration.backendDesc',
                  'Windows 10/11 优先使用 Windows Graphics Capture (WGC)'
                )
              }}
            </div>
          </div>
          <NSelect
            style="width: 140px"
            size="small"
            :value="coachStore.settings.captureBackend"
            :options="[
              { label: t('liveCoach.calibration.backendAuto', '自动 (Auto)'), value: 'auto' },
              { label: t('liveCoach.calibration.backendWgc', 'WGC (推荐)'), value: 'wgc' },
              { label: t('liveCoach.calibration.backendDda', 'DXGI DDA'), value: 'dda' }
            ]"
            @update:value="(val) => coachShard.setCaptureBackend(val)"
          />
        </div>
      </div>
    </NCard>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { LiveCoachRenderer } from '@renderer-shared/shards/live-coach'
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import { useTranslation } from 'i18next-vue'
import { NCard, NRadioButton, NRadioGroup, NSelect } from 'naive-ui'

const { t } = useTranslation()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)
</script>
