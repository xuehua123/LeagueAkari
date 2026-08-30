<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto box-border flex w-full max-w-6xl flex-col gap-4 p-6">
        <NCard size="small" :title="t('liveCoach.reviews.history.title')">
          <div class="mb-3 flex flex-wrap justify-end gap-2">
            <NButton size="tiny" :loading="historyLoading" @click="loadReplayHistory()">
              {{ t('liveCoach.reviews.history.refresh') }}
            </NButton>
            <NButton
              size="tiny"
              type="error"
              secondary
              :disabled="replayHistory.length === 0"
              @click="clearReplayHistory"
            >
              {{ t('liveCoach.reviews.history.clearAll') }}
            </NButton>
          </div>
          <NEmpty
            v-if="!historyLoading && replayHistory.length === 0"
            :description="t('liveCoach.reviews.history.empty')"
          />
          <div v-else class="space-y-2">
            <div
              v-for="entry in replayHistory"
              :key="entry.id"
              class="flex flex-wrap items-center gap-2 rounded border border-gray-100 p-2 text-xs dark:border-gray-700"
            >
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium">
                  {{ formatHistoryLabel(entry) }}
                </div>
                <div class="text-gray-500">
                  {{ formatHistoryStatus(entry.status) }} · {{ formatHistoryDate(entry.createdAt) }}
                </div>
              </div>
              <NButton
                v-if="entry.status === 'completed'"
                size="tiny"
                secondary
                @click="openHistoryEntry(entry.id)"
              >
                {{ t('liveCoach.reviews.history.open') }}
              </NButton>
              <NButton
                v-if="['failed', 'cancelled', 'interrupted'].includes(entry.status)"
                size="tiny"
                type="primary"
                secondary
                @click="retryHistoryEntry(entry)"
              >
                {{ t('liveCoach.reviews.history.retryFromStart') }}
              </NButton>
              <NButton size="tiny" type="error" secondary @click="deleteHistoryEntry(entry.id)">
                {{ t('liveCoach.reviews.history.delete') }}
              </NButton>
            </div>
          </div>
        </NCard>

        <NCard size="small" :title="t('liveCoach.reviews.title', '战术复盘与离线录像分析')">
          <div class="mb-4 space-y-3 text-sm text-gray-500">
            <div>
              {{
                t(
                  'liveCoach.reviews.desc',
                  '离线分析对局回放与录像数据，回溯战术关键决策点与小地图事实证据链。'
                )
              }}
            </div>
            <NAlert type="info" :title="t('liveCoach.reviews.importGuideTitle')">
              <div class="space-y-1 text-xs">
                <div>{{ t('liveCoach.reviews.importFormats') }}</div>
                <div>{{ t('liveCoach.reviews.sidecarGuide') }}</div>
                <div>{{ t('liveCoach.reviews.sourceBoundary') }}</div>
              </div>
            </NAlert>
            <div class="flex flex-wrap gap-2">
              <NButton size="small" secondary @click="triggerFileInput">
                {{ t('liveCoach.reviews.importReplayBtn') }}
              </NButton>
              <NButton size="small" type="primary" secondary @click="loadSampleReplay">
                {{ t('liveCoach.reviews.loadDemoBtn', '加载标准对局演示') }}
              </NButton>
              <NButton size="small" :disabled="!selectedAnalysisId" @click="exportAnalysisJson">
                {{ t('liveCoach.reviews.exportAnalysisJsonBtn', '导出分析结果 JSON') }}
              </NButton>
              <NButton size="small" :disabled="!selectedAnalysisId" @click="exportMarkdown">
                {{ t('liveCoach.reviews.exportMarkdownBtn', '导出 Markdown 报告') }}
              </NButton>
              <NButton
                size="small"
                type="error"
                secondary
                :disabled="!replayData"
                @click="deleteAnalysis"
              >
                {{ t('liveCoach.reviews.deleteAnalysis') }}
              </NButton>
            </div>
          </div>

          <div v-if="loading" class="flex flex-col items-center justify-center space-y-3 py-8">
            <NSpin size="medium" />
            <div class="text-xs text-gray-500">
              {{ progressMessage || t('liveCoach.reviews.processing') }}
            </div>
            <NProgress
              class="max-w-sm"
              type="line"
              :percentage="progressPercent"
              :show-indicator="true"
            />
            <NButton size="tiny" type="error" secondary @click="cancelImport">
              {{ t('liveCoach.reviews.cancelImportBtn', '取消导入') }}
            </NButton>
          </div>

          <div v-else-if="replayData" class="space-y-4">
            <NAlert
              v-if="isSampleReplay"
              type="info"
              :title="t('liveCoach.reviews.demoResultTitle')"
            >
              {{ t('liveCoach.reviews.demoResultDescription') }}
            </NAlert>
            <!-- 概览指标 -->
            <div
              class="grid grid-cols-3 gap-3 rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div>
                <div class="text-xs text-gray-400">{{ t('liveCoach.reviews.sessionId') }}</div>
                <div class="truncate font-mono text-sm font-medium">
                  {{ replayData.sidecar.sessionId }}
                </div>
              </div>
              <div>
                <div class="text-xs text-gray-400">{{ t('liveCoach.reviews.patch') }}</div>
                <div class="text-sm font-medium">{{ replayData.sidecar.patch }}</div>
              </div>
              <div>
                <div class="text-xs text-gray-400">{{ t('liveCoach.reviews.totalCues') }}</div>
                <div class="text-sm font-semibold text-blue-600 dark:text-blue-400">
                  {{ t('liveCoach.reviews.cueCount', { count: replayData.sidecar.totalCues }) }}
                </div>
              </div>
            </div>

            <div
              v-if="replayData.session?.capabilityStatus"
              class="grid gap-2 text-xs sm:grid-cols-2"
            >
              <div
                class="rounded bg-green-50 p-2 text-green-800 dark:bg-green-950 dark:text-green-200"
              >
                {{
                  t('liveCoach.reviews.capability.available', {
                    capabilities: replayData.session.capabilityStatus.available
                      .map(formatReplayCapability)
                      .join(t('liveCoach.reviews.listSeparator'))
                  })
                }}
              </div>
              <div
                class="rounded bg-gray-100 p-2 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                <div
                  v-for="item in replayData.session.capabilityStatus.disabled"
                  :key="item.capability"
                >
                  {{
                    t('liveCoach.reviews.capability.disabled', {
                      capability: formatReplayCapability(item.capability),
                      reason: formatReplayDisableReason(item.reason)
                    })
                  }}
                </div>
              </div>
            </div>

            <div
              class="space-y-3 rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div v-if="replayVideoUrl" class="relative overflow-hidden rounded bg-black">
                <video
                  ref="replayVideoElement"
                  class="aspect-video w-full"
                  :src="replayVideoUrl"
                  preload="metadata"
                  @timeupdate="syncPlaybackFromVideo"
                  @play="isPlaying = true"
                  @pause="isPlaying = false"
                  @ended="isPlaying = false"
                />
                <span
                  class="absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-white"
                >
                  {{ t('liveCoach.reviews.offlineReviewBadge') }}
                </span>
              </div>
              <NAlert v-else-if="selectedAnalysisId" type="info">
                {{ t('liveCoach.reviews.history.sourceUnavailable') }}
              </NAlert>
              <div class="flex flex-wrap items-center gap-2">
                <NButton size="small" type="primary" secondary @click="togglePlayback">
                  {{
                    isPlaying
                      ? t('liveCoach.reviews.pausePlayback')
                      : t('liveCoach.reviews.startPlayback')
                  }}
                </NButton>
                <NButton size="small" @click="stepFrame(-1)">
                  {{ t('liveCoach.reviews.previousFrame') }}
                </NButton>
                <NButton size="small" @click="stepFrame(1)">
                  {{ t('liveCoach.reviews.nextFrame') }}
                </NButton>
                <NButton
                  v-for="speed in [1, 2, 4]"
                  :key="speed"
                  size="small"
                  :type="playbackSpeed === speed ? 'primary' : 'default'"
                  @click="playbackSpeed = speed"
                >
                  {{ speed }}×
                </NButton>
                <span class="ml-auto font-mono text-xs text-gray-500">
                  {{ formatClock(playbackPosition) }} / {{ formatClock(replayDuration) }}
                </span>
              </div>
              <NSlider
                v-model:value="playbackPosition"
                :min="0"
                :max="Math.max(1, replayDuration)"
                :step="0.1"
                :tooltip="false"
              />
              <div class="rounded bg-white p-2 text-xs dark:bg-gray-900">
                <span class="font-medium">{{ t('liveCoach.reviews.currentObservation') }}</span>
                {{ currentObservationText }}
              </div>
            </div>

            <!-- 战术时刻时间轴 -->
            <div class="space-y-3">
              <div class="text-sm font-medium">{{ t('liveCoach.reviews.timelineTitle') }}</div>
              <NTimeline>
                <NTimelineItem
                  v-for="(item, idx) of replayData.sidecar.timeline"
                  :key="idx"
                  :type="
                    item.category === 'warning'
                      ? 'error'
                      : item.category === 'opportunity'
                        ? 'warning'
                        : 'info'
                  "
                  :title="`[${item.gameTimeFormatted}] ${item.observation}`"
                  :time="item.category.toUpperCase()"
                >
                  <div class="mt-1 space-y-1">
                    <div class="text-xs font-medium text-amber-600 dark:text-amber-300">
                      {{ t('liveCoach.reviews.spokenText', { text: item.spokenText }) }}
                    </div>
                    <div class="flex flex-wrap gap-1">
                      <span
                        v-for="(opt, optIdx) of item.options"
                        :key="optIdx"
                        class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                      >
                        {{ t('liveCoach.reviews.option', { option: opt }) }}
                      </span>
                    </div>
                    <div
                      v-if="item.evidenceIds?.length"
                      class="font-mono text-[10px] text-gray-400"
                    >
                      {{ t('liveCoach.reviews.evidenceIds', { ids: item.evidenceIds.join(', ') }) }}
                    </div>
                    <div class="flex gap-2 pt-1">
                      <NButton size="tiny" secondary @click="jumpToTimelineItem(item)">
                        {{ t('liveCoach.reviews.jumpToMoment') }}
                      </NButton>
                      <NButton size="tiny" secondary @click="speakTimelineItem(item)">
                        {{ t('liveCoach.reviews.simulateSpeech') }}
                      </NButton>
                    </div>
                  </div>
                </NTimelineItem>
              </NTimeline>
            </div>
          </div>

          <NEmpty
            v-else
            :description="
              t(
                'liveCoach.reviews.emptyText',
                '暂无复盘数据，可点击上方「加载标准对局演示」或导入录像文件体验战术时间轴生成'
              )
            "
          />
        </NCard>

        <NModal
          v-model:show="showReplayCalibration"
          preset="card"
          class="max-w-3xl"
          :title="t('liveCoach.reviews.calibrationTitle')"
          :mask-closable="false"
        >
          <div v-if="preparedReplay && replayMetadata" class="space-y-3">
            <div class="text-sm text-gray-500">
              {{ t('liveCoach.reviews.calibrationDesc') }}
            </div>
            <div
              class="grid grid-cols-2 gap-2 rounded border border-gray-200 p-3 text-xs sm:grid-cols-4 dark:border-gray-700"
            >
              <div class="truncate" :title="preparedReplay.fileName">
                {{ preparedReplay.fileName }}
              </div>
              <div>{{ formatFileSize(preparedReplay.fileSizeBytes) }}</div>
              <div>{{ preparedReplay.probe.width }}×{{ preparedReplay.probe.height }}</div>
              <div>{{ preparedReplay.probe.fps }} FPS / {{ preparedReplay.probe.codec }}</div>
            </div>
            <div class="grid grid-cols-2 gap-x-3 sm:grid-cols-4">
              <NFormItem :label="t('liveCoach.reviews.metadata.patch')">
                <NInput
                  v-model:value="replayMetadata.patch"
                  clearable
                  :placeholder="t('liveCoach.reviews.metadata.patchPlaceholder')"
                />
              </NFormItem>
              <NFormItem :label="t('liveCoach.reviews.metadata.mapId')">
                <NInputNumber v-model:value="replayMetadata.mapId" clearable :min="1" />
              </NFormItem>
              <NFormItem :label="t('liveCoach.reviews.metadata.queueId')">
                <NInputNumber v-model:value="replayMetadata.queueId" clearable :min="0" />
              </NFormItem>
              <NFormItem :label="t('liveCoach.reviews.metadata.selfTeam')">
                <NSelect
                  v-model:value="replayMetadata.selfTeam"
                  clearable
                  :options="teamOptions"
                  :placeholder="t('liveCoach.reviews.metadata.unknown')"
                />
              </NFormItem>
              <NFormItem :label="t('liveCoach.reviews.metadata.minimapSide')">
                <NSelect
                  v-model:value="replayMetadata.minimapSide"
                  clearable
                  :options="minimapSideOptions"
                  :placeholder="t('liveCoach.reviews.metadata.unknown')"
                />
              </NFormItem>
              <NFormItem :label="t('liveCoach.reviews.metadata.selfChampionId')">
                <NInputNumber v-model:value="replayMetadata.selfChampionId" clearable :min="1" />
              </NFormItem>
              <NFormItem :label="t('liveCoach.reviews.metadata.gameStartOffset')">
                <NInputNumber v-model:value="replayGameStartSeconds" clearable :min="0" />
              </NFormItem>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <NFormItem :label="t('liveCoach.reviews.metadata.blueRoster')">
                <NInput
                  v-model:value="blueRosterText"
                  :placeholder="t('liveCoach.reviews.metadata.blueRosterPlaceholder')"
                />
              </NFormItem>
              <NFormItem :label="t('liveCoach.reviews.metadata.redRoster')">
                <NInput
                  v-model:value="redRosterText"
                  :placeholder="t('liveCoach.reviews.metadata.redRosterPlaceholder')"
                />
              </NFormItem>
            </div>
            <NAlert
              v-if="replayCapabilityStatus.missingFields.length"
              type="warning"
              :title="t('liveCoach.reviews.capability.missingTitle')"
            >
              {{
                t('liveCoach.reviews.capability.missingDescription', {
                  fields: replayCapabilityStatus.missingFields
                    .map(formatReplayMissingField)
                    .join(t('liveCoach.reviews.listSeparator'))
                })
              }}
            </NAlert>
            <div class="grid gap-2 text-xs sm:grid-cols-2">
              <div
                class="rounded bg-green-50 p-2 text-green-800 dark:bg-green-950 dark:text-green-200"
              >
                {{
                  t('liveCoach.reviews.capability.available', {
                    capabilities: replayCapabilityStatus.available
                      .map(formatReplayCapability)
                      .join(t('liveCoach.reviews.listSeparator'))
                  })
                }}
              </div>
              <div
                class="rounded bg-gray-100 p-2 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                <div v-for="item in replayCapabilityStatus.disabled" :key="item.capability">
                  {{
                    t('liveCoach.reviews.capability.disabled', {
                      capability: formatReplayCapability(item.capability),
                      reason: formatReplayDisableReason(item.reason)
                    })
                  }}
                </div>
              </div>
            </div>
            <RoiSelectionEditor
              v-model="replayRoi"
              :image-data-url="preparedReplay.imageDataUrl"
              :image-alt="t('liveCoach.reviews.calibrationPreviewAlt')"
              :empty-text="t('liveCoach.reviews.calibrationPreviewExpired')"
              :roi-aria-label="t('liveCoach.reviews.calibrationRoiAriaLabel')"
              :source-size="preparedReplay.probe"
            />
            <NAlert v-if="preparedReplay.calibration.confidence === 0" type="warning">
              {{ t('liveCoach.reviews.calibrationRequired') }}
            </NAlert>
            <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>{{ preparedReplay.probe.width }}×{{ preparedReplay.probe.height }}</div>
              <div>{{ preparedReplay.probe.codec }}</div>
              <div>{{ Math.round(preparedReplay.probe.durationSeconds) }}s</div>
              <div>
                {{ t('liveCoach.reviews.sidecarStatus') }}
                {{
                  preparedReplay.sidecarGrant
                    ? t('liveCoach.reviews.sidecarFound')
                    : t('liveCoach.reviews.sidecarMissing')
                }}
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <NButton @click="closeReplayCalibration">{{
                t('liveCoach.reviews.cancelCalibration')
              }}</NButton>
              <NButton type="primary" :disabled="!replayRoi" @click="startPreparedImport">
                {{ t('liveCoach.reviews.startAnalysis') }}
              </NButton>
            </div>
          </div>
        </NModal>
      </div>
    </NScrollbar>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { LiveCoachRenderer } from '@renderer-shared/shards/live-coach'
