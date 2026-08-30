<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto box-border flex w-full max-w-6xl flex-col gap-4 p-6">
        <NCard size="small" :title="t('liveCoach.settings.featureSwitchesTitle')">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.autoStartSwitch') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.autoStartSwitchDesc') }}
                </div>
              </div>
              <NSwitch
                :value="coachStore.settings.autoStartEnabled"
                @update:value="(value) => coachShard.setAutoStartEnabled(value)"
              />
            </div>

            <NDivider style="margin: 12px 0" />

            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.shadowModeTitle') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.shadowModeDesc') }}
                </div>
              </div>
              <NSwitch
                :value="coachStore.settings.shadowModeEnabled"
                @update:value="(value) => coachShard.setShadowModeEnabled(value)"
              />
            </div>

            <NDivider style="margin: 12px 0" />

            <div class="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.fogInferenceSwitch') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.fogInferenceSwitchDesc') }}
                </div>
              </div>
              <div class="flex items-center gap-3">
                <NSelect
                  v-if="coachStore.settings.fogInferenceEnabled"
                  class="w-36"
                  :value="coachStore.settings.fogInferenceDetail"
                  :options="fogInferenceDetailOptions"
                  @update:value="(value) => coachShard.setFogInferenceDetail(value)"
                />
                <NSwitch
                  :value="coachStore.settings.fogInferenceEnabled"
                  @update:value="(value) => coachShard.setFogInferenceEnabled(value)"
                />
              </div>
            </div>

            <NDivider style="margin: 12px 0" />

            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.itemGuidanceSwitch') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.itemGuidanceSwitchDesc') }}
                </div>
              </div>
              <NSwitch
                :value="coachStore.settings.itemGuidanceEnabled"
                @update:value="(value) => coachShard.setItemGuidanceEnabled(value)"
              />
            </div>

            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.cooldownTrackingSwitch') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.cooldownTrackingSwitchDesc') }}
                </div>
              </div>
              <NSwitch
                :value="coachStore.settings.cooldownTrackingEnabled"
                @update:value="(value) => coachShard.setCooldownTrackingEnabled(value)"
              />
            </div>

            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.communicationAssistSwitch') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.communicationAssistSwitchDesc') }}
                </div>
              </div>
              <NSwitch
                :value="coachStore.settings.communicationAssistEnabled"
                @update:value="(value) => coachShard.setCommunicationAssistEnabled(value)"
              />
            </div>
          </div>
        </NCard>

        <NCard size="small" :title="t('liveCoach.settings.itemGuidanceTitle')">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-6">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.itemGuidanceModeTitle') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{
                    t(
                      `liveCoach.settings.itemGuidanceModeDesc.${coachStore.settings.itemGuidanceMode}`
                    )
                  }}
                </div>
              </div>
              <NSelect
                class="w-56"
                :value="coachStore.settings.itemGuidanceMode"
                :options="itemGuidanceModeOptions"
                @update:value="(value) => coachShard.setItemGuidanceMode(value)"
              />
            </div>

            <template v-if="coachStore.settings.itemGuidanceMode === 'custom'">
              <NDivider style="margin: 12px 0" />
              <div>
                <div class="mb-1 text-sm font-medium">
                  {{ t('liveCoach.settings.customBuildTitle') }}
                </div>
                <div class="mb-3 text-xs text-gray-400">
                  {{ t('liveCoach.settings.customBuildDesc') }}
                </div>
                <div class="flex items-center gap-2">
                  <NInputNumber
                    v-model:value="customChampionId"
                    class="w-36"
                    :min="1"
                    :precision="0"
                    :placeholder="t('liveCoach.settings.championIdPlaceholder')"
                  />
                  <NInput
                    v-model:value="customItemIds"
                    :placeholder="t('liveCoach.settings.itemIdsPlaceholder')"
                    @keyup.enter="saveCustomBuild"
                  />
                  <NButton type="primary" @click="saveCustomBuild">
                    {{ t('liveCoach.settings.saveCustomBuild') }}
                  </NButton>
                </div>

                <NList v-if="Object.keys(coachStore.settings.customItemBuilds).length" class="mt-3">
                  <NListItem
                    v-for="(itemIds, championId) of coachStore.settings.customItemBuilds"
                    :key="championId"
                  >
                    <div class="flex items-center justify-between gap-4">
                      <span class="text-sm">
                        {{
                          t('liveCoach.settings.customBuildRow', {
                            championId,
                            itemIds: itemIds.join(' → ')
                          })
                        }}
                      </span>
                      <NButton
                        size="tiny"
                        tertiary
                        type="error"
                        @click="removeCustomBuild(String(championId))"
                      >
                        {{ t('liveCoach.settings.removeCustomBuild') }}
                      </NButton>
                    </div>
                  </NListItem>
                </NList>
              </div>
            </template>
          </div>
        </NCard>

        <NCard size="small" :title="t('liveCoach.settings.communicationTitle')">
          <div class="space-y-4">
            <div class="text-xs text-gray-400">
              {{ t('liveCoach.settings.communicationDesc') }}
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div v-for="kind in communicationKinds" :key="kind">
                <div class="mb-1 flex items-center justify-between gap-2 text-xs font-medium">
                  <span>{{ t(`liveCoach.settings.communicationKind.${kind}`) }}</span>
                  <NSwitch
                    size="small"
                    :value="coachStore.settings.communicationCategories[kind]"
                    @update:value="(value) => updateCommunicationCategory(kind, value)"
                  />
                </div>
                <NInput
                  v-model:value="communicationTemplates[kind]"
                  :maxlength="80"
                  show-count
                  :disabled="!coachStore.settings.communicationCategories[kind]"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.communicationCooldownTitle') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.communicationCooldownDesc') }}
                </div>
              </div>
              <NInputNumber
                v-model:value="communicationCooldownSeconds"
                class="w-32"
                :min="3"
                :max="60"
                :precision="0"
              >
                <template #suffix>{{ t('liveCoach.overview.secondsUnit') }}</template>
              </NInputNumber>
            </div>

            <div class="flex justify-end">
              <NButton type="primary" @click="saveCommunicationSettings">
                {{ t('liveCoach.settings.saveCommunication') }}
              </NButton>
            </div>
          </div>
        </NCard>

        <NCard size="small" :title="t('liveCoach.settings.title', '教练模式与提醒策略')">
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.coachModeTitle', '教练提醒模式') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.coachModeDesc') }}
                </div>
              </div>
              <NRadioGroup
                :value="coachStore.settings.coachMode"
                @update:value="(val) => coachShard.setCoachMode(val)"
                size="small"
              >
                <NRadioButton value="minimal">{{
                  t('liveCoach.settings.modeMinimal', '极简（仅危险）')
                }}</NRadioButton>
                <NRadioButton value="balanced">{{
                  t('liveCoach.settings.modeBalanced', '均衡（推荐）')
                }}</NRadioButton>
                <NRadioButton value="training">{{
                  t('liveCoach.settings.modeTraining', '训练强化')
                }}</NRadioButton>
              </NRadioGroup>
            </div>

            <NDivider style="margin: 12px 0" />

            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <div class="mb-1 text-sm font-medium">
                  {{ t('liveCoach.settings.cueDensityTitle') }}
                </div>
                <NSelect
                  :value="coachStore.settings.cueDensity"
                  :options="cueDensityOptions"
                  @update:value="(value) => coachShard.setCueDensity(value)"
                />
              </div>
              <div>
                <div class="mb-1 text-sm font-medium">
                  {{ t('liveCoach.settings.minimumCueIntervalTitle') }}
                </div>
                <NInputNumber
                  :value="coachStore.settings.minimumCueIntervalSeconds"
                  :min="2"
                  :max="15"
                  :precision="0"
                  @update:value="
                    (value) => value !== null && coachShard.setMinimumCueIntervalSeconds(value)
                  "
                >
                  <template #suffix>{{ t('liveCoach.overview.secondsUnit') }}</template>
                </NInputNumber>
              </div>
            </div>

            <NDivider style="margin: 12px 0" />

            <div>
              <div class="mb-1 text-sm font-medium">
                {{ t('liveCoach.settings.outputModeTitle') }}
              </div>
              <div class="mb-2 text-xs text-gray-400">
                {{ t('liveCoach.settings.outputModeDesc') }}
              </div>
              <NCheckboxGroup
                :value="coachStore.settings.outputMode"
                @update:value="handleOutputModeChange"
              >
                <div class="flex flex-wrap gap-x-5 gap-y-2">
                  <NCheckbox value="sound">{{ t('liveCoach.settings.outputSound') }}</NCheckbox>
                  <NCheckbox value="subtitle">{{
                    t('liveCoach.settings.outputSubtitle')
                  }}</NCheckbox>
                  <NCheckbox value="speech">{{ t('liveCoach.settings.outputSpeech') }}</NCheckbox>
                </div>
              </NCheckboxGroup>
            </div>

            <NDivider style="margin: 12px 0" />

            <div>
              <div class="mb-2 text-sm font-medium">
                {{ t('liveCoach.settings.categoriesTitle') }}
              </div>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div
                  v-for="(enabled, cat) of coachStore.settings.cueCategories"
                  :key="cat"
                  class="flex items-center justify-between rounded border border-gray-100 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-800"
                >
                  <span class="text-xs font-medium">
                    {{ t(`liveCoach.settings.category.${String(cat)}`) }}
                  </span>
                  <NSwitch
                    size="small"
                    :value="enabled"
                    @update:value="
                      (val) =>
                        coachShard.setCueCategoryEnabled(
                          String(cat),
                          val,
                          coachStore.settings.cueCategories
                        )
                    "
                  />
                </div>
              </div>
            </div>

            <NDivider style="margin: 12px 0" />

            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.overlaySwitchTitle', '启用独立透明置顶悬浮窗') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{
                    t(
                      'liveCoach.settings.overlaySwitchDesc',
                      '在游戏画面上方展示半透明提示卡片，支持鼠标点击穿透'
                    )
                  }}
                </div>
              </div>
              <NSwitch
                :value="coachStore.settings.overlayEnabled"
                @update:value="(val) => coachShard.setOverlayEnabled(val)"
              />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.opacityTitle', '悬浮窗不透明度') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.opacityDesc') }}
                </div>
              </div>
              <div class="w-48">
                <NSlider
                  :value="coachStore.settings.overlayOpacity"
                  :min="0.3"
                  :max="1"
                  :step="0.05"
                  @update:value="(val) => coachShard.setOverlayOpacity(val)"
                />
              </div>
            </div>

            <div class="flex items-center justify-between gap-6">
              <div>
                <div class="text-sm font-medium">
                  {{ t('liveCoach.settings.overlayLockedTitle') }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ t('liveCoach.settings.overlayLockedDesc') }}
                </div>
              </div>
              <NSwitch
                :value="coachStore.settings.overlayLocked"
                @update:value="(value) => coachShard.setOverlayLocked(value)"
              />
            </div>
          </div>
        </NCard>

        <NCard size="small" :title="t('liveCoach.settings.shortcutsTitle')">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-6">
              <div>
                <div class="text-sm font-medium">{{ t('liveCoach.settings.muteTitle') }}</div>
                <div class="text-xs text-gray-400">{{ t('liveCoach.settings.muteDesc') }}</div>
              </div>
              <NSwitch
                :value="coachStore.settings.muted"
                @update:value="(value) => coachShard.setMuted(value)"
              />
            </div>

            <NDivider style="margin: 12px 0" />

            <div class="space-y-3">
              <div class="flex items-center justify-between gap-6">
                <div class="text-sm">{{ t('liveCoach.settings.pauseShortcut') }}</div>
                <ShortcutSelector
                  :target-id="LiveCoachRenderer.PAUSE_SHORTCUT_TARGET_ID"
                  :shortcut-id="coachStore.settings.pauseShortcut"
                  @update:shortcut-id="(value) => coachShard.setPauseShortcut(value)"
                />
              </div>
              <div class="flex items-center justify-between gap-6">
                <div class="text-sm">{{ t('liveCoach.settings.muteShortcut') }}</div>
                <ShortcutSelector
                  :target-id="LiveCoachRenderer.MUTE_SHORTCUT_TARGET_ID"
                  :shortcut-id="coachStore.settings.muteShortcut"
                  @update:shortcut-id="(value) => coachShard.setMuteShortcut(value)"
                />
              </div>
              <div class="flex items-center justify-between gap-6">
                <div class="text-sm">{{ t('liveCoach.settings.repeatShortcut') }}</div>
                <ShortcutSelector
                  :target-id="LiveCoachRenderer.REPEAT_SHORTCUT_TARGET_ID"
                  :shortcut-id="coachStore.settings.repeatShortcut"
                  @update:shortcut-id="(value) => coachShard.setRepeatShortcut(value)"
                />
              </div>
              <div class="flex items-center justify-between gap-6">
                <div class="text-sm">{{ t('liveCoach.settings.recalibrateShortcut') }}</div>
                <ShortcutSelector
                  :target-id="LiveCoachRenderer.RECALIBRATE_SHORTCUT_TARGET_ID"
                  :shortcut-id="coachStore.settings.recalibrateShortcut"
                  @update:shortcut-id="(value) => coachShard.setRecalibrateShortcut(value)"
                />
              </div>
              <div class="flex items-center justify-between gap-6">
                <div>
                  <div class="text-sm">{{ t('liveCoach.settings.overlayShortcut') }}</div>
                  <div class="text-xs text-gray-400">
                    {{ t('liveCoach.settings.overlayShortcutDesc') }}
                  </div>
                </div>
                <ShortcutSelector
                  :target-id="LiveCoachRenderer.OVERLAY_SHORTCUT_TARGET_ID"
                  :shortcut-id="coachStore.settings.overlayShortcut"
                  @update:shortcut-id="(value) => coachShard.setOverlayShortcut(value)"
                />
              </div>
              <div class="flex items-center justify-between gap-6">
                <div>
                  <div class="text-sm">
                    {{ t('liveCoach.settings.communicationConfirmShortcut') }}
                  </div>
                  <div class="text-xs text-gray-400">
                    {{ t('liveCoach.settings.communicationConfirmShortcutDesc') }}
                  </div>
                </div>
                <ShortcutSelector
                  :target-id="LiveCoachRenderer.COMMUNICATION_CONFIRM_SHORTCUT_TARGET_ID"
                  :shortcut-id="coachStore.settings.communicationConfirmShortcut"
                  @update:shortcut-id="(value) => coachShard.setCommunicationConfirmShortcut(value)"
                />
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
import type { CoachCommunicationKind, CoachCommunicationTemplates } from '@shared/types/live-coach'
import { useTranslation } from 'i18next-vue'
import {
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
  NDivider,
  NInput,
  NInputNumber,
  NList,
  NListItem,
  NRadioButton,
  NRadioGroup,
  NScrollbar,
  NSelect,
  NSlider,
  NSwitch,
  useMessage
} from 'naive-ui'
import { computed, reactive, ref, watch } from 'vue'

