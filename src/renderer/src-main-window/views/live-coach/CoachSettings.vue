<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.settings.title', '教练模式与提醒策略')">
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">
              {{ t('liveCoach.settings.coachModeTitle', '教练提醒模式') }}
            </div>
            <div class="text-xs text-gray-400">控制局内提示的触发频率与详细程度</div>
          </div>
          <NRadioGroup
            :value="coachStore.settings.coachMode"
            @update:value="(val) => coachShard.setCoachMode(val)"
            size="small"
          >
            <NRadioButton value="minimal">{{
              t('liveCoach.settings.modeMinimal', '极简（仅危险）')
            }}</NRadioButton>
            <NRadioButton value="balanced">{{
              t('liveCoach.settings.modeBalanced', '均衡（推荐）')
            }}</NRadioButton>
            <NRadioButton value="training">{{
              t('liveCoach.settings.modeTraining', '训练强化')
            }}</NRadioButton>
          </NRadioGroup>
        </div>

        <NDivider style="margin: 12px 0" />

        <div>
          <div class="mb-2 text-sm font-medium">关注的提示类别</div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div
              v-for="(enabled, cat) of coachStore.settings.cueCategories"
              :key="cat"
              class="flex items-center justify-between rounded border border-gray-100 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-800"
            >
              <span class="font-mono text-xs font-medium uppercase">{{ cat }}</span>
              <NSwitch
                size="small"
                :value="enabled"
                @update:value="
                  (val) =>
                    coachShard.setCueCategoryEnabled(
                      String(cat),
                      val,
                      coachStore.settings.cueCategories
                    )
                "
              />
            </div>
          </div>
        </div>

        <NDivider style="margin: 12px 0" />

        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">
              {{ t('liveCoach.settings.overlaySwitchTitle', '启用独立透明置顶悬浮窗') }}
            </div>
            <div class="text-xs text-gray-400">
              {{
                t(
                  'liveCoach.settings.overlaySwitchDesc',
                  '在游戏画面上方展示半透明提示卡片，支持鼠标点击穿透'
                )
              }}
            </div>
          </div>
          <NSwitch
            :value="coachStore.settings.overlayEnabled"
            @update:value="(val) => coachShard.setOverlayEnabled(val)"
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">
              {{ t('liveCoach.settings.opacityTitle', '悬浮窗不透明度') }}
            </div>
            <div class="text-xs text-gray-400">调节悬浮窗在游戏顶层的可见透明度</div>
          </div>
          <div class="w-48">
            <NSlider
              :value="coachStore.settings.overlayOpacity"
              :min="0.3"
              :max="1"
              :step="0.05"
              @update:value="(val) => coachShard.setOverlayOpacity(val)"
            />
          </div>
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
import { NCard, NDivider, NRadioButton, NRadioGroup, NSlider, NSwitch } from 'naive-ui'

const { t } = useTranslation()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)
</script>
