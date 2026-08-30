<template>
  <Diagnostics v-if="route.params.section === 'diagnostics'" />
  <TabbedPage
    v-else
    :icon="BotIcon"
    :title="t('liveCoach.title', '实时语音 AI 教练')"
    :tabs="tabs"
    route-name="live-coach"
    default-tab="overview"
  />
</template>

<script setup lang="ts">
import {
  Bot24Regular as BotIcon,
  Headset24Regular as HeadsetIcon,
  History24Regular as HistoryIcon,
  Map24Regular as MapIcon,
  Navigation24Regular as NavigationIcon,
  PersonSettings20Regular as SettingsIcon,
  QuestionCircle24Regular as HelpIcon,
  Shield24Regular as ShieldIcon
} from '@vicons/fluent'
import { useTranslation } from 'i18next-vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import TabbedPage, { TabConfig } from '@main-window/components/TabbedPage.vue'

import Calibration from './Calibration.vue'
import CoachSettings from './CoachSettings.vue'
import Diagnostics from './Diagnostics.vue'
import Help from './Help.vue'
import Overview from './Overview.vue'
import Privacy from './Privacy.vue'
import Reviews from './Reviews.vue'
import VoiceSettings from './VoiceSettings.vue'

const { t } = useTranslation()
const route = useRoute()

const tabs = computed<TabConfig[]>(() => [
  {
    key: 'overview',
    name: t('liveCoach.tabs.overview', '概览与会话'),
    icon: NavigationIcon,
    component: Overview
  },
  {
    key: 'calibration',
    name: t('liveCoach.tabs.calibration', '小地图标定'),
    icon: MapIcon,
    component: Calibration
  },
  {
    key: 'coach',
    name: t('liveCoach.tabs.coach', '提醒策略'),
    icon: SettingsIcon,
    component: CoachSettings
  },
  {
    key: 'voice',
    name: t('liveCoach.tabs.voice', '语音设置'),
    icon: HeadsetIcon,
    component: VoiceSettings
  },
  {
    key: 'reviews',
    name: t('liveCoach.tabs.reviews', '战术复盘'),
    icon: HistoryIcon,
    component: Reviews
  },
  {
    key: 'privacy',
    name: t('liveCoach.tabs.privacy', '隐私与授权'),
    icon: ShieldIcon,
    component: Privacy
  },
  {
    key: 'help',
    name: t('liveCoach.tabs.help', '帮助与快速上手'),
    icon: HelpIcon,
    component: Help
  }
])
</script>
