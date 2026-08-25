<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.voice.title', '语音播报与 TTS 设置')">
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">启用本地语音播报</div>
            <div class="text-xs text-gray-400">使用 Windows SAPI 5.4 离线语音引擎进行战术播报</div>
          </div>
          <NSwitch
            :value="coachStore.settings.speechEnabled"
            @update:value="(val) => coachShard.setSpeechEnabled(val)"
          />
        </div>

        <NDivider style="margin: 12px 0" />

        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">播报音量</div>
            <div class="text-xs text-gray-400">设置 TTS 语音输出音量</div>
          </div>
          <div class="w-48">
            <NSlider
              :value="coachStore.settings.speechVolume"
              :min="0"
              :max="1"
              :step="0.05"
              @update:value="(val) => coachShard.setSpeechVolume(val)"
            />
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">语速调节</div>
            <div class="text-xs text-gray-400">0.75x ~ 1.5x 倍速</div>
          </div>
          <div class="w-48">
            <NSlider
              :value="coachStore.settings.speechRate"
              :min="0.5"
              :max="1.5"
              :step="0.1"
              @update:value="(val) => coachShard.setSpeechRate(val)"
            />
          </div>
        </div>

        <div class="pt-2">
          <NButton size="small" secondary @click="handleTestVoice"> 测试当前语音输出 </NButton>
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
import { NButton, NCard, NDivider, NSlider, NSwitch, useMessage } from 'naive-ui'

const { t } = useTranslation()
const message = useMessage()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)

const handleTestVoice = async () => {
  try {
    await coachShard.testSpeech({ text: '语音引擎连接正常，音量与语速配置已生效。' })
    message.success('已触发测试播报')
  } catch (err: any) {
    message.error(`测试失败: ${err.message}`)
  }
}
</script>