import {
  type CoachReplayImportMetadata,
  type MinimapCalibration,
  type ReplayAnalysisHistoryEntry,
  type ReplayAnalysisStoredResult,
  getReplayCapabilityStatus
} from '@shared/types/live-coach'
import { useTranslation } from 'i18next-vue'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NProgress,
  NScrollbar,
  NSelect,
  NSlider,
  NSpin,
  NTimeline,
  NTimelineItem,
  useDialog,
  useMessage
} from 'naive-ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { RoiSelectionEditor } from './roi-selection-editor'

const { t } = useTranslation()
const message = useMessage()
const dialog = useDialog()
const coachShard = useInstance(LiveCoachRenderer)

const loading = ref(false)
const progressMessage = ref('')
const progressPercent = ref(0)
const replayData = ref<{ session: any; sidecar: any; markdown: string; cues: any[] } | null>(null)
const isSampleReplay = ref(false)
const replayHistory = ref<ReplayAnalysisHistoryEntry[]>([])
const historyLoading = ref(false)
const selectedAnalysisId = ref<string | null>(null)
const volatileReplayVideoToken = ref<string | null>(null)
const pendingReplayGrantTokens = ref<string[]>([])
const showReplayCalibration = ref(false)
const preparedReplay = ref<Awaited<ReturnType<LiveCoachRenderer['prepareVideoReplay']>> | null>(
  null
)
const replayRoi = ref<MinimapCalibration['roi'] | null>(null)
const replayMetadata = ref<CoachReplayImportMetadata | null>(null)
const blueRosterText = ref('')
const redRosterText = ref('')
const playbackPosition = ref(0)
const playbackSpeed = ref(1)
const isPlaying = ref(false)
const replayVideoElement = ref<HTMLVideoElement | null>(null)

