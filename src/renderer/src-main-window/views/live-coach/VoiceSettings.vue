<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
        <NCard size="small" :title="t('liveCoach.voice.title', '语音播报与 TTS 设置')">
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.voice.enableSwitch', '启用本地语音播报') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{
                    t(
                      'liveCoach.voice.enableDesc',
                      '使用 Windows SAPI 5.4 离线语音引擎进行战术播报'
                    )
                  }}
                </div>
              </div>
              <NSwitch
                :value="coachStore.settings.speechEnabled"
                @update:value="(val) => coachShard.setSpeechEnabled(val)"
              />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.voice.outputDeviceTitle') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.voice.outputDeviceDesc') }}
                </div>
              </div>
              <NSelect
                style="width: 220px"
                size="small"
                :value="coachStore.settings.speechOutputDeviceId"
                :options="outputDeviceOptions"
                :placeholder="t('liveCoach.voice.defaultOutputDevice')"
                clearable
                @update:value="(val) => coachShard.setSpeechOutputDeviceId(val)"
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
                <div class="text-sm font-medium">
                  {{ t('liveCoach.voice.rateTitle', '语速调节') }}
                </div>
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

            <div class="flex gap-2 pt-2">
              <NButton size="small" secondary :loading="isTesting" @click="handleTestVoice">
                {{ t('liveCoach.voice.testBtn', '测试当前语音输出') }}
              </NButton>
              <NButton size="small" secondary @click="handleCancelVoice">
                {{ t('liveCoach.voice.cancelBtn') }}
              </NButton>
            </div>
          </div>
        </NCard>
      </div>
    </NScrollbar>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { LiveCoachRenderer } from '@renderer-shared/shards/live-coach'
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import { useTranslation } from 'i18next-vue'
import {
  NButton,
  NCard,
  NDivider,
  NScrollbar,
  NSelect,
  NSlider,
  NSwitch,
  useMessage
} from 'naive-ui'
import { onMounted, ref } from 'vue'

const { t } = useTranslation()
const message = useMessage()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)

const voiceOptions = ref<Array<{ label: string; value: string }>>([])
const outputDeviceOptions = ref<Array<{ label: string; value: string }>>([])
const isTesting = ref(false)

onMounted(async () => {
  try {
    const [voices, devices] = await Promise.all([
      coachShard.listVoices(),
      coachShard.listAudioDevices()
    ])
    voiceOptions.value = voices.map((v) => ({
      label: `${v.name} (${v.culture})`,
      value: v.id
    }))
    outputDeviceOptions.value = devices.outputDevices.map((device) => ({
      label: device.isDefault
        ? `${device.name} · ${t('liveCoach.voice.defaultOutputDevice')}`
        : device.name,
      value: device.id
    }))
  } catch {
    voiceOptions.value = []
    outputDeviceOptions.value = []
    message.error(t('liveCoach.voice.loadFailed'))
  }
})

function handleSelectVoice(voiceId: string | null) {
  coachShard.setSpeechVoiceId(voiceId)
}

async function handleTestVoice() {
  isTesting.value = true
  try {
    const result = await coachShard.testSpeech({
      text: t('liveCoach.voice.testText'),
      voiceId: coachStore.settings.speechVoiceId,
      outputDeviceId: coachStore.settings.speechOutputDeviceId
    })
    if (result.success) {
      message.success(t('liveCoach.voice.testSucceeded'))
    } else {
      message.error(t('liveCoach.voice.testFailed'))
    }
  } catch (err: any) {
    message.error(t('liveCoach.voice.testError', { error: err?.message || String(err) }))
  } finally {
    isTesting.value = false
  }
}

async function handleCancelVoice() {
  await coachShard.cancelSpeech()
  isTesting.value = false
}
</script>
