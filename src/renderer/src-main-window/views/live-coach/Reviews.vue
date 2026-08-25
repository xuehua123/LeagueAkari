<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.reviews.title', '战术复盘与会话记录')">
      <div class="mb-4 text-sm text-gray-500">
        在第二期与第三期中，此页面将展示每局对局的战术关键时刻、当时小地图证据回溯、以及语音/文本交互问答复盘。
      </div>

      <NEmpty
        description="暂无历史复盘记录（完成一期基础构建后，局内结构化事件与录像回放将在此展示）"
      />
    </NCard>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NCard, NEmpty } from 'naive-ui'

const { t } = useTranslation()
</script>
