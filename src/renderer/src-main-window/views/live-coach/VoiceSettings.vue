<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.voice.title', '语音播报与 TTS 设置')">
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">
              {{ t('liveCoach.voice.enableSwitch', '启用本地语音播报') }}
            </div>
            <div class="text-xs text-gray-400">
              {{
                t('liveCoach.voice.enableDesc', '使用 Windows SAPI 5.4 离线语音引擎进行战术播报')
              }}
            </div>
          </div>
          <NSwitch
            :value="coachStore.settings.speechEnabled"
            @update:value="(val) => coachShard.setSpeechEnabled(val)"
          />
        </div>

        <NDivider style="margin: 12px 0" />

        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">
              {{ t('liveCoach.voice.voiceSelectTitle', '系统 SAPI 语音包选择') }}
            </div>
            <div class="text-xs text-gray-400">
              {{ t('liveCoach.voice.voiceSelectDesc', '选择用于播报的系统本地语音') }}
            </div>
          </div>
          <NSelect
            style="width: 220px"
            size="small"
            :value="coachStore.settings.speechVoiceId"
            :options="voiceOptions"
            :placeholder="t('liveCoach.voice.defaultVoice', '跟随系统默认语音')"
            clearable
            @update:value="(val) => handleSelectVoice(val)"
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">
              {{ t('liveCoach.voice.volumeTitle', '播报音量') }}
            </div>
            <div class="text-xs text-gray-400">
              {{ t('liveCoach.voice.volumeDesc', '设置 TTS 语音输出音量') }}
            </div>
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
            <div class="text-sm font-medium">{{ t('liveCoach.voice.rateTitle', '语速调节') }}</div>
            <div class="text-xs text-gray-400">
              {{ t('liveCoach.voice.rateDesc', '0.5x ~ 1.5x 倍速') }}
            </div>
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
          <NButton size="small" secondary @click="handleTestVoice">
            {{ t('liveCoach.voice.testBtn', '测试当前语音输出') }}
          </NButton>
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
import { NButton, NCard, NDivider, NSelect, NSlider, NSwitch, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'

const { t } = useTranslation()
const message = useMessage()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)

const voiceOptions = ref<Array<{ label: string; value: string }>>([])

onMounted(async () => {
  try {
    const list = await coachShard.listVoices()
    voiceOptions.value = list.map((v) => ({
      label: `${v.name} (${v.culture})`,
      value: v.id
    }))
  } catch {
    voiceOptions.value = [{ label: '系统默认语音', value: 'default' }]
  }
})

function handleSelectVoice(voiceId: string | null) {
  coachShard.setSpeechVoiceId(voiceId)
}

async function handleTestVoice() {
  try {
    await coachShard.testSpeech({
      text: '实时语音 AI 教练测试播报，音量与语速正常。',
      voiceId: coachStore.settings.speechVoiceId
    })
    message.success('已触发语音测试')
  } catch (err: any) {
    message.error(`语音测试失败: ${err?.message || err}`)
  }
}
</script>
