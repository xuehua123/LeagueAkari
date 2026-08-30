<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto box-border flex w-full max-w-6xl flex-col gap-4 p-6">
        <NCard size="small" :title="t('liveCoach.help.title')">
          <div class="space-y-4">
            <NAlert type="info" :title="t('liveCoach.help.phaseTitle')">
              {{ t('liveCoach.help.phaseDescription') }}
            </NAlert>

            <div class="grid gap-3 md:grid-cols-2">
              <div
                v-for="step in quickStartSteps"
                :key="step.section"
                class="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700"
              >
                <div>
                  <div class="text-sm font-semibold">{{ step.title }}</div>
                  <div class="mt-1 text-xs leading-relaxed text-gray-500">
                    {{ step.description }}
                  </div>
                </div>
                <NButton
                  class="self-start"
                  size="small"
                  secondary
                  @click="openSection(step.section)"
                >
                  {{ step.action }}
                </NButton>
              </div>
            </div>

            <div
              class="rounded border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40"
            >
              <div class="font-semibold text-amber-800 dark:text-amber-200">
                {{ t('liveCoach.help.boundariesTitle') }}
              </div>
              <div
                class="mt-2 grid gap-2 text-xs text-amber-900/80 md:grid-cols-2 dark:text-amber-100/80"
              >
                <div>{{ t('liveCoach.help.boundaryObservation') }}</div>
                <div>{{ t('liveCoach.help.boundaryControl') }}</div>
                <div>{{ t('liveCoach.help.boundaryReplay') }}</div>
                <div>{{ t('liveCoach.help.boundaryPrivacy') }}</div>
              </div>
            </div>

            <div>
              <div class="mb-2 text-sm font-semibold">{{ t('liveCoach.help.topicsTitle') }}</div>
              <NCollapse v-model:expanded-names="expandedTopics" accordion>
                <NCollapseItem
                  v-for="topic in helpTopics"
                  :key="topic.key"
                  :name="topic.key"
                  :title="topic.title"
                >
                  <div class="space-y-3 text-xs leading-relaxed text-gray-500">
                    <div>{{ topic.description }}</div>
                    <NButton
                      v-if="topic.section"
                      size="small"
                      secondary
                      @click="openSection(topic.section)"
                    >
                      {{ topic.action }}
                    </NButton>
                    <NButton v-else size="small" secondary @click="openGuide">
                      {{ topic.action }}
                    </NButton>
                  </div>
                </NCollapseItem>
              </NCollapse>
            </div>

            <div class="flex flex-wrap gap-2">
              <NButton type="primary" @click="openGuide">
                {{ t('liveCoach.help.openGuide') }}
              </NButton>
              <NButton @click="openSection('overview')">
                {{ t('liveCoach.help.backToOverview') }}
              </NButton>
            </div>
          </div>
        </NCard>
      </div>
    </NScrollbar>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NAlert, NButton, NCard, NCollapse, NCollapseItem, NScrollbar } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()
const expandedTopics = ref<string[]>([])

const quickStartSteps = computed(() => [
  {
    section: 'overview',
    title: t('liveCoach.help.steps.enable.title'),
    description: t('liveCoach.help.steps.enable.description'),
    action: t('liveCoach.help.steps.enable.action')
  },
  {
    section: 'overview',
    title: t('liveCoach.help.steps.enterGame.title'),
    description: t('liveCoach.help.steps.enterGame.description'),
    action: t('liveCoach.help.steps.enterGame.action')
  },
  {
    section: 'coach',
    title: t('liveCoach.help.steps.personalize.title'),
    description: t('liveCoach.help.steps.personalize.description'),
    action: t('liveCoach.help.steps.personalize.action')
  }
])

