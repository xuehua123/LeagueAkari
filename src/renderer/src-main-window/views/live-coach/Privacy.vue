<template>
  <div class="max-w-4xl space-y-4">
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
                '所有 Live Client Data 与小地图视觉帧分析均在本地隔离子进程中完成，不上传任何游戏画面至云端。'
              )
            }}
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
                '仅读取 Riot 官方 2999 端口与小地图公开信息，不进行内存读写或游戏注入，严格遵守 Riot 第三方应用开发者协议。'
              )
            }}
          </div>
        </div>
      </div>
    </NCard>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NCard } from 'naive-ui'

const { t } = useTranslation()
</script>
