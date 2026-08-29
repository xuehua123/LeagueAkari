<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
        <NCard size="small" :title="t('liveCoach.diagnostics.title', '运行诊断与状态监控')">
          <div class="space-y-3">
            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div class="text-sm font-medium">
                    {{ t('liveCoach.diagnostics.matrixTitle') }}
                  </div>
                  <div class="mt-1 text-xs text-gray-500">
                    {{ t('liveCoach.diagnostics.environment.description') }}
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <NButton size="tiny" :loading="testingSystem" @click="runSystemSelfTest">
                    {{ t('liveCoach.diagnostics.environment.runAll') }}
                  </NButton>
                  <NButton
                    size="tiny"
                    :disabled="!matrixHasRun"
                    :loading="retryingUnready"
                    @click="rerunUnreadyChecks"
                  >
                    {{ t('liveCoach.diagnostics.environment.retryUnready') }}
                  </NButton>
                </div>
              </div>

              <NAlert
                v-if="matrixHasRun"
                class="mb-3"
                :type="environmentSummaryAlertType"
                :show-icon="false"
              >
                <div class="text-xs">
                  {{ t('liveCoach.diagnostics.environment.summary.' + environmentSummary) }}
                  <span class="ml-1 text-gray-500">
                    {{
                      t('liveCoach.diagnostics.environment.checkedAt', { time: matrixCheckedAt })
                    }}
                  </span>
                </div>
              </NAlert>

              <div class="grid gap-2 md:grid-cols-2">
                <div
                  v-for="check in environmentChecks"
                  :key="check.id"
                  class="flex min-w-0 flex-col gap-2 rounded border border-black/5 bg-white/70 p-3 dark:border-white/10 dark:bg-black/15"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-xs font-medium">
                        {{ t('liveCoach.diagnostics.environment.items.' + check.id) }}
                      </div>
                      <div class="mt-1 font-mono text-xs break-words text-gray-500">
                        {{ formatEnvironmentValue(check) }}
                      </div>
                    </div>
                    <NTag
                      :type="environmentStatusType(check.status)"
                      size="small"
                      :bordered="false"
                    >
                      {{ t('liveCoach.diagnostics.environment.status.' + check.status) }}
                    </NTag>
                  </div>
                  <div class="text-xs leading-relaxed text-gray-500">
                    {{ t('liveCoach.diagnostics.environment.reasons.' + check.reasonKey) }}
                  </div>
                  <div
                    v-if="check.fixKey !== 'none'"
                    class="text-xs leading-relaxed text-amber-600 dark:text-amber-400"
                  >
                    {{ t('liveCoach.diagnostics.environment.fixLabel') }}
                    {{ t('liveCoach.diagnostics.environment.fixes.' + check.fixKey) }}
                  </div>
                  <NButton
                    class="self-start"
                    size="tiny"
                    text
                    @click="openHelpTopic(check.helpTopic)"
                  >
                    {{ t('liveCoach.diagnostics.environment.openHelp') }}
                  </NButton>
                </div>
              </div>

              <NAlert
                v-if="probeFailures.length > 0"
                class="mt-3"
                type="warning"
                :show-icon="false"
              >
                <div class="space-y-1 text-xs">
                  <div>{{ t('liveCoach.diagnostics.environment.probeFailureTitle') }}</div>
                  <div v-for="failure in probeFailures" :key="failure.group">
                    {{ t('liveCoach.diagnostics.environment.probeGroups.' + failure.group) }}：{{
                      failure.message
                    }}
                  </div>
                </div>
              </NAlert>

              <div class="mt-3 space-y-1 text-xs text-gray-500">
                <div>
                  {{ t('liveCoach.diagnostics.buildChannel') }}
                  <span class="font-mono text-gray-700 dark:text-gray-300">
                    {{ coachStore.buildChannel }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.features') }}
                  <span class="font-mono break-all text-gray-700 dark:text-gray-300">
                    {{
                      coachStore.capability.enabledFeatureIds.join(', ') ||
                      t('liveCoach.diagnostics.noneValue')
                    }}
                  </span>
                </div>
                <div
                  v-if="unavailableCapabilities.length > 0"
                  class="space-y-1 text-amber-600 dark:text-amber-400"
                >
                  <div>{{ t('liveCoach.diagnostics.unavailable') }}</div>
                  <div class="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    <div
                      v-for="[capability, reason] in unavailableCapabilities"
                      :key="capability"
                      class="flex min-w-0 items-start justify-between gap-2"
                    >
                      <div class="min-w-0">
                        <span class="font-mono break-all text-gray-700 dark:text-gray-300">{{
                          capability
                        }}</span>
                        <span>：{{ formatUnavailableReason(reason) }}</span>
                      </div>
                      <NButton size="tiny" text @click="openUnavailableReasonHelp(reason)">
                        {{ t('liveCoach.diagnostics.environment.openHelp') }}
                      </NButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 实时性能指标 -->
            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="mb-1 text-sm font-medium">
                {{ t('liveCoach.diagnostics.metricsTitle', '实时性能指标与管道状态') }}
              </div>
              <div class="grid grid-cols-3 gap-2 text-xs text-gray-500">
                <div>
                  {{ t('liveCoach.diagnostics.sampling', '视觉采样:') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{ coachStore.capture.fps }} FPS
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.latency', '帧延迟:') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{
                      coachStore.capture.frameAgeMs !== null
                        ? `${coachStore.capture.frameAgeMs} ms`
                        : t('liveCoach.diagnostics.unknownValue')
                    }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.roi', 'ROI 标定状态:') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{ t(`liveCoach.overview.roiState.${coachStore.capture.roiState}`) }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.session', '会话状态:') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{ t(`liveCoach.overview.state.${coachStore.session.state}`) }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.speechState', '语音状态:') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{ t(`liveCoach.overview.speechState.${coachStore.speech.state}`) }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.liveDataHeartbeat') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{
                      coachStore.liveData.lastSuccessAt
                        ? t('liveCoach.diagnostics.heartbeatAge', {
                            count: Math.round((now - coachStore.liveData.lastSuccessAt) / 1000)
                          })
                        : t('liveCoach.diagnostics.disconnectedValue')
                    }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.captureLatency') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{ formatMilliseconds(coachStore.capture.captureLatencyMs) }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.inferenceLatency') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{ formatMilliseconds(coachStore.capture.inferenceLatencyMs) }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.dropCount') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{ coachStore.capture.dropCount }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.queueDepth') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{ coachStore.capture.queueDepth ?? t('liveCoach.diagnostics.unknownValue') }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.workerHeartbeat') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{
                      coachStore.capture.workerHeartbeatAt
                        ? formatAge(coachStore.capture.workerHeartbeatAt)
                        : t('liveCoach.diagnostics.unknownValue')
                    }}
                  </span>
                </div>
                <div>
                  {{ t('liveCoach.diagnostics.workerRestartCount') }}
                  <span class="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {{ coachStore.capture.workerRestartCount }}
                  </span>
                </div>
                <div class="col-span-2">
                  {{ t('liveCoach.diagnostics.detectorVersions') }}
                  <span class="font-mono font-medium break-all text-gray-700 dark:text-gray-300">
                    {{ detectorVersions || t('liveCoach.diagnostics.unknownValue') }}
                  </span>
                </div>
              </div>
              <div class="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
                <div class="mb-2 text-xs font-medium">
                  {{ t('liveCoach.diagnostics.liveDataDomainsTitle') }}
                </div>
                <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div
                    v-for="domain in liveDataDomainRows"
                    :key="domain.id"
                    class="rounded border border-black/5 bg-white/70 p-2 dark:border-white/10 dark:bg-black/15"
                  >
                    <div class="mb-1 text-xs text-gray-500">
                      {{ t('liveCoach.diagnostics.liveDataDomains.' + domain.id) }}
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <NTag
                        size="small"
                        :bordered="false"
                        :type="liveDataHealthTagType(domain.health?.state ?? null)"
                      >
                        {{
                          domain.health
                            ? t(`liveCoach.overview.liveDataState.${domain.health.state}`)
                            : t('liveCoach.diagnostics.unknownValue')
                        }}
                      </NTag>
                      <span
                        v-if="domain.health?.lastSuccessAt"
                        class="font-mono text-xs text-gray-500"
                      >
                        {{ formatAge(domain.health.lastSuccessAt) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div class="text-sm font-medium">
                  {{ t('liveCoach.diagnostics.acceptanceTitle') }}
                </div>
                <div class="flex flex-wrap gap-2">
                  <NButton size="tiny" :loading="loadingAcceptance" @click="loadAcceptanceReport">
                    {{ t('liveCoach.diagnostics.acceptanceRefresh') }}
                  </NButton>
                  <NButton
                    size="tiny"
                    :loading="exportingAcceptance"
                    @click="exportAcceptanceReport"
                  >
                    {{ t('liveCoach.diagnostics.acceptanceExport') }}
                  </NButton>
                  <NPopconfirm @positive-click="clearAcceptanceEvidence">
                    <template #trigger>
                      <NButton size="tiny" type="error" secondary>
                        {{ t('liveCoach.diagnostics.acceptanceClear') }}
                      </NButton>
                    </template>
                    {{ t('liveCoach.diagnostics.acceptanceClearConfirm') }}
                  </NPopconfirm>
                </div>
              </div>
              <div class="mb-3 text-xs text-gray-500">
                {{ t('liveCoach.diagnostics.acceptanceDesc') }}
              </div>
              <div v-if="acceptanceReport" class="space-y-3">
                <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <div class="text-gray-400">{{ t('liveCoach.diagnostics.shadowMatches') }}</div>
                    <div class="font-mono font-medium">
                      {{ acceptanceReport.counts.validShadowMatches }} / 50
                    </div>
                  </div>
                  <div>
                    <div class="text-gray-400">{{ t('liveCoach.diagnostics.offlineReplays') }}</div>
                    <div class="font-mono font-medium">
                      {{ acceptanceReport.counts.offlineUniqueArtifacts }} / 100
                    </div>
                  </div>
                  <div>
                    <div class="text-gray-400">{{ t('liveCoach.diagnostics.shadowHours') }}</div>
                    <div class="font-mono font-medium">
                      {{ acceptanceReport.totals.shadowHours.toFixed(1) }} / 100
                      {{ t('liveCoach.diagnostics.hoursUnit') }}
                    </div>
                  </div>
                  <div>
                    <div class="text-gray-400">{{ t('liveCoach.diagnostics.cueLabels') }}</div>
                    <div class="font-mono font-medium">
                      {{ acceptanceReport.counts.labeledCues }} /
                      {{ acceptanceReport.counts.totalCues }}
                    </div>
                  </div>
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <div
                    v-for="criterion in acceptanceReport.criteria"
                    :key="criterion.id"
                    class="flex items-start justify-between gap-3 rounded border border-black/5 bg-white/70 p-2 dark:border-white/10 dark:bg-black/15"
                  >
                    <div class="min-w-0 text-xs">
                      <div class="font-medium">
                        {{ t(`liveCoach.diagnostics.acceptanceCriteria.${criterion.id}`) }}
                      </div>
                      <div class="text-gray-400">
                        {{
                          t(
                            `liveCoach.diagnostics.acceptanceTargets.${criterion.id}`,
                            criterion.target
                          )
                        }}
                      </div>
                      <div v-if="criterion.reason" class="text-amber-600 dark:text-amber-400">
                        {{ t(`liveCoach.diagnostics.acceptanceReasons.${criterion.reason}`) }}
                      </div>
                    </div>
                    <NTag
                      :type="acceptanceStatusType(criterion.status)"
                      size="small"
                      :bordered="false"
                    >
                      {{ t(`liveCoach.diagnostics.acceptanceStatus.${criterion.status}`) }}
                    </NTag>
                  </div>
                </div>
              </div>
            </div>

            <NAlert
              v-if="coachStore.lastError"
              type="warning"
              :show-icon="false"
              :title="t('liveCoach.diagnostics.lastErrorTitle')"
            >
              <div class="space-y-1 text-xs">
                <div>
                  {{ coachStore.lastError.code }} · {{ coachStore.lastError.stage }} ·
                  {{ formatAge(coachStore.lastError.occurredAt) }}
                </div>
                <div v-if="coachStore.lastError.details">{{ coachStore.lastError.details }}</div>
                <NButton class="mt-2" size="tiny" secondary @click="openErrorHelp">
                  {{ t('liveCoach.diagnostics.openErrorHelp') }}
                </NButton>
              </div>
            </NAlert>

            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="mb-1 text-sm font-medium">
                {{ t('liveCoach.diagnostics.selfTestTitle') }}
              </div>
              <div class="mb-3 text-xs text-gray-500">
                {{ t('liveCoach.diagnostics.selfTestDesc') }}
              </div>
              <div class="flex flex-wrap gap-2">
                <NButton size="small" :loading="testingSpeech" @click="runSpeechTest">
                  {{ t('liveCoach.diagnostics.speechTest') }}
                </NButton>
                <NButton size="small" :loading="testingCapture" @click="runCaptureTest">
                  {{ t('liveCoach.diagnostics.captureTest') }}
                </NButton>
                <NPopconfirm @positive-click="exportDiagnosticsReport">
                  <template #trigger>
                    <NButton size="small" :loading="exportingDiagnostics">
                      {{ t('liveCoach.diagnostics.exportReport') }}
                    </NButton>
                  </template>
                  {{ t('liveCoach.diagnostics.exportReportConfirm') }}
                </NPopconfirm>
              </div>
              <NAlert v-if="testResult" class="mt-3" :type="testResult.type" :show-icon="false">
                {{ testResult.message }}
              </NAlert>
            </div>
          </div>
        </NCard>
      </div>
    </NScrollbar>
  </div>
</template>

<script setup lang="ts">
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { resolveNativeInputStatus } from '@renderer-shared/shards/app-common/native-input-status'
import { useInstance } from '@renderer-shared/shards'
import { LiveCoachRenderer } from '@renderer-shared/shards/live-coach'
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import type { LiveCoachAcceptanceReport } from '@shared/types/live-coach'
import { useTranslation } from 'i18next-vue'
import { NAlert, NButton, NCard, NPopconfirm, NScrollbar, NTag, useMessage } from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import type {
  EnvironmentCheck,
  EnvironmentCheckStatus,
  EnvironmentProbeGroup,
  ProbeResult
} from './diagnostics/environment-matrix'
import {
  buildEnvironmentChecks,
  createEmptyEnvironmentProbeCache,
  listUnprobeableUnreadyChecks,
  resolveErrorHelpTopic,
  resolveUnavailableReasonHelpTopic,
  selectProbeGroupsForUnreadyChecks,
  summarizeEnvironmentChecks
} from './diagnostics/environment-matrix'

const { t } = useTranslation()
const as = useAppCommonStore()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)
const message = useMessage()
const router = useRouter()
const testingSystem = ref(false)
const retryingUnready = ref(false)
const testingSpeech = ref(false)
const testingCapture = ref(false)
const exportingDiagnostics = ref(false)
const loadingAcceptance = ref(false)
const exportingAcceptance = ref(false)
const acceptanceReport = ref<LiveCoachAcceptanceReport | null>(null)
const testResult = ref<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null)
const environmentProbeCache = ref(createEmptyEnvironmentProbeCache())
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