let progressDisposer: (() => void) | null = null
let previewExpiryTimer: ReturnType<typeof setTimeout> | null = null
let playbackTimer: ReturnType<typeof setInterval> | null = null

function releaseVolatileReplayVideo() {
  const token = volatileReplayVideoToken.value
  volatileReplayVideoToken.value = null
  if (token) void coachShard.revokeReplayFileGrants([token])
}

async function revokePendingReplayGrants() {
  const tokens = pendingReplayGrantTokens.value
  pendingReplayGrantTokens.value = []
  if (tokens.length) await coachShard.revokeReplayFileGrants(tokens)
}

const replayDuration = computed(() => Number(replayData.value?.sidecar.gameDurationSeconds) || 0)
const replayVideoUrl = computed(() => {
  const videoToken = volatileReplayVideoToken.value
  const artifactSha256 = replayData.value?.session?.artifactSha256
  return videoToken
    ? `akari://local/${encodeURIComponent(videoToken)}?v=${encodeURIComponent(artifactSha256 || '')}`
    : null
})
const teamOptions = computed(() => [
  { label: t('liveCoach.reviews.metadata.blueTeam'), value: 'blue' },
  { label: t('liveCoach.reviews.metadata.redTeam'), value: 'red' }
])
const minimapSideOptions = computed(() => [
  { label: t('liveCoach.reviews.metadata.leftSide'), value: 'left' },
  { label: t('liveCoach.reviews.metadata.rightSide'), value: 'right' }
])
const replayGameStartSeconds = computed<number | null>({
  get: () =>
    replayMetadata.value?.videoGameStartMs === null || !replayMetadata.value
      ? null
      : replayMetadata.value.videoGameStartMs / 1000,
  set: (value) => {
    if (replayMetadata.value)
      replayMetadata.value.videoGameStartMs = value === null ? null : value * 1000
  }
})
const replayCapabilityStatus = computed(() =>
  replayMetadata.value
    ? getReplayCapabilityStatus(
        replayMetadata.value,
        Boolean(preparedReplay.value?.sidecarGrant),
        preparedReplay.value?.hasExplicitSidecarGameTime ?? false
      )
    : { available: [], disabled: [], missingFields: [] }
)

