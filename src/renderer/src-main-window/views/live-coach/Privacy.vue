<template>
  <div class="max-w-4xl space-y-4">
    <NCard size="small" :title="t('liveCoach.privacy.title', '隐私保护与数据授权')">
      <div class="space-y-4">
        <div class="text-sm text-gray-500">
          League Akari
          严格遵循本地优先原则：所有原始画面默认仅在本地内存中处理，不自动落盘，不上传任何云端服务器。
        </div>

        <div
          class="flex items-center justify-between rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div>
            <div class="text-sm font-medium">麦克风语音采集授权（第三期）</div>
            <div class="text-xs text-gray-400">
              仅在按住 Push-to-Talk 快捷键时触发本地麦克风监听
            </div>
          </div>
          <NTag size="small" type="default">未启用</NTag>
        </div>

        <div
          class="flex items-center justify-between rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div>
            <div class="text-sm font-medium">第三方 AI Provider 直连（第三期 BYOK）</div>
            <div class="text-xs text-gray-400">
              采用用户自有 API Key 直连，密钥通过 Windows DPAPI 本地加密存储
            </div>
          </div>
          <NTag size="small" type="default">未配置</NTag>
        </div>
      </div>
    </NCard>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NCard, NTag } from 'naive-ui'

const { t } = useTranslation()
</script>