const environmentChecks = computed(() =>
  buildEnvironmentChecks({
    platform: as.platform,
    isElevated: as.isElevated,
    nativeInputStatus: resolveNativeInputStatus(as.nativeSupport.nativeInput, as.isElevated),
    nativeInputRequiresElevation: as.nativeSupport.nativeInput.requiresElevation,
    session: {
      mapId: coachStore.session.mapId,
      queueId: coachStore.session.queueId,
      patch: coachStore.session.patch
    },
    capability: {
      enabledFeatureIds: coachStore.capability.enabledFeatureIds,
      unavailable: coachStore.capability.unavailable
    },
    capture: {
      state: coachStore.capture.state,
      backend: coachStore.capture.backend,
      resolution: coachStore.capture.resolution,
      roiState: coachStore.capture.roiState,
      confidence: coachStore.capture.confidence
    },
    liveData: {
      state: coachStore.liveData.state,
      lastSuccessAt: coachStore.liveData.lastSuccessAt
    },
    settings: {
      speechVoiceId: coachStore.settings.speechVoiceId,
      speechOutputDeviceId: coachStore.settings.speechOutputDeviceId,
      shortcuts: [
        coachStore.settings.pauseShortcut,
        coachStore.settings.muteShortcut,
        coachStore.settings.repeatShortcut,
        coachStore.settings.overlayShortcut,
        coachStore.settings.recalibrateShortcut
      ]
    },
    probes: environmentProbeCache.value
  })
)