const videoGameStartSeconds = computed(() => {
  const offsetMs = Number(replayData.value?.session?.metadata?.videoGameStartMs)
  return Number.isFinite(offsetMs) && offsetMs >= 0 ? offsetMs / 1000 : 0
})

const replayOriginTimestamp = computed(() => {
  if (!replayData.value) return 0
  const recordedAt = replayData.value.session?.metadata?.recordedAt
  if (Number.isFinite(recordedAt)) return recordedAt
  const first = replayData.value.sidecar.timeline?.[0]
  return first
    ? first.timestampMs - (parseClock(first.gameTimeFormatted) + videoGameStartSeconds.value) * 1000
    : 0
})

const framePositions = computed<number[]>(() => {
  if (!replayData.value) return []
  if (Array.isArray(replayData.value.session?.frames)) {
    return replayData.value.session.frames.map((frame: any) =>
      Math.max(0, (frame.timestamp - replayOriginTimestamp.value) / 1000)
    )
  }
  const frameCount = Number(replayData.value.session?.frameCount) || 0
  const analysisFps = Math.max(1, Number(replayData.value.session?.analysisFps) || 1)
  return Array.from({ length: frameCount }, (_, index) => index / analysisFps)
})

const currentObservationText = computed(() => {
  if (!replayData.value) return t('liveCoach.reviews.noCurrentObservation')
  if (Array.isArray(replayData.value.session?.frames)) {
    const frames = replayData.value.session.frames as any[]
    let left = 0
    let right = frames.length - 1
    let selected: any = null
    const absoluteTimestamp = replayOriginTimestamp.value + playbackPosition.value * 1000
    while (left <= right) {
      const middle = Math.floor((left + right) / 2)
      if (frames[middle].timestamp <= absoluteTimestamp) {
        selected = frames[middle]
        left = middle + 1
      } else {
        right = middle - 1
      }
    }
    if (!selected) return t('liveCoach.reviews.noCurrentObservation')
    return t('liveCoach.reviews.observationSummary', {
      minimap: selected.minimap?.entities?.length ?? 0,
      liveData: selected.liveData
        ? t('liveCoach.reviews.available')
        : t('liveCoach.reviews.unavailable')
    })
  }
  const frameCount = Number(replayData.value.session?.frameCount) || 0
  const analysisFps = Math.max(1, Number(replayData.value.session?.analysisFps) || 1)
  return t('liveCoach.reviews.videoFrameSummary', {
    current: Math.min(
      frameCount,
      Math.max(0, Math.floor(playbackPosition.value * analysisFps) + 1)
    ),
    total: frameCount
  })
})

