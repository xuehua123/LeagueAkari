<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.reviews.title', '战术复盘与离线录像分析')">
      <div class="mb-4 flex items-center justify-between text-sm text-gray-500">
        <div>离线分析对局回放与录像数据，回溯战术关键决策点与小地图事实证据链。</div>
        <div class="flex gap-2">
          <NButton size="small" type="primary" secondary @click="loadSampleReplay">
            加载标准对局演示
          </NButton>
          <NButton size="small" :disabled="!replayData" @click="exportSidecar">
            导出 Sidecar JSON
          </NButton>
          <NButton size="small" :disabled="!replayData" @click="exportMarkdown">
            导出 Markdown 报告
          </NButton>
        </div>
      </div>

      <div v-if="loading" class="flex justify-center py-8">
        <NSpin size="medium" />
      </div>

      <div v-else-if="replayData" class="space-y-4">
        <!-- 概览指标 -->
        <div
          class="grid grid-cols-3 gap-3 rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div>
            <div class="text-xs text-gray-400">对局 ID</div>
            <div class="truncate font-mono text-sm font-medium">
              {{ replayData.sidecar.sessionId }}
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">游戏版本</div>
            <div class="text-sm font-medium">{{ replayData.sidecar.patch }}</div>
          </div>
          <div>
            <div class="text-xs text-gray-400">关键战术提示总数</div>
            <div class="text-sm font-semibold text-blue-600 dark:text-blue-400">
              {{ replayData.sidecar.totalCues }} 条
            </div>
          </div>
        </div>

        <!-- 战术时刻时间轴 -->
        <div class="space-y-3">
          <div class="text-sm font-medium">战术关键时刻时间轴</div>
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
                  播报内容: "{{ item.spokenText }}"
                </div>
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="(opt, optIdx) of item.options"
                    :key="optIdx"
                    class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    建议: {{ opt }}
                  </span>
                </div>
                <div v-if="item.evidenceIds?.length" class="font-mono text-[10px] text-gray-400">
                  证据链: {{ item.evidenceIds.join(', ') }}
                </div>
              </div>
            </NTimelineItem>
          </NTimeline>
        </div>
      </div>

      <NEmpty
        v-else
        description="暂无复盘数据，可点击上方「加载标准对局演示」体验离线录像与战术时间轴生成"
      />
    </NCard>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { LiveCoachRenderer } from '@renderer-shared/shards/live-coach'
import { useTranslation } from 'i18next-vue'
import { NButton, NCard, NEmpty, NSpin, NTimeline, NTimelineItem, useMessage } from 'naive-ui'
import { ref } from 'vue'

const { t } = useTranslation()
const message = useMessage()
const coachShard = useInstance(LiveCoachRenderer)

const loading = ref(false)
const replayData = ref<{ session: any; sidecar: any; markdown: string; cues: any[] } | null>(null)

async function loadSampleReplay() {
  loading.value = true
  try {
    const result = await coachShard.getSampleReplay()
    replayData.value = result
    message.success('已成功加载标准对局回放并生成战术关键时刻时间轴')
  } catch (err: any) {
    message.error(`加载回放演示失败: ${err?.message || err}`)
  } finally {
    loading.value = false
  }
}

function exportSidecar() {
  if (!replayData.value) return
  const dataStr =
    'data:text/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(replayData.value.sidecar, null, 2))
  const downloadAnchor = document.createElement('a')
  downloadAnchor.setAttribute('href', dataStr)
  downloadAnchor.setAttribute('download', `${replayData.value.sidecar.sessionId}.sidecar.json`)
  document.body.appendChild(downloadAnchor)
  downloadAnchor.click()
  downloadAnchor.remove()
  message.success('已导出 Sidecar JSON 录像文件')
}

function exportMarkdown() {
  if (!replayData.value) return
  const dataStr =
    'data:text/markdown;charset=utf-8,' + encodeURIComponent(replayData.value.markdown)
  const downloadAnchor = document.createElement('a')
  downloadAnchor.setAttribute('href', dataStr)
  downloadAnchor.setAttribute('download', `${replayData.value.sidecar.sessionId}_review.md`)
  document.body.appendChild(downloadAnchor)
  downloadAnchor.click()
  downloadAnchor.remove()
  message.success('已导出 Markdown 战术复盘报告')
}
</script>