import ShortcutSelector from '../../components/ShortcutSelector.vue'

const { t } = useTranslation()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)
const message = useMessage()

const customChampionId = ref<number | null>(null)
const customItemIds = ref('')
const communicationKinds: CoachCommunicationKind[] = [
  'missing',
  'resource',
  'retreat',
  'push',
  'group',
  'danger'
]
const communicationTemplates = reactive<CoachCommunicationTemplates>({
  ...coachStore.settings.communicationTemplates
})
const communicationCooldownSeconds = ref(coachStore.settings.communicationCooldownSeconds)

watch(
  () => coachStore.settings.communicationTemplates,
  (templates) => Object.assign(communicationTemplates, templates),
  { deep: true, immediate: true }
)
watch(
  () => coachStore.settings.communicationCooldownSeconds,
  (seconds) => {
    communicationCooldownSeconds.value = seconds
  },
  { immediate: true }
)

const itemGuidanceModeOptions = computed(() => [
  { value: 'system', label: t('liveCoach.settings.itemGuidanceMode.system') },
  { value: 'common', label: t('liveCoach.settings.itemGuidanceMode.common') },
  { value: 'adaptive', label: t('liveCoach.settings.itemGuidanceMode.adaptive') },
  { value: 'custom', label: t('liveCoach.settings.itemGuidanceMode.custom') }
])