const environmentSummary = computed(() => summarizeEnvironmentChecks(environmentChecks.value))
const matrixHasRun = computed(() => environmentProbeCache.value.checkedAt !== null)
const matrixCheckedAt = computed(() => {
  const checkedAt = environmentProbeCache.value.checkedAt
  return checkedAt ? new Date(checkedAt).toLocaleTimeString() : ''
})
const environmentSummaryAlertType = computed(() =>
  environmentSummary.value === 'available'
    ? 'success'
    : environmentSummary.value === 'unavailable'
      ? 'error'
      : 'warning'
)
const probeFailures = computed(() =>
  (['capture', 'preview', 'voices', 'audio'] as const).flatMap((group) => {
    const result = environmentProbeCache.value[group]
    return result.state === 'error' ? [{ group, message: result.message }] : []
  })
)

const unavailableCapabilities = computed(() =>
  Object.entries(coachStore.capability.unavailable).sort(([left], [right]) =>
    left.localeCompare(right)
  )
)

const detectorVersions = computed(() =>
  Object.entries(coachStore.capture.modelVersions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => `${name} ${version}`)
    .join(', ')
)

const LIVE_DATA_DOMAIN_IDS = ['game-stats', 'players', 'events', 'active-player'] as const
const liveDataDomainRows = computed(() =>
  LIVE_DATA_DOMAIN_IDS.map((id) => ({
    id,
    health: coachStore.liveData.sourceHealth.find((candidate) => candidate.domain === id) ?? null
  }))
)

