<template>
  <div class="max-w-4xl space-y-4">
    <!-- 主开关卡片 -->
    <NCard size="small" :title="t('liveCoach.overview.mainSwitch', '实时语音 AI 教练')">
      <template #header-extra>
        <NSwitch
          :value="coachStore.settings.enabled"
          @update:value="(val) => coachShard.setEnabled(val)"
        />
      </template>
      <div class="text-sm text-gray-500">
        {{
          t(
            'liveCoach.overview.mainSwitchDesc',
            '在召唤师峡谷对局中，基于小地图可见事实与 Live Client Data 提供实时确定性决策与语音辅助。'
          )
        }}
      </div>
    </NCard>

    <!-- 会话状态与快捷操作 -->
    <NCard size="small" :title="t('liveCoach.overview.sessionStatus', '当前会话状态')">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="text-xs text-gray-400">会话状态</div>
          <div class="font-mono text-base font-semibold capitalize">
            {{ coachStore.session.state }}
          </div>
        </div>
        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="text-xs text-gray-400">采集后端</div>
          <div class="font-mono text-base font-semibold uppercase">
            {{ coachStore.capture.backend || 'WGC' }} ({{ coachStore.capture.fps }} FPS)
          </div>
        </div>
        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="text-xs text-gray-400">Live Data</div>
          <div class="font-mono text-base font-semibold capitalize">
            {{ coachStore.liveData.state }}
          </div>
        </div>
        <div
          class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="text-xs text-gray-400">语音播报</div>
          <div class="font-mono text-base font-semibold capitalize">
            {{ coachStore.speech.state }}
          </div>
        </div>
      </div>

      <div class="mt-4 flex gap-2">
        <NButton
          size="small"
          type="primary"
          :disabled="!coachStore.settings.enabled || coachStore.session.state === 'active'"
          @click="handleStartInternal"
        >
          手动启动测试会话
        </NButton>
        <NButton
          size="small"
          :disabled="coachStore.session.state !== 'active'"
          @click="coachShard.stopSession('user-manual-stop')"
        >
          停止当前会话
        </NButton>
        <NButton size="small" @click="handleTestSpeech"> 测试语音合成 </NButton>
      </div>
    </NCard>

    <!-- 最近一条提示 -->
    <NCard size="small" :title="t('liveCoach.overview.latestCue', '实时提示预览')">
      <div
        v-if="coachStore.cue"
        class="space-y-2 rounded border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/40"
      >
        <div class="flex items-center gap-2">
          <NTag size="small" type="info">{{ coachStore.cue.category }}</NTag>
          <span class="text-sm font-medium">{{ coachStore.cue.observationText }}</span>
        </div>
        <div v-if="coachStore.cue.impactText" class="text-xs text-gray-600 dark:text-gray-300">
          影响：{{ coachStore.cue.impactText }}
        </div>
        <div class="text-sm font-semibold text-blue-600 dark:text-blue-400">
          “{{ coachStore.cue.spokenText }}”
        </div>
        <div class="flex gap-2 pt-1">
          <NTag v-for="opt of coachStore.cue.options" :key="opt.id" size="tiny" secondary>
            选项: {{ opt.label }}
          </NTag>
        </div>
      </div>
      <div v-else class="py-6 text-center text-sm text-gray-400">
        {{ t('liveCoach.overview.noCue', '当前暂无正在播报的战术提示') }}
      </div>
    </NCard>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { LiveCoachRenderer } from '@renderer-shared/shards/live-coach'
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import { useTranslation } from 'i18next-vue'
import { NButton, NCard, NSwitch, NTag, useMessage } from 'naive-ui'

const { t } = useTranslation()
const message = useMessage()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)

const handleStartInternal = async () => {
  try {
    await coachShard.startInternalSession()
    message.success('已启动内部测试会话')
  } catch (err: any) {
    message.error(`启动失败: ${err.message}`)
  }
}

const handleTestSpeech = async () => {
  try {
    await coachShard.testSpeech({ text: '实时语音 AI 教练测试成功，音量与语速正常。' })
    message.success('正在测试播报...')
  } catch (err: any) {
    message.error(`播报失败: ${err.message}`)
  }
}
</script>
