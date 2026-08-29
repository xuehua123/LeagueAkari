<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
        <NCard size="small" :title="t('liveCoach.privacy.title', '隐私保护与数据授权')">
          <div class="space-y-4">
            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="mb-1 text-sm font-medium">
                {{ t('liveCoach.privacy.localComputeTitle', '纯本地运算保障') }}
              </div>
              <div class="text-xs leading-relaxed text-gray-500">
                {{
                  t(
                    'liveCoach.privacy.localComputeDesc',
                    '所有教练处理均在本机完成；小地图视觉分析运行在隔离子进程中，原始画面不会上传云端。'
                  )
                }}
              </div>
            </div>

            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="mb-2 text-sm font-medium">
                {{ t('liveCoach.privacy.dataScopeTitle') }}
              </div>
              <div class="grid gap-2 text-xs sm:grid-cols-2">
                <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <div class="font-medium">{{ t('liveCoach.privacy.screenDataTitle') }}</div>
                  <div class="mt-1 leading-relaxed text-gray-500">
                    {{ t('liveCoach.privacy.screenDataDesc') }}
                  </div>
                </div>
                <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <div class="font-medium">{{ t('liveCoach.privacy.roiDataTitle') }}</div>
                  <div class="mt-1 leading-relaxed text-gray-500">
                    {{ t('liveCoach.privacy.roiDataDesc') }}
                  </div>
                </div>
                <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <div class="font-medium">{{ t('liveCoach.privacy.structuredDataTitle') }}</div>
                  <div class="mt-1 leading-relaxed text-gray-500">
                    {{ t('liveCoach.privacy.structuredDataDesc') }}
                  </div>
                </div>
                <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <div class="font-medium">{{ t('liveCoach.privacy.diagnosticsDataTitle') }}</div>
                  <div class="mt-1 leading-relaxed text-gray-500">
                    {{ t('liveCoach.privacy.diagnosticsDataDesc') }}
                  </div>
                </div>
              </div>
            </div>

            <NAlert type="info" :title="t('liveCoach.privacy.dataImprovementTitle')">
              {{ t('liveCoach.privacy.dataImprovementDesc') }}
            </NAlert>

            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <div class="text-sm font-medium">{{ t('liveCoach.privacy.consentTitle') }}</div>
                <NTag size="small" :type="privacyConsentGranted ? 'success' : 'warning'">
                  {{
                    privacyConsentGranted
                      ? t('liveCoach.privacy.consentGranted')
                      : t('liveCoach.privacy.consentWithdrawn')
                  }}
                </NTag>
              </div>
              <div class="text-xs leading-relaxed text-gray-500">
                {{
                  privacyConsentGranted
                    ? t('liveCoach.privacy.consentGrantedDesc')
                    : t('liveCoach.privacy.consentWithdrawnDesc')
                }}
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <NButton size="small" secondary @click="reviewOnboarding">
                  {{ t('liveCoach.privacy.reviewGuide') }}
                </NButton>
                <NPopconfirm :disabled="!privacyConsentGranted" @positive-click="withdrawConsent">
                  <template #trigger>
                    <NButton
                      size="small"
                      type="warning"
                      secondary
                      :disabled="!privacyConsentGranted"
                      :loading="withdrawing"
                    >
                      {{ t('liveCoach.privacy.withdrawConsent') }}
                    </NButton>
                  </template>
                  {{ t('liveCoach.privacy.withdrawConsentConfirm') }}
                </NPopconfirm>
              </div>
            </div>

            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="mb-1 text-sm font-medium">
                {{ t('liveCoach.privacy.noAntiCheatTitle', '反作弊合规基线') }}
              </div>
              <div class="text-xs leading-relaxed text-gray-500">
                {{
                  t(
                    'liveCoach.privacy.noAntiCheatDesc',
                    '仅使用 Riot Live Client Data（2999 端口）与屏幕采集，不读取游戏内存、不注入或操控游戏进程；公开发布仍受 Riot 审核与远程能力开关控制。'
                  )
                }}
              </div>
            </div>

            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="mb-1 text-sm font-medium">
                {{ t('liveCoach.privacy.localDataTitle') }}
              </div>
              <div class="mb-3 text-xs leading-relaxed text-gray-500">
                {{ t('liveCoach.privacy.localDataDesc') }}
              </div>
              <div class="flex gap-2">
                <NButton size="small" :loading="exporting" @click="exportLocalData">
                  {{ t('liveCoach.privacy.export') }}
                </NButton>
                <NPopconfirm @positive-click="deleteLocalData">
                  <template #trigger>
                    <NButton size="small" type="error" :loading="deleting">
                      {{ t('liveCoach.privacy.delete') }}
                    </NButton>
                  </template>
                  {{ t('liveCoach.privacy.deleteConfirm') }}
                </NPopconfirm>
              </div>
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
import { hasCurrentLiveCoachPrivacyConsent } from '@shared/types/live-coach'
import { useTranslation } from 'i18next-vue'
import { NAlert, NButton, NCard, NPopconfirm, NScrollbar, NTag, useMessage } from 'naive-ui'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

const { t } = useTranslation()
const message = useMessage()
const coachShard = useInstance(LiveCoachRenderer)
const coachStore = useLiveCoachStore()
const router = useRouter()
const exporting = ref(false)
const deleting = ref(false)
const withdrawing = ref(false)
const privacyConsentGranted = computed(() => hasCurrentLiveCoachPrivacyConsent(coachStore.settings))

function reviewOnboarding() {
  void router.push({
    name: 'live-coach',
    params: { section: 'overview' },
    query: { guide: privacyConsentGranted.value ? '1' : 'consent' }
  })
}

async function withdrawConsent() {
  withdrawing.value = true
  try {
    await coachShard.setEnabled(false)
    await coachShard.setOnboardingCompleted(false)
    message.success(t('liveCoach.privacy.withdrawConsentDone'))
    await router.push({
      name: 'live-coach',
      params: { section: 'overview' },
      query: { guide: 'consent' }
    })
  } catch (error: any) {
    message.error(error?.message || t('liveCoach.privacy.withdrawConsentFailed'))
  } finally {
    withdrawing.value = false
  }
}

async function exportLocalData() {
  exporting.value = true
  try {
    const result = await coachShard.exportLocalCoachData()
    if (!result.canceled) {
      message.success(t('liveCoach.privacy.exported'))
    }
  } catch (error: any) {
    message.error(error?.message || t('liveCoach.privacy.exportFailed'))
  } finally {
    exporting.value = false
  }
}

async function deleteLocalData() {
  deleting.value = true
  try {
    await coachShard.deleteLocalCoachData()
    await coachShard.resetCalibration()
    message.success(t('liveCoach.privacy.deleted'))
  } catch (error: any) {
    message.error(error?.message || t('liveCoach.privacy.deleteFailed'))
  } finally {
    deleting.value = false
  }
}
</script>