function formatUnavailableReason(reason: string) {
  return t(`liveCoach.diagnostics.unavailableReasons.${reason}`, reason)
}

function formatEnvironmentValue(check: EnvironmentCheck) {
  return t('liveCoach.diagnostics.environment.values.' + check.valueKey, check.valueParams ?? {})
}

function environmentStatusType(status: EnvironmentCheckStatus) {
  switch (status) {
    case 'available':
      return 'success'
    case 'partial':
      return 'warning'
    case 'unavailable':
      return 'error'
    default:
      return 'default'
  }
}

function liveDataHealthTagType(state: string | null) {
  switch (state) {
    case 'healthy':
      return 'success'
    case 'degraded':
      return 'warning'
    case 'unavailable':
      return 'error'
    default:
      return 'default'
  }
}

function formatMilliseconds(value: number | null) {
  return value === null ? t('liveCoach.diagnostics.unknownValue') : `${value.toFixed(1)} ms`
}

function formatAge(timestamp: number) {
  return t('liveCoach.diagnostics.secondsAgo', {
    seconds: Math.max(0, Math.round((now.value - timestamp) / 1000))
  })
}

function openHelpTopic(topic: string) {
  void router.push({
    name: 'live-coach',
    params: { section: 'help' },
    query: { topic }
  })
}