const helpTopics = computed(() => [
  {
    key: 'getting-started',
    title: t('liveCoach.help.topics.gettingStarted.title'),
    description: t('liveCoach.help.topics.gettingStarted.description'),
    action: t('liveCoach.help.topics.gettingStarted.action'),
    section: null
  },
  {
    key: 'calibration',
    title: t('liveCoach.help.topics.calibration.title'),
    description: t('liveCoach.help.topics.calibration.description'),
    action: t('liveCoach.help.topics.calibration.action'),
    section: 'calibration'
  },
  {
    key: 'capture',
    title: t('liveCoach.help.topics.capture.title'),
    description: t('liveCoach.help.topics.capture.description'),
    action: t('liveCoach.help.topics.capture.action'),
    section: 'diagnostics'
  },
  {
    key: 'permission',
    title: t('liveCoach.help.topics.permission.title'),
    description: t('liveCoach.help.topics.permission.description'),
    action: t('liveCoach.help.topics.permission.action'),
    section: 'diagnostics'
  },
  {
    key: 'patch',
    title: t('liveCoach.help.topics.patch.title'),
    description: t('liveCoach.help.topics.patch.description'),
    action: t('liveCoach.help.topics.patch.action'),
    section: 'diagnostics'
  },
  {
    key: 'platform',
    title: t('liveCoach.help.topics.platform.title'),
    description: t('liveCoach.help.topics.platform.description'),
    action: t('liveCoach.help.topics.platform.action'),
    section: 'diagnostics'
  },
  {
    key: 'consent',
    title: t('liveCoach.help.topics.consent.title'),
    description: t('liveCoach.help.topics.consent.description'),
    action: t('liveCoach.help.topics.consent.action'),
    section: 'privacy'
  },
  {
    key: 'live-data',
    title: t('liveCoach.help.topics.liveData.title'),
    description: t('liveCoach.help.topics.liveData.description'),
    action: t('liveCoach.help.topics.liveData.action'),
    section: 'diagnostics'
  },
  {
    key: 'no-sound',
    title: t('liveCoach.help.topics.noSound.title'),
    description: t('liveCoach.help.topics.noSound.description'),
    action: t('liveCoach.help.topics.noSound.action'),
    section: 'voice'
  },
  {
    key: 'overlay',
    title: t('liveCoach.help.topics.overlay.title'),
    description: t('liveCoach.help.topics.overlay.description'),
    action: t('liveCoach.help.topics.overlay.action'),
    section: 'coach'
  },
  {
    key: 'automatic-pause',
    title: t('liveCoach.help.topics.automaticPause.title'),
    description: t('liveCoach.help.topics.automaticPause.description'),
    action: t('liveCoach.help.topics.automaticPause.action'),
    section: 'diagnostics'
  },
  {
    key: 'replay',
    title: t('liveCoach.help.topics.replay.title'),
    description: t('liveCoach.help.topics.replay.description'),
    action: t('liveCoach.help.topics.replay.action'),
    section: 'reviews'
  },
  {
    key: 'privacy',
    title: t('liveCoach.help.topics.privacy.title'),
    description: t('liveCoach.help.topics.privacy.description'),
    action: t('liveCoach.help.topics.privacy.action'),
    section: 'privacy'
  },
  {
    key: 'unsupported',
    title: t('liveCoach.help.topics.unsupported.title'),
    description: t('liveCoach.help.topics.unsupported.description'),
    action: t('liveCoach.help.topics.unsupported.action'),
    section: 'diagnostics'
  },
  {
    key: 'report-issue',
    title: t('liveCoach.help.topics.reportIssue.title'),
    description: t('liveCoach.help.topics.reportIssue.description'),
    action: t('liveCoach.help.topics.reportIssue.action'),
    section: 'diagnostics'
  }
])

function openSection(section: string) {
  void router.push({ name: 'live-coach', params: { section } })
}

function openGuide() {
  void router.push({
    name: 'live-coach',
    params: { section: 'overview' },
    query: { guide: '1' }
  })
}

watch(
  () => route.query.topic,
  (topic) => {
    if (typeof topic !== 'string' || !helpTopics.value.some((item) => item.key === topic)) return
    expandedTopics.value = [topic]
    const query = { ...route.query }
    delete query.topic
    void router.replace({ name: 'live-coach', params: { section: 'help' }, query })
  },
  { immediate: true }
)
</script>