const fogInferenceDetailOptions = computed(() => [
  { value: 'region', label: t('liveCoach.settings.fogInferenceDetail.region') },
  { value: 'route', label: t('liveCoach.settings.fogInferenceDetail.route') },
  { value: 'intent', label: t('liveCoach.settings.fogInferenceDetail.intent') }
])

const cueDensityOptions = computed(() => [
  { value: 'low', label: t('liveCoach.settings.cueDensity.low') },
  { value: 'standard', label: t('liveCoach.settings.cueDensity.standard') },
  { value: 'high', label: t('liveCoach.settings.cueDensity.high') }
])

function saveCustomBuild() {
  if (!customChampionId.value) {
    message.warning(t('liveCoach.settings.customBuildChampionRequired'))
    return
  }

  const itemIds = Array.from(
    new Set(
      customItemIds.value
        .split(/[\s,，;；>→]+/)
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    )
  ).slice(0, 12)

  if (itemIds.length === 0) {
    message.warning(t('liveCoach.settings.customBuildItemsRequired'))
    return
  }

  coachShard.setCustomItemBuilds({
    ...coachStore.settings.customItemBuilds,
    [String(customChampionId.value)]: itemIds
  })
  customChampionId.value = null
  customItemIds.value = ''
  message.success(t('liveCoach.settings.customBuildSaved'))
}