function openErrorHelp() {
  openHelpTopic(resolveErrorHelpTopic(coachStore.lastError?.code ?? 'internal-error'))
}

function openUnavailableReasonHelp(reason: string) {
  openHelpTopic(resolveUnavailableReasonHelpTopic(reason))
}

function acceptanceStatusType(status: 'passed' | 'failed' | 'pending') {
  return status === 'passed' ? 'success' : status === 'failed' ? 'error' : 'warning'
}

async function loadAcceptanceReport() {
  loadingAcceptance.value = true
  try {
    acceptanceReport.value = await coachShard.getAcceptanceReport()
  } catch (error: any) {
    message.error(error?.message || t('liveCoach.diagnostics.acceptanceLoadFailed'))
  } finally {
    loadingAcceptance.value = false
  }
}

async function exportAcceptanceReport() {
  exportingAcceptance.value = true
  try {
    const result = await coachShard.exportAcceptanceReport()
    if (!result.canceled) message.success(t('liveCoach.diagnostics.acceptanceExportDone'))
  } catch (error: any) {
    message.error(error?.message || t('liveCoach.diagnostics.acceptanceExportFailed'))
  } finally {
    exportingAcceptance.value = false
  }
}

async function clearAcceptanceEvidence() {
  try {
    await coachShard.clearAcceptanceEvidence()
    await loadAcceptanceReport()
    message.success(t('liveCoach.diagnostics.acceptanceClearDone'))
  } catch (error: any) {
    message.error(error?.message || t('liveCoach.diagnostics.acceptanceClearFailed'))
  }
}