watch(replayData, () => {
  stopPlayback()
  playbackPosition.value = 0
})

watch(playbackSpeed, (speed) => {
  if (replayVideoElement.value) replayVideoElement.value.playbackRate = speed
})

watch(playbackPosition, (position) => {
  const video = replayVideoElement.value
  if (video && Math.abs(video.currentTime - position) > 0.04) video.currentTime = position
})

onMounted(() => {
  progressDisposer = coachShard.onReplayImportProgress((payload) => {
    progressPercent.value = payload.progress
    progressMessage.value = payload.messageCode
      ? t(`liveCoach.reviews.progress.${payload.messageCode}`, payload.details)
      : payload.message
  })
  void loadReplayHistory(true)
})

onUnmounted(() => {
  if (progressDisposer) {
    progressDisposer()
  }
  if (previewExpiryTimer) clearTimeout(previewExpiryTimer)
  const tokens = [
    ...pendingReplayGrantTokens.value,
    ...(volatileReplayVideoToken.value ? [volatileReplayVideoToken.value] : [])
  ]
  if (tokens.length) void coachShard.revokeReplayFileGrants(tokens)
  stopPlayback()
})

function parseClock(value: string) {
  const [minutes, seconds] = value.split(':').map(Number)
  return (Number.isFinite(minutes) ? minutes : 0) * 60 + (Number.isFinite(seconds) ? seconds : 0)
}

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function formatReplayCapability(capability: string) {
  return t(`liveCoach.reviews.capability.names.${capability}`, capability)
}