function removeCustomBuild(championId: string) {
  const next = { ...coachStore.settings.customItemBuilds }
  delete next[championId]
  coachShard.setCustomItemBuilds(next)
}

async function saveCommunicationSettings() {
  const templates = Object.fromEntries(
    communicationKinds.map((kind) => [kind, communicationTemplates[kind].trim()])
  ) as CoachCommunicationTemplates
  if (communicationKinds.some((kind) => templates[kind].length === 0)) {
    message.warning(t('liveCoach.settings.communicationTemplateRequired'))
    return
  }

  const cooldownSeconds = communicationCooldownSeconds.value
  if (cooldownSeconds === null) {
    message.warning(t('liveCoach.settings.communicationCooldownRequired'))
    return
  }

  await Promise.all([
    coachShard.setCommunicationTemplates(templates),
    coachShard.setCommunicationCooldownSeconds(cooldownSeconds)
  ])
  Object.assign(communicationTemplates, templates)
  message.success(t('liveCoach.settings.communicationSaved'))
}

function updateCommunicationCategory(kind: CoachCommunicationKind, enabled: boolean) {
  coachShard.setCommunicationCategories({
    ...coachStore.settings.communicationCategories,
    [kind]: enabled
  })
}

function handleOutputModeChange(values: Array<string | number>) {
  const modes = values.filter(
    (value): value is 'sound' | 'subtitle' | 'speech' =>
      value === 'sound' || value === 'subtitle' || value === 'speech'
  )
  coachShard.setOutputMode(modes)
}
</script>