async function captureProbeResult<T>(
  action: () => Promise<T>,
  failureMessage: string | ((error: unknown) => string)
): Promise<ProbeResult<T>> {
  try {
    return { state: 'success', value: await action() }
  } catch (error) {
    return {
      state: 'error',
      message: typeof failureMessage === 'function' ? failureMessage(error) : failureMessage
    }
  }
}

function previewProbeFailureMessage(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'consent-required'
    ? t('liveCoach.diagnostics.environment.probeErrors.previewConsentRequired')
    : t('liveCoach.diagnostics.environment.probeErrors.preview')
}

async function runEnvironmentProbeGroups(groups: EnvironmentProbeGroup[]) {
  const next = { ...environmentProbeCache.value }
  await Promise.all(
    groups.map(async (group) => {
      switch (group) {
        case 'capture':
          next.capture = await captureProbeResult(
            () => coachShard.probeCaptureSupport(),
            t('liveCoach.diagnostics.environment.probeErrors.capture')
          )
          break
        case 'preview':
          next.preview = await captureProbeResult(
            () => coachShard.requestCalibrationPreview(false),
            previewProbeFailureMessage
          )
          break
        case 'voices':
          next.voices = await captureProbeResult(
            () => coachShard.listVoices(),
            t('liveCoach.diagnostics.environment.probeErrors.voices')
          )
          break
        case 'audio':
          next.audio = await captureProbeResult(
            () => coachShard.listAudioDevices(),
            t('liveCoach.diagnostics.environment.probeErrors.audio')
          )
          break
      }
    })
  )
  next.checkedAt = Date.now()
  environmentProbeCache.value = next
}

