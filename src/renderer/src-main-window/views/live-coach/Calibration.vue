<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto box-border flex w-full max-w-6xl flex-col gap-4 p-6">
        <NCard size="small" :title="t('liveCoach.calibration.title')">
          <div class="space-y-3">
            <div class="text-sm text-gray-500">{{ t('liveCoach.calibration.desc') }}</div>

            <div
              class="flex items-center justify-between rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div>
                <div class="text-sm font-medium">{{ t('liveCoach.calibration.sideTitle') }}</div>
                <div class="text-xs text-gray-400">{{ t('liveCoach.calibration.sideDesc') }}</div>
              </div>
              <NRadioGroup
                :value="coachStore.settings.minimapSide"
                size="small"
                @update:value="(value) => coachShard.setMinimapSide(value)"
              >
                <NRadioButton value="auto">{{ t('liveCoach.calibration.autoSide') }}</NRadioButton>
                <NRadioButton value="right">{{
                  t('liveCoach.calibration.rightSide')
                }}</NRadioButton>
                <NRadioButton value="left">{{ t('liveCoach.calibration.leftSide') }}</NRadioButton>
              </NRadioGroup>
            </div>

            <div
              class="flex items-center justify-between rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div>
                <div class="text-sm font-medium">{{ t('liveCoach.calibration.backendTitle') }}</div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.calibration.backendDesc') }}
                </div>
              </div>
              <NSelect
                class="w-40"
                size="small"
                :value="coachStore.settings.captureBackend"
                :options="backendOptions"
                @update:value="(value) => coachShard.setCaptureBackend(value)"
              />
            </div>
          </div>
        </NCard>

        <NCard size="small" :title="t('liveCoach.calibration.previewTitle')">
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-4">
              <div class="text-xs text-gray-400">{{ t('liveCoach.calibration.previewDesc') }}</div>
              <div class="flex shrink-0 items-center gap-2">
                <span class="text-xs">{{ t('liveCoach.calibration.showImage') }}</span>
                <NSwitch v-model:value="showImage" size="small" />
                <NButton size="small" :loading="previewLoading" @click="requestPreview">
                  {{ t('liveCoach.calibration.requestPreview') }}
                </NButton>
              </div>
            </div>

            <RoiSelectionEditor
              v-model="roi"
              :image-data-url="showImage ? preview?.imageDataUrl : undefined"
              :image-alt="t('liveCoach.calibration.previewAlt')"
              :empty-text="
                preview
                  ? t('liveCoach.calibration.previewHidden')
                  : t('liveCoach.calibration.previewEmpty')
              "
              :roi-aria-label="t('liveCoach.calibration.roiAriaLabel')"
              :source-size="preview?.sourceSize ?? preview?.thumbnailSize"
            />

            <div v-if="preview" class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                {{ t('liveCoach.calibration.sourceResolution') }}
                {{
                  preview.sourceSize
                    ? `${preview.sourceSize.width}×${preview.sourceSize.height}`
                    : t('liveCoach.calibration.sourceResolutionUnknown')
                }}
              </div>
              <div>
                {{ t('liveCoach.calibration.calibrationSource') }} {{ preview.calibration.source }}
              </div>
              <div>
                {{ t('liveCoach.calibration.confidence') }}
                {{ Math.round(preview.calibration.confidence * 100) }}%
              </div>
              <div>{{ t('liveCoach.calibration.detectedSide') }} {{ roiSide }}</div>
            </div>

            <NAlert
              v-if="preview && preview.calibration.confidence < 0.65"
              type="warning"
              :show-icon="false"
            >
              {{ t('liveCoach.calibration.detectionUncertain') }}
            </NAlert>

            <div class="flex justify-end gap-2">
              <NButton size="small" @click="resetCalibration">
                {{ t('liveCoach.calibration.reset') }}
              </NButton>
              <NButton type="primary" size="small" :disabled="!roi" @click="saveCalibration">
                {{ t('liveCoach.calibration.confirm') }}
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
import type { MinimapCalibration } from '@shared/types/live-coach'
import { useTranslation } from 'i18next-vue'
import {
  NAlert,
  NButton,
  NCard,
  NRadioButton,
  NRadioGroup,
  NScrollbar,
  NSelect,
  NSwitch,
  useMessage
} from 'naive-ui'
import { computed, onBeforeUnmount, ref } from 'vue'

import { RoiSelectionEditor } from './roi-selection-editor'

type CalibrationPreview = Awaited<ReturnType<LiveCoachRenderer['requestCalibrationPreview']>>

const { t } = useTranslation()
const message = useMessage()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)
const preview = ref<CalibrationPreview | null>(null)
const roi = ref<MinimapCalibration['roi'] | null>(null)
const showImage = ref(true)
const previewLoading = ref(false)
let expiryTimer: ReturnType<typeof setTimeout> | null = null

const backendOptions = computed(() => [
  { label: t('liveCoach.calibration.backendAuto'), value: 'auto' },
  { label: t('liveCoach.calibration.backendWgc'), value: 'wgc' },
  { label: t('liveCoach.calibration.backendDda'), value: 'dda' }
])

const roiSide = computed<'left' | 'right'>(() => ((roi.value?.x ?? 0) < 0.5 ? 'left' : 'right'))

function clearExpiryTimer() {
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

async function requestPreview() {
  previewLoading.value = true
  try {
    const result = await coachShard.requestCalibrationPreview(showImage.value)
    preview.value = result
    roi.value = { ...result.calibration.roi }
    clearExpiryTimer()
    expiryTimer = setTimeout(
      () => {
        if (preview.value?.requestId === result.requestId) {
          preview.value = { ...preview.value, imageDataUrl: undefined }
        }
      },
      Math.max(0, result.expiresAt - Date.now())
    )
  } catch (error) {
    message.error(
      getErrorCode(error) === 'consent-required'
        ? t('liveCoach.diagnostics.captureTestConsentRequired')
        : error instanceof Error
          ? error.message
          : String(error)
    )
  } finally {
    previewLoading.value = false
  }
}

async function saveCalibration() {
  if (!roi.value) return
  try {
    // A manually moved ROI must not be persisted under the opposite fixed-side
    // setting, otherwise the fingerprint rejects it on the next session.
    const configuredSide = coachStore.settings.minimapSide
    if (configuredSide !== 'auto' && configuredSide !== roiSide.value) {
      await coachShard.setMinimapSide(roiSide.value)
    }
    const calibration = await coachShard.applyManualCalibration(roi.value, roiSide.value)
    roi.value = { ...calibration.roi }
    if (preview.value) preview.value = { ...preview.value, calibration }
    message.success(t('liveCoach.calibration.saved'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function resetCalibration() {
  try {
    const result = await coachShard.resetCalibration()
    roi.value = { ...result.calibration.roi }
    if (preview.value) preview.value = { ...preview.value, calibration: result.calibration }
    message.success(t('liveCoach.calibration.resetDone'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

onBeforeUnmount(clearExpiryTimer)
</script>
