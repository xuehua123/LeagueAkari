<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
        <!-- 主开关卡片 -->
        <NCard size="small" :title="t('liveCoach.overview.mainSwitch', '实时语音 AI 教练')">
          <template #header-extra>
            <NSwitch :value="coachStore.settings.enabled" @update:value="handleEnabledChange" />
          </template>
          <div class="text-sm text-gray-500">
            {{
              t(
                'liveCoach.overview.mainSwitchDesc',
                '在召唤师峡谷对局中，基于小地图可见事实与 Live Client Data 提供实时确定性决策与语音辅助。'
              )
            }}
          </div>
        </NCard>

        <!-- 会话状态与快捷操作 -->
        <NCard size="small" :title="t('liveCoach.overview.sessionStatus', '当前会话状态')">
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="text-xs text-gray-400">{{ t('liveCoach.overview.sessionLabel') }}</div>
              <div class="font-mono text-base font-semibold capitalize">
                {{
                  t(
                    `liveCoach.overview.state.${coachStore.session.state}`,
                    coachStore.session.state
                  )
                }}
              </div>
              <div class="text-xs text-gray-400">
                {{
                  t('liveCoach.overview.currentCueCount', {
                    count: coachStore.sessionCueStats.total
                  })
                }}
              </div>
              <div
                v-if="coachStore.session.state === 'paused' && coachStore.session.pauseReason"
                class="mt-1 text-xs text-amber-600 dark:text-amber-300"
              >
                {{
                  t(
                    `liveCoach.overview.pauseReason.${coachStore.session.pauseReason}`,
                    coachStore.session.pauseReason
                  )
                }}
              </div>
            </div>
            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="text-xs text-gray-400">{{ t('liveCoach.overview.captureLabel') }}</div>
              <div class="font-mono text-base font-semibold uppercase">
                {{
                  coachStore.capture.backend
                    ? `${coachStore.capture.backend} (${coachStore.capture.fps} FPS)`
                    : t('liveCoach.overview.backendIdle', '空闲（等待对局）')
                }}
              </div>
              <div class="mt-1 text-xs text-gray-400">
                {{
                  coachStore.capture.resolution
                    ? `${coachStore.capture.resolution.width}×${coachStore.capture.resolution.height}`
                    : t('liveCoach.overview.resolutionUnknown', '未采集分辨率')
                }}
                · {{ t(`liveCoach.overview.roiState.${coachStore.capture.roiState}`) }}
              </div>
              <div class="truncate text-xs text-gray-400">
                {{ t('liveCoach.overview.patchLabel', '补丁版本：') }}
                {{ coachStore.session.patch || t('liveCoach.overview.patchUnconfirmed', '待确认') }}
              </div>
              <div class="text-xs text-gray-400">
                {{ t('liveCoach.overview.observationConfidence') }}
                {{
                  coachStore.capture.confidence === null
                    ? '--'
                    : formatPercent(coachStore.capture.confidence)
                }}
              </div>
            </div>
            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="text-xs text-gray-400">Live Data</div>
              <div class="font-mono text-base font-semibold capitalize">
                {{
                  t(
                    `liveCoach.overview.liveDataState.${coachStore.liveData.state}`,
                    coachStore.liveData.state
                  )
                }}
              </div>
            </div>
            <div
              class="rounded border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="text-xs text-gray-400">{{ t('liveCoach.overview.speechLabel') }}</div>
              <div class="font-mono text-base font-semibold capitalize">
                {{
                  t(
                    `liveCoach.overview.speechState.${coachStore.speech.state}`,
                    coachStore.speech.state
                  )
                }}
              </div>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <NButton
              size="small"
              type="primary"
              :disabled="
                !coachStore.settings.enabled ||
                coachStore.session.state === 'active' ||
                coachStore.session.state === 'shadow' ||
                coachStore.session.state === 'paused'
              "
              @click="handleStartManual"
            >
              {{ t('liveCoach.overview.startManualSession', '启动教练会话') }}
            </NButton>
            <NButton
              size="small"
              :disabled="!['active', 'shadow', 'paused'].includes(coachStore.session.state)"
              @click="handlePauseResume"
            >
              {{
                coachStore.session.state === 'paused'
                  ? t('liveCoach.overview.resumeSession', '恢复教练')
                  : t('liveCoach.overview.pauseSession', '暂停教练')
              }}
            </NButton>
            <NButton
              size="small"
              :disabled="!['active', 'shadow', 'paused'].includes(coachStore.session.state)"
              @click="coachShard.stopSession('user-manual-stop')"
            >
              {{ t('liveCoach.overview.stopSession', '结束当前会话') }}
            </NButton>
            <NButton size="small" @click="handleTestSpeech">
              {{ t('liveCoach.overview.testSpeech', '测试语音播报') }}
            </NButton>
          </div>
        </NCard>

        <NCard
          v-if="coachStore.lastSessionSummary"
          size="small"
          :title="t('liveCoach.overview.lastSessionSummary')"
        >
          <div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <div class="text-xs text-gray-400">{{ t('liveCoach.overview.duration') }}</div>
              <div class="font-semibold">
                {{ formatDuration(coachStore.lastSessionSummary.durationSeconds) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-gray-400">{{ t('liveCoach.overview.totalCues') }}</div>
              <div class="font-semibold">{{ coachStore.lastSessionSummary.totalCues }}</div>
            </div>
            <div>
              <div class="text-xs text-gray-400">{{ t('liveCoach.overview.warningCues') }}</div>
              <div class="font-semibold">{{ coachStore.lastSessionSummary.cueCounts.warning }}</div>
            </div>
            <div>
              <div class="text-xs text-gray-400">{{ t('liveCoach.overview.endReason') }}</div>
              <div class="truncate font-mono text-xs">
                {{ coachStore.lastSessionSummary.endReason }}
              </div>
            </div>
          </div>
        </NCard>

        <NCard
          v-if="latestReplayAnalysis"
          size="small"
          :title="t('liveCoach.overview.latestReplay.title')"
        >
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">
                {{
                  t('liveCoach.overview.latestReplay.label', {
                    fingerprint: latestReplayAnalysis.artifactSha256.slice(0, 8),
                    patch:
                      latestReplayAnalysis.metadata.patch ??
                      t('liveCoach.overview.latestReplay.unknownPatch')
                  })
                }}
              </div>
              <div class="text-xs text-gray-500">
                {{ t(`liveCoach.overview.latestReplay.status.${latestReplayAnalysis.status}`) }}
              </div>
            </div>
            <NButton size="small" secondary @click="openReplayHistory">
              {{ t('liveCoach.overview.latestReplay.open') }}
            </NButton>
          </div>
        </NCard>

        <div class="grid gap-4 lg:grid-cols-2">
          <NCard size="small" :title="t('liveCoach.overview.fogTitle')">
            <div v-if="coachStore.fogInferences.length" class="space-y-3">
              <div
                v-for="inference in coachStore.fogInferences"
                :key="inference.id"
                class="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <NTag size="small" type="warning">
                    {{ t('liveCoach.overview.enemyTrack', { id: inference.enemyTrackId }) }}
                  </NTag>
                  <span class="text-sm font-semibold">
                    {{
                      t('liveCoach.overview.confidence', {
                        value: formatPercent(inference.confidence)
                      })
                    }}
                  </span>
                  <span class="ml-auto text-xs text-gray-500">
                    {{
                      t('liveCoach.overview.expiresIn', {
                        seconds: secondsRemaining(inference.expiresAt)
                      })
                    }}
                  </span>
                </div>
                <div class="flex flex-wrap gap-1">
                  <NTag
                    v-for="region in inference.predictedRegions"
                    :key="region.regionId"
                    size="small"
                    secondary
                  >
                    {{ regionLabel(region.regionId) }} {{ formatPercent(region.probability) }}
                  </NTag>
                </div>
                <div
                  v-if="inference.candidateRoutes[0]"
                  class="text-xs text-gray-600 dark:text-gray-300"
                >
                  {{ t('liveCoach.overview.likelyRoute') }}
                  {{ inference.candidateRoutes[0].regionIds.map(regionLabel).join(' → ') }}
                  ({{ formatPercent(inference.candidateRoutes[0].probability) }})
                </div>
                <div v-if="inference.intents[0]" class="text-xs text-gray-600 dark:text-gray-300">
                  {{ t('liveCoach.overview.likelyIntent') }}
                  {{ intentLabel(inference.intents[0].kind) }}
                  ({{ formatPercent(inference.intents[0].probability) }})
                </div>
              </div>
            </div>
            <div v-else class="py-5 text-center text-sm text-gray-400">
              {{ t('liveCoach.overview.noFogInference') }}
            </div>
          </NCard>

          <NCard size="small" :title="t('liveCoach.overview.itemGuidanceTitle')">
            <template v-if="coachStore.itemGuidance">
              <div class="mb-3 flex flex-wrap items-center gap-2">
                <NTag size="small" type="info">
                  {{ t(`liveCoach.settings.itemGuidanceMode.${coachStore.itemGuidance.mode}`) }}
                </NTag>
                <span class="text-sm">
                  {{
                    t('liveCoach.overview.currentGold', {
                      gold: coachStore.itemGuidance.currentGold
                    })
                  }}
                </span>
              </div>
              <div
                class="rounded border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40"
              >
                <div class="mb-1 text-xs font-semibold text-gray-500">
                  {{ t('liveCoach.overview.primaryPurchase') }}
                </div>
                <div
                  v-for="condition in coachStore.itemGuidance.primaryPlan.conditions"
                  :key="condition"
                  class="text-sm font-medium"
                >
                  {{ condition }}
                </div>
                <div class="mt-1 text-xs text-gray-500">
                  {{ purchaseCostText(coachStore.itemGuidance.primaryPlan) }}
                </div>
              </div>
              <div v-if="coachStore.itemGuidance.alternativePlans.length" class="mt-3 space-y-2">
                <div
                  v-for="(plan, index) in coachStore.itemGuidance.alternativePlans"
                  :key="`${coachStore.itemGuidance.id}-${index}`"
                  class="rounded border border-gray-200 p-3 dark:border-gray-700"
                >
                  <div class="mb-1 text-xs font-semibold text-gray-500">
                    {{ t('liveCoach.overview.alternativePurchase') }}
                  </div>
                  <div
                    v-for="condition in plan.conditions"
                    :key="condition"
                    class="text-sm font-medium"
                  >
                    {{ condition }}
                  </div>
                  <div class="mt-1 text-xs text-gray-500">{{ purchaseCostText(plan) }}</div>
                </div>
              </div>
            </template>
            <div v-else class="py-5 text-center text-sm text-gray-400">
              {{ t('liveCoach.overview.noItemGuidance') }}
            </div>
          </NCard>
        </div>

        <NCard size="small" :title="t('liveCoach.overview.cooldownTitle')">
          <div v-if="coachStore.cooldowns.length" class="mb-4 space-y-2">
            <div
              v-for="cooldown in coachStore.cooldowns"
              :key="cooldown.id"
              class="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-3 dark:border-gray-700"
            >
              <NTag size="small" :type="cooldown.status === 'ready' ? 'success' : 'info'">
                {{ t(`liveCoach.overview.cooldownKind.${cooldown.kind}`) }}
              </NTag>
              <span class="text-sm font-medium">{{ cooldown.label }}</span>
              <span class="text-xs text-gray-500">
                {{ cooldownTimeText(cooldown) }}
              </span>
              <span class="text-xs text-gray-400">
                {{ t(`liveCoach.overview.cooldownSource.${cooldown.source}`) }} ·
                {{ formatPercent(cooldown.confidence) }}
              </span>
              <NButton
                v-if="cooldown.source === 'user-recorded'"
                class="ml-auto"
                size="tiny"
                tertiary
                @click="cancelCooldown(cooldown.id)"
              >
                {{ t('liveCoach.overview.cancelCooldown') }}
              </NButton>
            </div>
          </div>
          <div v-else class="mb-4 text-sm text-gray-400">
            {{ t('liveCoach.overview.noCooldowns') }}
          </div>

          <div class="grid gap-2 sm:grid-cols-[140px_1fr_130px_120px_auto]">
            <NSelect v-model:value="cooldownKind" size="small" :options="cooldownKindOptions" />
            <NInput
              v-model:value="cooldownLabel"
              size="small"
              :placeholder="t('liveCoach.overview.cooldownLabelPlaceholder')"
              maxlength="64"
            />
            <NInputNumber
              v-model:value="cooldownDurationSeconds"
              size="small"
              :min="1"
              :max="1800"
              :show-button="false"
            >
              <template #suffix>{{ t('liveCoach.overview.secondsUnit') }}</template>
            </NInputNumber>
            <NSelect v-model:value="cooldownOwnerTeam" size="small" :options="ownerTeamOptions" />
            <NButton
              size="small"
              type="primary"
              :disabled="
                !['active', 'shadow'].includes(coachStore.session.state) ||
                !cooldownLabel.trim() ||
                !cooldownDurationSeconds
              "
              @click="recordCooldown"
            >
              {{ t('liveCoach.overview.recordCooldown') }}
            </NButton>
          </div>
          <div class="mt-2 text-xs text-gray-400">
            {{ t('liveCoach.overview.cooldownDisclaimer') }}
          </div>
        </NCard>

        <!-- 最近提示与反馈 -->
        <NCard size="small" :title="t('liveCoach.overview.latestCue', '实时提示预览')">
          <div
            v-for="cue in displayedCues"
            :key="cue.id"
            class="mb-2 space-y-2 rounded border border-blue-200 bg-blue-50 p-4 last:mb-0 dark:border-blue-800 dark:bg-blue-950/40"
          >
            <div class="flex items-center gap-2">
              <NTag size="small" type="info">{{ cue.category }}</NTag>
              <NTag size="small" :type="cueStatusTagType(cue)">{{ cueStatusLabel(cue) }}</NTag>
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{
                cue.observationText
              }}</span>
              <span class="text-xs text-gray-400">{{ formatCueTime(cue.createdAt) }}</span>
            </div>
            <div v-if="cue.cancellationReason" class="text-xs text-amber-700 dark:text-amber-300">
              {{
                t(
                  `liveCoach.overview.cueCancellationReason.${cue.cancellationReason}`,
                  cue.cancellationReason
                )
              }}
            </div>
            <div v-if="cue.impactText" class="text-xs text-gray-600 dark:text-gray-300">
              {{ t('liveCoach.overview.impactPrefix') }}{{ cue.impactText }}
            </div>
            <div class="text-sm font-semibold text-blue-600 dark:text-blue-400">
              “{{ cue.spokenText }}”
            </div>
            <div class="flex flex-wrap gap-2 pt-1">
              <div v-for="opt of cue.options" :key="opt.id" class="flex items-center gap-1">
                <NTag size="tiny" secondary>
                  {{ t('liveCoach.overview.optionPrefix') }}{{ opt.label }}
                </NTag>
                <NButton
                  v-if="
                    isCommunicationOption(opt.id) &&
                    ['speaking', 'spoken'].includes(cue.status) &&
                    !isCueExpired(cue)
                  "
                  size="tiny"
                  tertiary
                  :loading="communicationPendingId === `${cue.id}:${opt.id}`"
                  @click="confirmCommunication(cue.id, opt.id)"
                >
                  {{ t('liveCoach.overview.confirmCommunication') }}
                </NButton>
              </div>
            </div>

            <div
              v-if="['speaking', 'spoken'].includes(cue.status)"
              class="flex flex-wrap items-center gap-1 border-t border-blue-200/70 pt-2 dark:border-blue-800/70"
            >
              <template v-if="!feedbackByCue[cue.id]">
                <span class="mr-1 text-xs text-gray-500">{{ t('liveCoach.feedback.prompt') }}</span>
                <NButton
                  v-for="option in feedbackOptions"
                  :key="option.type"
                  size="tiny"
                  tertiary
                  :loading="pendingCueId === cue.id"
                  @click="submitFeedback(cue.id, option.type)"
                >
                  {{ option.label }}
                </NButton>
              </template>
              <template v-else>
                <NTag size="small" type="success">
                  {{ t(`liveCoach.feedback.type.${feedbackByCue[cue.id].type}`) }}
                </NTag>
                <NButton size="tiny" tertiary @click="withdrawFeedback(feedbackByCue[cue.id])">
                  {{ t('liveCoach.feedback.withdraw') }}
                </NButton>
                <NButton
                  size="tiny"
                  tertiary
                  type="error"
                  @click="deleteFeedback(feedbackByCue[cue.id])"
                >
                  {{ t('liveCoach.feedback.delete') }}
                </NButton>
              </template>
            </div>
          </div>
          <div v-if="displayedCues.length === 0" class="py-6 text-center text-sm text-gray-400">
            {{ t('liveCoach.overview.noCue', '当前暂无正在播报的战术提示') }}
          </div>
        </NCard>
      </div>
    </NScrollbar>

    <NModal
      v-model:show="showOnboarding"
      preset="card"
      class="w-150! max-w-[calc(100vw-32px)]!"
      :mask-closable="false"
    >
      <template #header>{{ t('liveCoach.onboarding.title') }}</template>
      <div class="space-y-4 text-sm">
        <NSteps :current="onboardingStep" size="small">
          <NStep :title="t('liveCoach.onboarding.steps.scope')" />
          <NStep :title="t('liveCoach.onboarding.steps.environment')" />
          <NStep :title="t('liveCoach.onboarding.steps.prepare')" />
          <NStep :title="t('liveCoach.onboarding.steps.consent')" />
        </NSteps>

        <template v-if="onboardingStep === 1">
          <NAlert type="info" :title="t('liveCoach.onboarding.scopeTitle')">
            {{ t('liveCoach.onboarding.capabilities') }}
          </NAlert>
          <div class="grid gap-2 text-xs text-gray-600 sm:grid-cols-2 dark:text-gray-300">
            <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
              {{ t('liveCoach.onboarding.support') }}
            </div>
            <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
              {{ t('liveCoach.onboarding.risk') }}
            </div>
          </div>
          <div>
            <div class="mb-2 font-medium">{{ t('liveCoach.onboarding.pathTitle') }}</div>
            <NRadioGroup v-model:value="onboardingPath" name="live-coach-onboarding-path">
              <NRadioButton value="realtime">
                {{ t('liveCoach.onboarding.pathRealtime') }}
              </NRadioButton>
              <NRadioButton value="offline">
                {{ t('liveCoach.onboarding.pathOffline') }}
              </NRadioButton>
            </NRadioGroup>
            <div class="mt-2 text-xs text-gray-500">
              {{
                onboardingPath === 'realtime'
                  ? t('liveCoach.onboarding.pathRealtimeDesc')
                  : t('liveCoach.onboarding.pathOfflineDesc')
              }}
            </div>
          </div>
        </template>

        <template v-else-if="onboardingStep === 2">
          <template v-if="onboardingPath === 'realtime'">
            <div class="text-gray-600 dark:text-gray-300">
              {{ t('liveCoach.onboarding.test') }}
            </div>
            <div class="grid gap-2 sm:grid-cols-2">
              <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
                <div class="font-medium">{{ t('liveCoach.onboarding.environmentTitle') }}</div>
                <div class="mt-1 text-xs text-gray-500">
                  {{ t('liveCoach.onboarding.environmentDescription') }}
                </div>
                <NButton
                  class="mt-3"
                  size="small"
                  secondary
                  @click="openOnboardingSection('diagnostics')"
                >
                  {{ t('liveCoach.onboarding.openDiagnostics') }}
                </NButton>
              </div>
              <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
                <div class="font-medium">{{ t('liveCoach.onboarding.calibrationTitle') }}</div>
                <div class="mt-1 text-xs text-gray-500">
                  {{ t('liveCoach.onboarding.calibrationDescription') }}
                </div>
                <NButton
                  class="mt-3"
                  size="small"
                  secondary
                  @click="openOnboardingSection('calibration')"
                >
                  {{ t('liveCoach.onboarding.openCalibration') }}
                </NButton>
              </div>
            </div>
          </template>
          <template v-else>
            <NAlert type="info" :title="t('liveCoach.onboarding.offlineTitle')">
              {{ t('liveCoach.onboarding.offlineDescription') }}
            </NAlert>
            <NButton size="small" secondary @click="openOnboardingSection('reviews')">
              {{ t('liveCoach.onboarding.openReplay') }}
            </NButton>
          </template>
        </template>

        <template v-else-if="onboardingStep === 3">
          <template v-if="onboardingPath === 'realtime'">
            <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
              <div class="font-medium">{{ t('liveCoach.onboarding.controlsTitle') }}</div>
              <div class="mt-1 text-xs text-gray-500">
                {{ t('liveCoach.onboarding.controls') }}
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <NButton size="small" secondary @click="openOnboardingSection('coach')">
                  {{ t('liveCoach.onboarding.openControls') }}
                </NButton>
                <NButton size="small" secondary @click="handleTestSpeech">
                  {{ t('liveCoach.onboarding.testSpeech') }}
                </NButton>
              </div>
            </div>
          </template>
          <div class="grid gap-2 sm:grid-cols-2">
            <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
              <div class="font-medium">{{ t('liveCoach.onboarding.privacyTitle') }}</div>
              <div class="mt-1 text-xs text-gray-500">
                {{ t('liveCoach.onboarding.privacy') }}
              </div>
              <NButton
                class="mt-3"
                size="small"
                secondary
                @click="openOnboardingSection('privacy')"
              >
                {{ t('liveCoach.onboarding.openPrivacy') }}
              </NButton>
            </div>
            <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
              <div class="font-medium">{{ t('liveCoach.onboarding.replayTitle') }}</div>
              <div class="mt-1 text-xs text-gray-500">
                {{ t('liveCoach.onboarding.replayDescription') }}
              </div>
              <NButton
                class="mt-3"
                size="small"
                secondary
                @click="openOnboardingSection('reviews')"
              >
                {{ t('liveCoach.onboarding.openReplay') }}
              </NButton>
            </div>
          </div>
        </template>

        <template v-else>
          <NAlert type="warning" :title="t('liveCoach.onboarding.consentTitle')">
            {{ t('liveCoach.onboarding.consentDescription') }}
          </NAlert>
          <div class="grid gap-2 text-xs sm:grid-cols-2">
            <div class="rounded border border-gray-200 p-3 dark:border-gray-700">
              <div class="text-gray-500">{{ t('liveCoach.onboarding.summaryPath') }}</div>
              <div class="mt-1 font-medium">
                {{
                  onboardingPath === 'realtime'
                    ? t('liveCoach.onboarding.pathRealtime')
                    : t('liveCoach.onboarding.pathOffline')
                }}
              </div>
            </div>
            <div
              v-if="onboardingPath === 'realtime'"
              class="rounded border border-gray-200 p-3 dark:border-gray-700"
            >
              <div class="text-gray-500">{{ t('liveCoach.onboarding.summaryCalibration') }}</div>
              <div class="mt-1 font-medium">
                {{ t(`liveCoach.overview.roiState.${coachStore.capture.roiState}`) }}
              </div>
            </div>
            <div
              v-if="onboardingPath === 'realtime'"
              class="rounded border border-gray-200 p-3 dark:border-gray-700"
            >
              <div class="text-gray-500">{{ t('liveCoach.onboarding.summaryOutput') }}</div>
              <div class="mt-1 font-medium">
                {{
                  coachStore.settings.outputMode
                    .map((mode) => t(`liveCoach.overlay.output.${mode}`))
                    .join(t('liveCoach.reviews.listSeparator')) ||
                  t('liveCoach.onboarding.summaryNone')
                }}
              </div>
            </div>
            <div
              v-if="onboardingPath === 'realtime'"
              class="rounded border border-gray-200 p-3 dark:border-gray-700"
            >
              <div class="text-gray-500">{{ t('liveCoach.onboarding.summaryShortcuts') }}</div>
              <div class="mt-1 font-medium">
                {{
                  t('liveCoach.onboarding.summaryShortcutCount', { count: configuredShortcutCount })
                }}
              </div>
            </div>
          </div>
          <NCheckbox v-model:checked="onboardingAcknowledged">
            {{ t('liveCoach.onboarding.acknowledge') }}
          </NCheckbox>
          <div class="text-xs text-gray-500">
            {{ t('liveCoach.onboarding.reopenHint') }}
          </div>
        </template>
      </div>
      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <NButton v-if="onboardingStep > 1" @click="onboardingStep -= 1">
            {{ t('liveCoach.onboarding.previous') }}
          </NButton>
          <span v-else />
          <div class="flex gap-2">
            <NButton @click="showOnboarding = false">
              {{ t('liveCoach.onboarding.cancel') }}
            </NButton>
            <NButton v-if="onboardingStep < 4" type="primary" @click="onboardingStep += 1">
              {{ t('liveCoach.onboarding.next') }}
            </NButton>
            <NButton
              v-else
              type="primary"
              :disabled="!onboardingAcknowledged"
              @click="completeOnboarding"
            >
              {{
                onboardingPath === 'offline'
                  ? t('liveCoach.onboarding.startOffline')
                  : onboardingWillEnable
                    ? t('liveCoach.onboarding.enable')
                    : t('liveCoach.onboarding.done')
              }}
            </NButton>
          </div>
        </div>
      </template>
    </NModal>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { LiveCoachRenderer } from '@renderer-shared/shards/live-coach'
import { useLiveCoachStore } from '@renderer-shared/shards/live-coach/store'
import type {
  CoachCuePublicDto,
  CoachCooldownRecord,
  CoachFeedbackRecord,
  CoachFeedbackType,
  ItemPurchasePlan,
  ReplayAnalysisHistoryEntry
} from '@shared/types/live-coach'
import { hasCurrentLiveCoachPrivacyConsent } from '@shared/types/live-coach'
import { useTranslation } from 'i18next-vue'
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NScrollbar,
  NSelect,
  NStep,
  NSteps,
  NSwitch,
  NTag,
  useMessage
} from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const { t } = useTranslation()
const message = useMessage()
const coachStore = useLiveCoachStore()
const coachShard = useInstance(LiveCoachRenderer)
const route = useRoute()
const router = useRouter()
const pendingCueId = ref<string | null>(null)
const communicationPendingId = ref<string | null>(null)
const latestReplayAnalysis = ref<ReplayAnalysisHistoryEntry | null>(null)
const uiNow = ref(Date.now())
let uiClockTimer: ReturnType<typeof setInterval> | null = null
const showOnboarding = ref(false)
const onboardingStep = ref(1)
const onboardingPath = ref<'realtime' | 'offline'>('realtime')
const onboardingAcknowledged = ref(false)
const onboardingWillEnable = ref(false)
const privacyConsentGranted = computed(() => hasCurrentLiveCoachPrivacyConsent(coachStore.settings))
const feedbackByCue = reactive<Record<string, CoachFeedbackRecord>>({})
const cooldownKind = ref<'ability' | 'summoner-spell' | 'ultimate' | 'ward' | 'jungle-camp'>(
  'summoner-spell'
)
const cooldownLabel = ref('')
const cooldownDurationSeconds = ref<number | null>(300)
const cooldownOwnerTeam = ref<'self' | 'ally' | 'enemy' | 'neutral' | 'unknown'>('enemy')