function updateEnvironmentTestResult(includeStoreOnlyNotice = false) {
  const status = summarizeEnvironmentChecks(environmentChecks.value)
  const storeOnlyChecks = listUnprobeableUnreadyChecks(environmentChecks.value)
  const summary = t('liveCoach.diagnostics.environment.summary.' + status)
  const storeOnlyNotice =
    includeStoreOnlyNotice && storeOnlyChecks.length > 0
      ? ' ' + t('liveCoach.diagnostics.environment.storeOnlyNotice')
      : ''
  testResult.value = {
    type: status === 'available' ? 'success' : status === 'unavailable' ? 'error' : 'warning',
    message: summary + storeOnlyNotice
  }
}

async function runSystemSelfTest() {
  testingSystem.value = true
  try {
    await runEnvironmentProbeGroups(['capture', 'preview', 'voices', 'audio'])
    updateEnvironmentTestResult()
  } catch (error: unknown) {
    testResult.value = {
      type: 'error',
      message: error instanceof Error ? error.message : t('liveCoach.diagnostics.testFailed')
    }
  } finally {
    testingSystem.value = false
  }
}

async function rerunUnreadyChecks() {
  retryingUnready.value = true
  try {
    const groups = selectProbeGroupsForUnreadyChecks(environmentChecks.value)
    await runEnvironmentProbeGroups(groups)
    updateEnvironmentTestResult(true)
  } catch (error: unknown) {
    testResult.value = {
      type: 'error',
      message: error instanceof Error ? error.message : t('liveCoach.diagnostics.testFailed')
    }
  } finally {
    retryingUnready.value = false
  }
}

async function runSpeechTest() {
  testingSpeech.value = true
  try {
    const result = await coachShard.testSpeech({
      text: t('liveCoach.diagnostics.speechTestText')
    })
    testResult.value = {
      type: result.success ? 'success' : 'warning',
      message: result.success
        ? t('liveCoach.diagnostics.speechTestPassed')
        : t('liveCoach.diagnostics.speechTestUnavailable')
    }
  } catch {
    testResult.value = {
      type: 'error',
      message: t('liveCoach.diagnostics.testFailed')
    }
  } finally {
    testingSpeech.value = false
  }
}

async function runCaptureTest() {
  testingCapture.value = true
  try {
    const result = await coachShard.requestCalibrationPreview(false)
    environmentProbeCache.value = {
      ...environmentProbeCache.value,
      checkedAt: Date.now(),
      preview: { state: 'success', value: result }
    }
    const sourceSize = result.sourceSize
    testResult.value = {
      type: result.calibration.confidence >= 0.8 ? 'success' : 'warning',
      message: sourceSize
        ? t('liveCoach.diagnostics.captureTestPassed', {
            width: sourceSize.width,
            height: sourceSize.height,
            confidence: Math.round(result.calibration.confidence * 100)
          })
        : t('liveCoach.diagnostics.captureTestPassedUnknownSize', {
            confidence: Math.round(result.calibration.confidence * 100)
          })
    }
  } catch (error) {
    const failureMessage =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'consent-required'
        ? t('liveCoach.diagnostics.captureTestConsentRequired')
        : t('liveCoach.diagnostics.captureTestFailed')
    environmentProbeCache.value = {
      ...environmentProbeCache.value,
      checkedAt: Date.now(),
      preview: { state: 'error', message: failureMessage }
    }
    testResult.value = {
      type: 'error',
      message: failureMessage
    }
  } finally {
    testingCapture.value = false
  }
}

async function exportDiagnosticsReport() {
  exportingDiagnostics.value = true
  try {
    const result = await coachShard.exportDiagnosticsReport()
    if (!result.canceled) message.success(t('liveCoach.diagnostics.exportReportDone'))
  } catch (error: any) {
    message.error(error?.message || t('liveCoach.diagnostics.exportReportFailed'))
  } finally {
    exportingDiagnostics.value = false
  }
}

onMounted(() => {
  void loadAcceptanceReport()
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
  clockTimer = null
})
</script>