function formatReplayMissingField(field: string) {
  return t(`liveCoach.reviews.metadata.fields.${field}`, field)
}

function formatReplayDisableReason(reason: string) {
  return t(`liveCoach.reviews.capability.reasons.${reason}`, reason)
}

function formatRoster(team: 'blue' | 'red') {
  return (replayMetadata.value?.roster ?? [])
    .filter((member) => member.team === team)
    .map((member) => member.championId)
    .join(',')
}

function parseRoster(value: string, team: 'blue' | 'red') {
  const tokens = value
    .split(/[,，\s]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  const championIds = tokens.map(Number)
  if (championIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error(
      t('liveCoach.reviews.errors.invalidRoster', {
        team: team === 'blue' ? teamOptions.value[0].label : teamOptions.value[1].label
      })
    )
  }
  return Array.from(new Set(championIds)).map((championId) => ({ team, championId }))
}

function stopPlayback() {
  isPlaying.value = false
  replayVideoElement.value?.pause()
  if (playbackTimer) clearInterval(playbackTimer)
  playbackTimer = null
}

function togglePlayback() {
  const video = replayVideoElement.value
  if (video) {
    video.playbackRate = playbackSpeed.value
    if (video.paused) {
      if (video.currentTime >= replayDuration.value) video.currentTime = 0
      void video.play().catch((error) => message.error(String(error)))
    } else {
      video.pause()
    }
    return
  }
  if (isPlaying.value) {
    stopPlayback()
    return
  }
  if (playbackPosition.value >= replayDuration.value) playbackPosition.value = 0
  isPlaying.value = true
  playbackTimer = setInterval(() => {
    playbackPosition.value = Math.min(
      replayDuration.value,
      playbackPosition.value + 0.25 * playbackSpeed.value
    )
    if (playbackPosition.value >= replayDuration.value) stopPlayback()
  }, 250)
}

function syncPlaybackFromVideo() {
  if (replayVideoElement.value) playbackPosition.value = replayVideoElement.value.currentTime
}

function stepFrame(direction: -1 | 1) {
  stopPlayback()
  const positions = framePositions.value
  if (positions.length === 0) return
  if (direction > 0) {
    playbackPosition.value =
      positions.find((position) => position > playbackPosition.value) ?? replayDuration.value
    return
  }
  playbackPosition.value =
    positions.toReversed().find((position) => position < playbackPosition.value) ?? 0
}

function jumpToTimelineItem(item: { timestampMs: number }) {
  stopPlayback()
  playbackPosition.value = Math.min(
    replayDuration.value,
    Math.max(0, (item.timestampMs - replayOriginTimestamp.value) / 1000)
  )
}

async function speakTimelineItem(item: { spokenText: string }) {
  try {
    const result = await coachShard.testSpeech({ text: item.spokenText })
    if (!result.success) throw new Error(t('liveCoach.voice.testFailed'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

function toReplayViewData(result: ReplayAnalysisStoredResult) {
  return {
    session: {
      id: result.historyId,
      durationSeconds: result.summary.durationSeconds,
      frameCount: result.summary.frameCount,
      analysisFps: result.summary.analysisFps,
      artifactSha256: result.summary.artifactSha256,
      metadata: result.summary.metadata,
      capabilityStatus: result.capabilityStatus,
      analyzedAt: Date.parse(result.generatedAt)
    },
    sidecar: {
      version: '1.0.0',
      sessionId: result.historyId,
      gameDurationSeconds: result.summary.durationSeconds,
      patch: result.summary.metadata.patch ?? 'unknown',
      totalCues: result.summary.totalCues,
      timeline: result.timeline.map((item) => ({
        timestampMs: item.gameTimeMs,
        gameTimeFormatted: formatClock(item.gameTimeMs / 1_000),
        category: item.category,
        observation: item.observation,
        spokenText: item.spokenText,
        options: item.options,
        evidenceIds: item.evidenceHashes
      })),
      evidencesSummary: { totalEvidences: result.summary.totalEvidences }
    },
    markdown: '',
    cues: []
  }
}

function formatHistoryLabel(entry: ReplayAnalysisHistoryEntry) {
  return t('liveCoach.reviews.history.itemLabel', {
    kind: t(`liveCoach.reviews.history.kind.${entry.sourceKind}`),
    fingerprint: entry.artifactSha256.slice(0, 8),
    patch: entry.metadata.patch ?? t('liveCoach.reviews.history.unknownPatch')
  })
}

function formatHistoryStatus(status: ReplayAnalysisHistoryEntry['status']) {
  return t(`liveCoach.reviews.history.status.${status}`)
}

function formatHistoryDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

async function loadReplayHistory(openLatest = false) {
  historyLoading.value = true
  try {
    replayHistory.value = await coachShard.listReplayAnalyses()
    if (
      selectedAnalysisId.value &&
      !replayHistory.value.some((entry) => entry.id === selectedAnalysisId.value)
    ) {
      selectedAnalysisId.value = null
      replayData.value = null
      isSampleReplay.value = false
    }
    if (openLatest && !selectedAnalysisId.value) {
      const latest = replayHistory.value.find((entry) => entry.status === 'completed')
      if (latest) await openHistoryEntry(latest.id)
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    historyLoading.value = false
  }
}

async function openHistoryEntry(analysisId: string) {
  const stored = await coachShard.getReplayAnalysis(analysisId)
  if (!stored?.result) {
    message.error(t('liveCoach.reviews.history.resultUnavailable'))
    return
  }
  selectedAnalysisId.value = stored.entry.id
  releaseVolatileReplayVideo()
  isSampleReplay.value = false
  replayData.value = toReplayViewData(stored.result)
}

function confirmHistoryDelete(all: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.warning({
      title: t(
        all
          ? 'liveCoach.reviews.history.clearConfirmTitle'
          : 'liveCoach.reviews.history.deleteConfirmTitle'
      ),
      content: t(
        all
          ? 'liveCoach.reviews.history.clearConfirmContent'
          : 'liveCoach.reviews.history.deleteConfirmContent'
      ),
      positiveText: t('liveCoach.reviews.history.confirm'),
      negativeText: t('liveCoach.reviews.history.cancel'),
      closable: false,
      maskClosable: false,
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false)
    })
  })
}

async function deleteHistoryEntry(analysisId: string) {
  if (!(await confirmHistoryDelete(false))) return
  const result = await coachShard.deleteReplayAnalysis(analysisId)
  if (selectedAnalysisId.value === analysisId) {
    selectedAnalysisId.value = null
    volatileReplayVideoToken.value = null
    replayData.value = null
    isSampleReplay.value = false
  }
  await loadReplayHistory()
  if (result.deleted) message.success(t('liveCoach.reviews.history.deleted'))
}

async function clearReplayHistory() {
  if (!(await confirmHistoryDelete(true))) return
  const result = await coachShard.clearReplayAnalyses()
  selectedAnalysisId.value = null
  volatileReplayVideoToken.value = null
  replayData.value = null
  isSampleReplay.value = false
  await loadReplayHistory()
  message.success(t('liveCoach.reviews.history.cleared', { count: result.deletedEntries }))
}

async function retryHistoryEntry(entry: ReplayAnalysisHistoryEntry) {
  let completed = false
  try {
    const selected = await coachShard.selectReplayFile()
    if (!selected) return
    pendingReplayGrantTokens.value = [selected.token]
    let sidecarToken: string | undefined
    if (entry.sidecarSha256) {
      const sidecar = await coachShard.selectReplaySidecarFile()
      if (!sidecar) {
        await revokePendingReplayGrants()
        return
      }
      sidecarToken = sidecar.token
      pendingReplayGrantTokens.value.push(sidecar.token)
    }
    loading.value = true
    progressMessage.value = t('liveCoach.reviews.history.retryingFromStart')
    const response = await coachShard.retryReplayAnalysis({
      analysisId: entry.id,
      sourceToken: selected.token,
      sidecarToken
    })
    selectedAnalysisId.value = response.entry.id
    releaseVolatileReplayVideo()
    volatileReplayVideoToken.value = selected.purpose === 'video' ? selected.token : null
    pendingReplayGrantTokens.value = []
    completed = true
    isSampleReplay.value = false
    replayData.value = toReplayViewData(response.result)
    await loadReplayHistory()
    message.success(t('liveCoach.reviews.history.retryCompleted'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    if (!completed) await revokePendingReplayGrants()
    loading.value = false
    progressMessage.value = ''
  }
}

async function deleteAnalysis() {
  stopPlayback()
  if (selectedAnalysisId.value) {
    await deleteHistoryEntry(selectedAnalysisId.value)
    return
  }
  replayData.value = null
  isSampleReplay.value = false
  message.success(t('liveCoach.reviews.analysisDeleted'))
}

async function triggerFileInput() {
  try {
    const selected = await coachShard.selectReplayFile()
    if (!selected) return
    pendingReplayGrantTokens.value = [selected.token]

    if (selected.purpose === 'json') {
      loading.value = true
      progressPercent.value = 5
      progressMessage.value = t('liveCoach.reviews.readingFile')
      const response = await coachShard.importVideoReplay({ sourceToken: selected.token })
      selectedAnalysisId.value = response.entry.id
      releaseVolatileReplayVideo()
      pendingReplayGrantTokens.value = []
      isSampleReplay.value = false
      replayData.value = toReplayViewData(response.result)
      await loadReplayHistory()
      message.success(
        response.duplicate
          ? t('liveCoach.reviews.history.duplicateOpened')
          : t('liveCoach.reviews.importFileCompleted', {
              file: selected.displayName
            })
      )
      return
    }

    loading.value = true
    progressPercent.value = 5
    progressMessage.value = t('liveCoach.reviews.preparingCalibration')
    const preparation = await coachShard.prepareVideoReplay({ sourceToken: selected.token })
    pendingReplayGrantTokens.value = [
      preparation.sourceGrant.token,
      ...(preparation.sidecarGrant ? [preparation.sidecarGrant.token] : [])
    ]
    preparedReplay.value = preparation
    replayRoi.value = { ...preparation.calibration.roi }
    replayMetadata.value = {
      ...preparation.metadata,
      roster: preparation.metadata.roster?.map((member) => ({ ...member })) ?? null
    }
    blueRosterText.value = formatRoster('blue')
    redRosterText.value = formatRoster('red')
    showReplayCalibration.value = true
    if (previewExpiryTimer) clearTimeout(previewExpiryTimer)
    previewExpiryTimer = setTimeout(
      () => {
        if (preparedReplay.value?.sourceGrant.token === preparation.sourceGrant.token) {
          preparedReplay.value = { ...preparedReplay.value, imageDataUrl: '' }
        }
      },
      Math.max(0, preparation.expiresAt - Date.now())
    )
  } catch (err: any) {
    await revokePendingReplayGrants()
    message.error(t('liveCoach.reviews.importFailed', { error: err?.message || String(err) }))
  } finally {
    loading.value = false
    progressMessage.value = ''
  }
}

async function closeReplayCalibration() {
  await revokePendingReplayGrants()
  resetReplayCalibration()
}

function resetReplayCalibration() {
  showReplayCalibration.value = false
  preparedReplay.value = null
  replayRoi.value = null
  replayMetadata.value = null
  blueRosterText.value = ''
  redRosterText.value = ''
  if (previewExpiryTimer) clearTimeout(previewExpiryTimer)
  previewExpiryTimer = null
}

async function startPreparedImport() {
  if (!preparedReplay.value || !replayRoi.value || !replayMetadata.value) return
  const preparation = preparedReplay.value
  const roi = { ...replayRoi.value }
  let roster: CoachReplayImportMetadata['roster']
  try {
    const members = [
      ...parseRoster(blueRosterText.value, 'blue'),
      ...parseRoster(redRosterText.value, 'red')
    ]
    if (members.length > 10) throw new Error(t('liveCoach.reviews.errors.rosterTooLarge'))
    roster = members.length ? members : null
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
    return
  }
  const metadata: CoachReplayImportMetadata = {
    ...replayMetadata.value,
    roster
  }
  showReplayCalibration.value = false
  loading.value = true
  progressPercent.value = 10
  progressMessage.value = t('liveCoach.reviews.startingAnalysis')
  try {
    const response = await coachShard.importVideoReplay({
      sourceToken: preparation.sourceGrant.token,
      sidecarToken: preparation.sidecarGrant?.token,
      roi,
      metadata
    })
    selectedAnalysisId.value = response.entry.id
    releaseVolatileReplayVideo()
    volatileReplayVideoToken.value = preparation.sourceGrant.token
    pendingReplayGrantTokens.value = []
    isSampleReplay.value = false
    replayData.value = toReplayViewData(response.result)
    await loadReplayHistory()
    message.success(
      response.duplicate
        ? t('liveCoach.reviews.history.duplicateOpened')
        : t('liveCoach.reviews.importCompleted')
    )
    resetReplayCalibration()
  } catch (error) {
    showReplayCalibration.value = true
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
    progressMessage.value = ''
  }
}

async function cancelImport() {
  try {
    const result = await coachShard.cancelReplayImport()
    await revokePendingReplayGrants()
    resetReplayCalibration()
    await loadReplayHistory()
    if (result.cancelled) message.info(t('liveCoach.reviews.importCancelled'))
  } catch {
    // ignore
  } finally {
    loading.value = false
    progressMessage.value = ''
  }
}

async function loadSampleReplay() {
  loading.value = true
  progressPercent.value = 100
  progressMessage.value = t('liveCoach.reviews.loadingDemo')
  try {
    const result = await coachShard.getSampleReplay()
    selectedAnalysisId.value = null
    releaseVolatileReplayVideo()
    isSampleReplay.value = true
    replayData.value = result
    message.success(t('liveCoach.reviews.demoLoaded'))
  } catch (err: any) {
    message.error(t('liveCoach.reviews.demoFailed', { error: err?.message || String(err) }))
  } finally {
    loading.value = false
    progressMessage.value = ''
  }
}

async function exportAnalysisJson() {
  if (!selectedAnalysisId.value) return
  try {
    const result = await coachShard.exportReplayAnalysis({
      format: 'json',
      analysisId: selectedAnalysisId.value
    })
    if (!result.canceled) message.success(t('liveCoach.reviews.analysisJsonExported'))
  } catch (error: any) {
    message.error(t('liveCoach.reviews.exportFailed', { error: error?.message || String(error) }))
  }
}

async function exportMarkdown() {
  if (!selectedAnalysisId.value) return
  try {
    const result = await coachShard.exportReplayAnalysis({
      format: 'markdown',
      analysisId: selectedAnalysisId.value
    })
    if (!result.canceled) message.success(t('liveCoach.reviews.markdownExported'))
  } catch (error: any) {
    message.error(t('liveCoach.reviews.exportFailed', { error: error?.message || String(error) }))
  }
}
</script>