const cooldownKindOptions = computed(() =>
  (['ability', 'summoner-spell', 'ultimate', 'ward', 'jungle-camp'] as const).map((value) => ({
    value,
    label: t(`liveCoach.overview.cooldownKind.${value}`)
  }))
)

const ownerTeamOptions = computed(() =>
  (['self', 'ally', 'enemy', 'neutral', 'unknown'] as const).map((value) => ({
    value,
    label: t(`liveCoach.overview.cooldownOwner.${value}`)
  }))
)

const configuredShortcutCount = computed(
  () =>
    [
      coachStore.settings.pauseShortcut,
      coachStore.settings.muteShortcut,
      coachStore.settings.recalibrateShortcut
    ].filter(Boolean).length
)

const displayedCues = computed<CoachCuePublicDto[]>(() => {
  const cues = coachStore.recentCues.toReversed()
  if (coachStore.cue && !cues.some((cue) => cue.id === coachStore.cue?.id)) {
    cues.unshift(coachStore.cue)
  }
  return cues.slice(0, 5)
})

const feedbackOptions = computed<Array<{ type: CoachFeedbackType; label: string }>>(() =>
  (['useful', 'not-useful', 'incorrect', 'late', 'too-frequent'] as CoachFeedbackType[]).map(
    (type) => ({ type, label: t(`liveCoach.feedback.type.${type}`) })
  )
)

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function secondsRemaining(expiresAt: number) {
  return Math.max(0, Math.ceil((expiresAt - uiNow.value) / 1000))
}

function isCueExpired(cue: CoachCuePublicDto) {
  return cue.status === 'expired' || cue.expiresAt <= uiNow.value
}

function cueStatusLabel(cue: CoachCuePublicDto) {
  const status = isCueExpired(cue) && cue.status === 'spoken' ? 'expired' : cue.status
  return t(`liveCoach.overview.cueStatus.${status}`, status)
}

function cueStatusTagType(cue: CoachCuePublicDto): 'default' | 'success' | 'warning' | 'error' {
  if (isCueExpired(cue)) return 'default'
  if (cue.status === 'spoken') return 'success'
  if (cue.status === 'speaking') return 'warning'
  return cue.status === 'cancelled' ? 'error' : 'default'
}

function formatCueTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function regionLabel(regionId: string) {
  return t(`liveCoach.overview.region.${regionId}`, regionId.replaceAll('_', ' '))
}

function intentLabel(intent: string) {
  return t(`liveCoach.overview.intent.${intent}`, intent)
}

function purchaseCostText(plan: ItemPurchasePlan) {
  return plan.missingGold > 0
    ? t('liveCoach.overview.missingGold', { gold: plan.missingGold })
    : t('liveCoach.overview.purchaseAffordable', {
        cost: plan.totalCost,
        remaining: plan.remainingGold
      })
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function cooldownTimeText(cooldown: CoachCooldownRecord) {
  if (cooldown.status === 'ready' || cooldown.earliestReadyAt <= uiNow.value) {
    return t('liveCoach.overview.cooldownReady')
  }
  const earliest = Math.max(0, Math.ceil((cooldown.earliestReadyAt - uiNow.value) / 1000))
  const latest = Math.max(earliest, Math.ceil((cooldown.latestReadyAt - uiNow.value) / 1000))
  return earliest === latest
    ? t('liveCoach.overview.cooldownSeconds', { seconds: earliest })
    : t('liveCoach.overview.cooldownRange', { earliest, latest })
}

async function recordCooldown() {
  if (!cooldownDurationSeconds.value || !cooldownLabel.value.trim()) return
  try {
    await coachShard.recordUserCooldown({
      kind: cooldownKind.value,
      label: cooldownLabel.value.trim(),
      ownerTeam: cooldownOwnerTeam.value,
      durationSeconds: cooldownDurationSeconds.value
    })
    cooldownLabel.value = ''
    message.success(t('liveCoach.overview.cooldownRecorded'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function cancelCooldown(recordId: string) {
  const result = await coachShard.cancelCooldown(recordId)
  if (result.cancelled) message.success(t('liveCoach.overview.cooldownCancelled'))
}

function isCommunicationOption(optionId: string) {
  return /^opt_(?:ping|chat)_(?:missing|resource|retreat|push|group|danger)$/i.test(optionId)
}

async function confirmCommunication(cueId: string, optionId: string) {
  communicationPendingId.value = `${cueId}:${optionId}`
  try {
    const result = await coachShard.confirmCommunicationCue(cueId, optionId)
    if (result.action === 'copied') {
      message.success(t('liveCoach.overview.communicationCopied'))
    } else if (result.reason === 'rate-limited') {
      message.warning(t('liveCoach.overview.communicationRateLimited'))
    } else {
      message.warning(t('liveCoach.overview.communicationBlocked'))
    }
  } finally {
    communicationPendingId.value = null
  }
}

function handleEnabledChange(enabled: boolean) {
  if (!enabled) {
    void coachShard.setEnabled(false)
    return
  }
  if (privacyConsentGranted.value) {
    void coachShard.setEnabled(true)
    return
  }
  openOnboarding(true)
}

function openOnboarding(enableAfterCompletion: boolean) {
  onboardingStep.value = 1
  onboardingPath.value = 'realtime'
  onboardingAcknowledged.value = false
  onboardingWillEnable.value = enableAfterCompletion
  showOnboarding.value = true
}

async function completeOnboarding() {
  if (!privacyConsentGranted.value) {
    await coachShard.setOnboardingCompleted(true)
  }
  if (onboardingPath.value === 'offline') {
    showOnboarding.value = false
    await router.push({ name: 'live-coach', params: { section: 'reviews' } })
    return
  }
  if (onboardingWillEnable.value) {
    await coachShard.setEnabled(true)
  }
  showOnboarding.value = false
}

function openOnboardingSection(section: string) {
  showOnboarding.value = false
  void router.push({ name: 'live-coach', params: { section } })
}

function openReplayHistory() {
  void router.push({ name: 'live-coach', params: { section: 'reviews' } })
}

watch(
  () => route.query.guide,
  (guide) => {
    if (guide !== '1' && guide !== 'consent') return
    openOnboarding(guide === 'consent' || !privacyConsentGranted.value)
    const query = { ...route.query }
    delete query.guide
    void router.replace({ name: 'live-coach', params: { section: 'overview' }, query })
  },
  { immediate: true }
)

onMounted(async () => {
  uiClockTimer = setInterval(() => {
    uiNow.value = Date.now()
  }, 1000)
  try {
    const feedback = await coachShard.listCueFeedback()
    for (const item of feedback) {
      if (item.status === 'active' && !feedbackByCue[item.cueId]) {
        feedbackByCue[item.cueId] = item
      }
    }
  } catch {
    message.warning(t('liveCoach.feedback.loadFailed'))
  }
  try {
    latestReplayAnalysis.value = (await coachShard.listReplayAnalyses())[0] ?? null
  } catch {
    latestReplayAnalysis.value = null
  }
})

onBeforeUnmount(() => {
  if (uiClockTimer) clearInterval(uiClockTimer)
})

async function submitFeedback(cueId: string, type: CoachFeedbackType) {
  pendingCueId.value = cueId
  try {
    const feedback = await coachShard.submitCueFeedback({ cueId, type })
    feedbackByCue[cueId] = feedback
    message.success(t('liveCoach.feedback.saved'))
  } catch (error: any) {
    message.error(error?.message || t('liveCoach.feedback.saveFailed'))
  } finally {
    pendingCueId.value = null
  }
}

async function withdrawFeedback(feedback: CoachFeedbackRecord) {
  await coachShard.withdrawCueFeedback(feedback.id)
  delete feedbackByCue[feedback.cueId]
  message.success(t('liveCoach.feedback.withdrawn'))
}

async function deleteFeedback(feedback: CoachFeedbackRecord) {
  const result = await coachShard.deleteCueFeedback(feedback.id)
  if (result.deleted) {
    delete feedbackByCue[feedback.cueId]
    message.success(t('liveCoach.feedback.deleted'))
  }
}

const handleStartManual = async () => {
  try {
    await coachShard.startManualSession()
    message.success(t('liveCoach.overview.manualSessionStarted'))
  } catch (err: any) {
    message.error(t('liveCoach.overview.manualSessionFailed', { error: err.message }))
  }
}

const handlePauseResume = async () => {
  try {
    if (coachStore.session.state === 'paused') {
      const result = await coachShard.resume()
      if (!result.success) throw new Error(`unexpected session state: ${result.state}`)
      message.success(t('liveCoach.overview.sessionResumed'))
      return
    }

    const result = await coachShard.pause('user-pause')
    if (!result.success) throw new Error(`unexpected session state: ${result.state}`)
    message.success(t('liveCoach.overview.sessionPaused'))
  } catch (err: any) {
    message.error(t('liveCoach.overview.sessionControlFailed', { error: err.message }))
  }
}

const handleTestSpeech = async () => {
  try {
    const result = await coachShard.testSpeech({
      text: t('liveCoach.overview.testSpeechText')
    })
    if (!result.success) {
      message.error(t('liveCoach.voice.testFailed'))
      return
    }
    message.success(t('liveCoach.voice.testSucceeded'))
  } catch (err: any) {
    message.error(t('liveCoach.overview.testSpeechFailed', { error: err.message }))
  }
}
</script>
