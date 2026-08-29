import {
  type CoachReplayImportMetadata,
  CoachReplaySession,
  type MinimapCalibration,
  type ReplaySelectedFileGrant,
  coachReplaySessionSchema,
  getReplayCapabilityStatus,
  importVideoReplayRequestSchema,
  liveCoachAcceptanceReportSchema,
  prepareVideoReplayRequestSchema,
  recordUserCooldownRequestSchema,
  retryReplayAnalysisRequestSchema,
  revokeReplayFileGrantsRequestSchema,
  submitCoachFeedbackSchema
} from '@shared/types/live-coach'
import { resolveLiveGameSessionId } from '@shared/utils/live-game-session'
import { app, dialog } from 'electron'
import fs from 'node:fs'

import { AkariIpcError } from '../ipc'
import type { LiveCoachAcceptanceEvidenceController } from './acceptance-evidence-controller'
import type { CommunicationController } from './communication-controller'
import type { LiveCoachMainContext } from './context'
import type { CooldownTrackerController } from './cooldown-tracker-controller'
import type { CueFeedbackController } from './cue-feedback-controller'
import type { CueSchedulerController } from './cue-scheduler-controller'
import {
  createLiveCoachDiagnosticsReport,
  liveCoachDiagnosticsReportSchema
} from './diagnostics-report'
import { resolveLiveCoachGameflowContext } from './gameflow-context'
import { createLiveCoachLocalDataExport, liveCoachLocalDataExportSchema } from './local-data-export'
import type { LocalSpeechExecutor } from './local-speech-executor'
import {
  LIVE_COACH_CONSENT_REQUIRED_REASON,
  hasCurrentLiveCoachPrivacyConsent
} from './privacy-consent'
import {
  type ReplayHistoryController,
  createReplayAnalysisFingerprint,
  projectReplayAnalysisResult
} from './replay-history'
import {
  createReplayAnalysisExportDocument,
  createReplayAnalysisMarkdown
} from './replay-history/export'
import type { ReplayImportController, ResolvedReplayFileGrant } from './replay-import-controller'
import { CoachReplaySimulator } from './replay-simulator'
import type { LiveCoachSessionController } from './session-controller'

export class LiveCoachIpcHandlers {
  private readonly _replaySimulator: CoachReplaySimulator
  private _activeReplayAnalysisOperation: Promise<unknown> | null = null
  private _activeReplayHistoryId: string | null = null
  private _cancelReplayAnalysisRequested = false
  private _privacyConsentWithdrawalOperation: Promise<void> | null = null

  constructor(
    private readonly _context: LiveCoachMainContext,
    private readonly _sessionController: LiveCoachSessionController,
    private readonly _speechExecutor: LocalSpeechExecutor,
    private readonly _cueScheduler: CueSchedulerController,
    private readonly _feedbackController: CueFeedbackController,
    private readonly _acceptanceController: LiveCoachAcceptanceEvidenceController,
    private readonly _cooldownTracker: CooldownTrackerController,
    private readonly _communicationController: CommunicationController,
    private readonly _replayImportController: ReplayImportController,
    private readonly _replayHistoryController: ReplayHistoryController
  ) {
    this._replaySimulator = new CoachReplaySimulator()
  }

  public register(): void {
    const { ipc, namespace } = this._context

    ipc.onCall(namespace, 'startInternalSession', async (_e, options: any = {}) => {
      this._assertPrivacyConsent()
      if (this._context.state.buildChannel !== 'internal') {
        throw new Error('内部测试会话仅在 internal 构建中可用')
      }
      const sessionId = options.sessionId || `manual_${Date.now()}`
      const patch = typeof options.patch === 'string' && options.patch ? options.patch : 'unknown'
      this._sessionController.startSession(sessionId, 11, 420, patch)
      return { success: true, sessionId }
    })

    ipc.onCall(namespace, 'startManualSession', async () => {
      this._assertPrivacyConsent()
      if (!this._context.settings.enabled) {
        throw new Error('请先开启 AI 教练总开关')
      }
      const phase = this._context.leagueClient.data.gameflow.phase
      const gameflowSession = this._context.leagueClient.data.gameflow.session
      if (phase !== 'InProgress' || !gameflowSession) {
        throw new Error('当前没有可启动教练的进行中对局')
      }

      const { mapId, queueId } = resolveLiveCoachGameflowContext(gameflowSession)
      const sessionId = resolveLiveGameSessionId(gameflowSession.gameData?.gameId)
      const patch =
        this._context.state.session.patch || this._sessionController.latestPatch || 'unknown'
      this._sessionController.startSession(sessionId, mapId, queueId, patch)
      if (!['active', 'shadow'].includes(this._context.state.session.state)) {
        throw new Error('当前地图或队列信息尚未满足一期教练启动条件')
      }
      return { success: true, sessionId }
    })

    ipc.onCall(namespace, 'stopSession', async (_e, reason: string = 'user-manual-stop') => {
      this._sessionController.endSession(reason)
      return { success: true }
    })

    ipc.onCall(namespace, 'withdrawPrivacyConsent', async () => {
      await this.withdrawPrivacyConsent()
      return { success: true }
    })

    ipc.onCall(namespace, 'pause', async (_e, reason: string = 'user-pause') => {
      this._sessionController.pause(reason)
      const state = this._context.state.session.state
      return { success: state === 'paused', state }
    })

    ipc.onCall(namespace, 'resume', async () => {
      this._sessionController.resume()
      const state = this._context.state.session.state
      return { success: state === 'active' || state === 'shadow', state }
    })

    ipc.onCall(namespace, 'testSpeech', async (_e, options: any = {}) => {
      const text = options.text || '实时语音 AI 教练测试播报，音量与语速正常。'
      const success = await this._speechExecutor.speak(text, {
        volume: options.volume ?? this._context.settings.speechVolume,
        rate: options.rate ?? this._context.settings.speechRate,
        voiceId: options.voiceId ?? this._context.settings.speechVoiceId,
        outputDeviceId: options.outputDeviceId ?? this._context.settings.speechOutputDeviceId
      })
      return { success }
    })

    ipc.onCall(namespace, 'listVoices', async () => {
      return this._speechExecutor.listInstalledVoices()
    })

    ipc.onCall(namespace, 'submitCueFeedback', async (_e, rawParams: unknown) => {
      const params = submitCoachFeedbackSchema.parse(rawParams)
      return this._feedbackController.submit(params)
    })

    ipc.onCall(
      namespace,
      'listCueFeedback',
      async (_e, filters: { cueId?: string; sessionId?: string } = {}) =>
        this._feedbackController.list(filters)
    )

    ipc.onCall(namespace, 'withdrawCueFeedback', async (_e, feedbackId: string) => {
      return this._feedbackController.withdraw(feedbackId)
    })

    ipc.onCall(namespace, 'deleteCueFeedback', async (_e, feedbackId: string) => {
      return { deleted: await this._feedbackController.delete(feedbackId) }
    })

    ipc.onCall(namespace, 'exportLocalCoachData', async () => {
      const result = await dialog.showSaveDialog({
        title: '导出本机教练数据',
        defaultPath: `league-akari-coach-data-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true }
      }

      const feedback = this._feedbackController.list()
      const replayHistory = this._replayHistoryController.list()
      const replayResults = (
        await Promise.all(
          replayHistory.map((entry) => this._replayHistoryController.getResult(entry.id))
        )
      ).filter((result) => result !== null)
      const document = createLiveCoachLocalDataExport({
        appVersion: app.getVersion(),
        state: this._context.state,
        settings: this._context.settings,
        feedback,
        acceptance: this._acceptanceController.getReport(feedback),
        replayHistory,
        replayResults
      })
      const validatedDocument = liveCoachLocalDataExportSchema.parse(document)
      await fs.promises.writeFile(
        result.filePath,
        JSON.stringify(validatedDocument, null, 2),
        'utf-8'
      )
      return { canceled: false }
    })

    ipc.onCall(namespace, 'exportDiagnosticsReport', async () => {
      const result = await dialog.showSaveDialog({
        title: '导出实时教练诊断报告',
        defaultPath: `league-akari-coach-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true }
      }

      const report = createLiveCoachDiagnosticsReport({
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        state: this._context.state,
        settings: this._context.settings
      })
      const validatedReport = liveCoachDiagnosticsReportSchema.parse(report)
      await fs.promises.writeFile(
        result.filePath,
        JSON.stringify(validatedReport, null, 2),
        'utf-8'
      )
      return { canceled: false }
    })

    ipc.onCall(namespace, 'getAcceptanceReport', async () => {
      return this._acceptanceController.getReport(this._feedbackController.list())
    })

    ipc.onCall(namespace, 'exportAcceptanceReport', async () => {
      const result = await dialog.showSaveDialog({
        title: '导出第一期验收报告',
        defaultPath: `league-akari-phase-1-acceptance-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true }
      }
      const report = this._acceptanceController.getReport(this._feedbackController.list())
      const validatedReport = liveCoachAcceptanceReportSchema.parse(report)
      await fs.promises.writeFile(
        result.filePath,
        JSON.stringify(validatedReport, null, 2),
        'utf-8'
      )
      return { canceled: false }
    })

    ipc.onCall(namespace, 'clearAcceptanceEvidence', async () => {
      return this._acceptanceController.clear()
    })

    ipc.onCall(namespace, 'deleteLocalCoachData', async () => {
      await this._cancelActiveReplayAnalysis()
      this._replayImportController.revokeAllReplayFileGrants()
      if (
        this._context.state.session.id ||
        !['idle', 'disabled'].includes(this._context.state.session.state)
      ) {
        this._sessionController.endSession('local-data-deleted')
      }
      this._context.state.clearAllCoachData()
      const deletedFeedbackCount = await this._feedbackController.clear()
      const deletedAcceptance = await this._acceptanceController.clear()
      const deletedReplayHistory = await this._replayHistoryController.clear()
      await this._context.settingService.set('manualCalibration', null)
      return { deletedFeedbackCount, deletedAcceptance, deletedReplayHistory }
    })

    ipc.onCall(
      namespace,
      'exportReplayAnalysis',
      async (_e, params: { format: 'json' | 'markdown'; analysisId: string }) => {
        if (!params || !['json', 'markdown'].includes(params.format)) {
          throw new Error('不支持的复盘导出格式')
        }
        const historyEntry = this._replayHistoryController.get(params.analysisId)
        const storedResult = await this._replayHistoryController.getResult(params.analysisId)
        if (!historyEntry || !storedResult) throw new Error('复盘结果不存在或尚未完成')
        const safeAnalysisId = storedResult.historyId
        const isJson = params.format === 'json'
        const result = await dialog.showSaveDialog({
          title: isJson ? '导出复盘分析 JSON' : '导出复盘报告',
          defaultPath: isJson ? `${safeAnalysisId}.analysis.json` : `${safeAnalysisId}_review.md`,
          filters: [
            isJson
              ? { name: 'JSON', extensions: ['json'] }
              : { name: 'Markdown', extensions: ['md'] }
          ]
        })
        if (result.canceled || !result.filePath) {
          return { canceled: true }
        }
        const content = isJson
          ? JSON.stringify(createReplayAnalysisExportDocument(historyEntry, storedResult), null, 2)
          : createReplayAnalysisMarkdown(historyEntry, storedResult)
        await fs.promises.writeFile(result.filePath, content, 'utf-8')
        return { canceled: false }
      }
    )

    ipc.onCall(namespace, 'getEvidence', async (_e, evidenceId: string) => {
      const evidences = this._sessionController.fusion.getActiveEvidences()
      const found = evidences.find((e) => e.id === evidenceId)
      return found || null
    })

    ipc.onCall(namespace, 'listAudioDevices', async () => {
      return {
        outputDevices: await this._speechExecutor.listOutputDevices()
      }
    })

    ipc.onCall(namespace, 'cancelSpeech', async () => {
      this._cueScheduler.cancelSpeechPlayback()
      return { success: true }
    })

    ipc.onCall(namespace, 'recordUserCooldown', async (_e, rawRequest: unknown) => {
      if (!this._context.state.capability.enabledFeatureIds.includes('coach.track.cooldowns')) {
        throw new Error('当前环境的基础计时能力不可用')
      }
      return this._cooldownTracker.recordUserCooldown(
        recordUserCooldownRequestSchema.parse(rawRequest)
      )
    })

    ipc.onCall(namespace, 'cancelCooldown', async (_e, recordId: string) => {
      return { cancelled: this._cooldownTracker.cancel(recordId) }
    })

    ipc.onCall(
      namespace,
      'confirmCommunicationCue',
      async (_e, params: { cueId: string; optionId: string }) =>
        this._communicationController.confirmCueOption(params.cueId, params.optionId)
    )

    // 离线录像与复盘仿真接口
    ipc.onCall(namespace, 'getSampleReplay', async () => {
      const session = this._replaySimulator.createSampleReplaySession()
      const result = this._replaySimulator.simulateSynchronous(session)
      const sidecar = this._replaySimulator.generateSidecar(session, result.cues)
      const markdown = this._replaySimulator.generateMarkdownReport(sidecar)
      return { session, sidecar, markdown, cues: result.cues }
    })

    ipc.onCall(namespace, 'simulateReplaySession', async (_e, session: CoachReplaySession) => {
      this._assertPrivacyConsent()
      const validatedSession = coachReplaySessionSchema.parse(session)
      const result = this._replaySimulator.simulateSynchronous(validatedSession)
      const sidecar = this._replaySimulator.generateSidecar(validatedSession, result.cues)
      const markdown = this._replaySimulator.generateMarkdownReport(sidecar)
      return { sidecar, markdown, cues: result.cues }
    })

    // 录像文件导入与处理
    ipc.onCall(namespace, 'selectReplayFile', async () => {
      this._assertPrivacyConsent()
      return this._replayImportController.selectReplayFile()
    })

    ipc.onCall(namespace, 'selectReplaySidecarFile', async () => {
      this._assertPrivacyConsent()
      return this._replayImportController.selectReplaySidecarFile()
    })

    ipc.onCall(namespace, 'listReplayAnalyses', async () => {
      return this._replayHistoryController.list()
    })

    ipc.onCall(namespace, 'getReplayAnalysis', async (_e, analysisId: string) => {
      const entry = this._replayHistoryController.get(analysisId)
      if (!entry) return null
      return { entry, result: await this._replayHistoryController.getResult(analysisId) }
    })

    ipc.onCall(namespace, 'deleteReplayAnalysis', async (_e, analysisId: string) => {
      if (
        this._replayImportController.activeTaskId === analysisId ||
        this._activeReplayHistoryId === analysisId
      ) {
        await this._cancelActiveReplayAnalysis(analysisId)
      }
      const current = this._replayHistoryController.get(analysisId)
      if (current && (current.status === 'preparing' || current.status === 'analyzing')) {
        await this._replayHistoryController.cancelTask(analysisId)
      }
      const result = await this._replayHistoryController.delete(analysisId)
      if (result.deleted) this._replayImportController.revokeAnalysisFileGrants(analysisId)
      return result
    })

    ipc.onCall(namespace, 'clearReplayAnalyses', async () => {
      await this._cancelActiveReplayAnalysis()
      this._replayImportController.revokeAllReplayFileGrants()
      return this._replayHistoryController.clear()
    })

    ipc.onCall(namespace, 'prepareVideoReplay', async (_e, rawParams: unknown) => {
      this._assertPrivacyConsent()
      if (this._activeReplayAnalysisOperation) {
        throw new AkariIpcError('已有录像分析任务正在运行', 'replay-busy')
      }
      const params = parseReplayIpcRequest(prepareVideoReplayRequestSchema, rawParams)
      let source: ResolvedReplayFileGrant | null = null
      let sidecar: ResolvedReplayFileGrant | null = null
      try {
        ;({ source, sidecar } = await this._resolveReplayFileGrants(params, ['video']))
        const preparation = await this._replayImportController.prepareVideoReplay(
          source.filePath,
          sidecar?.filePath
        )
        let sidecarGrant = sidecar ? toRendererFileGrant(sidecar) : null
        if (!sidecarGrant && preparation.sidecarPath) {
          sidecarGrant = await this._replayImportController.grantReplaySidecarFile(
            preparation.sidecarPath
          )
        }
        const { videoPath: _videoPath, sidecarPath: _sidecarPath, ...safePreparation } = preparation
        return {
          ...safePreparation,
          sourceGrant: toRendererFileGrant(source),
          sidecarGrant
        }
      } catch (error) {
        throw this._toPrivacySafeReplayError(
          error,
          [source?.filePath, sidecar?.filePath].filter((value): value is string => Boolean(value))
        )
      }
    })

    ipc.onCall(namespace, 'importVideoReplay', async (_e, rawParams: unknown) => {
      this._assertPrivacyConsent()
      const params = parseReplayIpcRequest(importVideoReplayRequestSchema, rawParams)
      return this._startTrackedReplayAnalysis(async () => {
        try {
          const files = await this._resolveReplayFileGrants(params, ['json', 'video'])
          return await this._runReplayAnalysis({
            ...files,
            roi: params.roi,
            metadata: params.metadata
          })
        } catch (error) {
          throw this._toPrivacySafeReplayError(error)
        }
      })
    })

    ipc.onCall(namespace, 'retryReplayAnalysis', async (_e, rawParams: unknown) => {
      this._assertPrivacyConsent()
      const params = parseReplayIpcRequest(retryReplayAnalysisRequestSchema, rawParams)
      const previous = this._replayHistoryController.get(params.analysisId)
      if (!previous) throw new AkariIpcError('要重试的复盘历史不存在', 'replay-history-missing')
      if (!['failed', 'cancelled', 'interrupted'].includes(previous.status)) {
        throw new AkariIpcError(
          '只有失败、取消或中断的复盘可以从头重试',
          'replay-invalid-retry-state'
        )
      }
      return this._startTrackedReplayAnalysis(async () => {
        try {
          const files = await this._resolveReplayFileGrants(params, [previous.sourceKind])
          return await this._runReplayAnalysis(
            {
              ...files,
              roi: previous.roi ?? undefined,
              metadata: previous.metadata
            },
            previous.id
          )
        } catch (error) {
          throw this._toPrivacySafeReplayError(error)
        }
      })
    })

    ipc.onCall(namespace, 'revokeReplayFileGrants', async (_e, rawParams: unknown) => {
      const params = revokeReplayFileGrantsRequestSchema.parse(rawParams)
      return { revoked: this._replayImportController.revokeReplayFileGrants(params.tokens) }
    })

    ipc.onCall(namespace, 'cancelReplayImport', async (_e, taskId?: string) => {
      return this._cancelActiveReplayAnalysis(taskId)
    })
  }

  private async _cancelActiveReplayAnalysis(taskId?: string) {
    const activeHistoryId = this._activeReplayHistoryId
    const matchesActiveTask =
      !taskId ||
      taskId === this._replayImportController.activeTaskId ||
      taskId === this._activeReplayHistoryId
    if (this._activeReplayAnalysisOperation && matchesActiveTask) {
      this._cancelReplayAnalysisRequested = true
    }
    const result = await this._replayImportController.cancelImport(taskId)
    if (!matchesActiveTask) return result
    await this._activeReplayAnalysisOperation?.catch(() => undefined)
    const activeId = result.taskId
    const entry = activeId ? this._replayHistoryController.get(activeId) : null
    if (entry && (entry.status === 'preparing' || entry.status === 'analyzing')) {
      await this._replayHistoryController.cancelTask(entry.id)
    }
    if (activeHistoryId) {
      this._replayImportController.revokeAnalysisFileGrants(activeHistoryId)
    }
    this._replayImportController.revokeUnassociatedReplayFileGrants()
    return result
  }

  public async withdrawPrivacyConsent(): Promise<void> {
    let firstPersistenceFailure: unknown = null
    const failClosedUpdates = [
      ['privacyConsentVersion', null],
      ['onboardingCompleted', false],
      ['enabled', false]
    ] as const

    // The notice version is the authoritative consent marker. Persist it first so a process exit
    // between later writes still restores without current consent. Continue after failures so the
    // remaining independent fail-closed markers still get a chance to reach storage.
    for (const [key, value] of failClosedUpdates) {
      try {
        await this._context.settingService.setAndPersist(key, value)
      } catch (error) {
        firstPersistenceFailure ??= error
      }
    }

    await this.handlePrivacyConsentWithdrawal()

    if (firstPersistenceFailure) {
      throw firstPersistenceFailure
    }
  }

  public handlePrivacyConsentWithdrawal(): Promise<void> {
    if (this._privacyConsentWithdrawalOperation) {
      return this._privacyConsentWithdrawalOperation
    }

    const operation = (async () => {
      this._replayImportController.revokeAllReplayFileGrants()
      await this._cancelActiveReplayAnalysis()
    })()
    this._privacyConsentWithdrawalOperation = operation

    return operation.finally(() => {
      if (this._privacyConsentWithdrawalOperation === operation) {
        this._privacyConsentWithdrawalOperation = null
      }
    })
  }

  public async dispose(): Promise<void> {
    await this.handlePrivacyConsentWithdrawal()
  }

  private async _resolveReplayFileGrants(
    params: { sourceToken: string; sidecarToken?: string },
    allowedSourceKinds: readonly ('json' | 'video')[]
  ): Promise<{
    source: ResolvedReplayFileGrant & { purpose: 'json' | 'video' }
    sidecar: ResolvedReplayFileGrant | null
  }> {
    const source = await this._replayImportController.resolveReplayFileGrant(
      params.sourceToken,
      allowedSourceKinds
    )
    const sidecar = params.sidecarToken
      ? await this._replayImportController.resolveReplayFileGrant(params.sidecarToken, ['sidecar'])
      : null
    if (source.purpose !== 'json' && source.purpose !== 'video') {
      throw new Error('所选源文件授权类型无效')
    }
    if (source.purpose === 'json' && sidecar) {
      throw new Error('JSON 回放不能同时附加 Sidecar')
    }
    return { source: { ...source, purpose: source.purpose }, sidecar }
  }

  private _startTrackedReplayAnalysis<T>(operation: () => Promise<T>): Promise<T> {
    if (this._activeReplayAnalysisOperation) {
      return Promise.reject(new AkariIpcError('已有录像分析任务正在运行', 'replay-busy'))
    }
    this._cancelReplayAnalysisRequested = false
    const running = Promise.resolve().then(operation)
    const tracked = running.finally(() => {
      if (this._activeReplayAnalysisOperation === tracked) {
        this._activeReplayAnalysisOperation = null
        this._activeReplayHistoryId = null
        this._cancelReplayAnalysisRequested = false
      }
    })
    this._activeReplayAnalysisOperation = tracked
    return tracked
  }

  private async _runReplayAnalysis(
    params: {
      source: ResolvedReplayFileGrant & { purpose: 'json' | 'video' }
      sidecar: ResolvedReplayFileGrant | null
      roi?: MinimapCalibration['roi']
      metadata?: CoachReplayImportMetadata
    },
    retryOf: string | null = null
  ) {
    const sourceKind = params.source.purpose
    const sourcePath = params.source.filePath
    const sidecarPath = params.sidecar?.filePath
    const grantTokens = [params.source.token, params.sidecar?.token].filter(
      (token): token is string => Boolean(token)
    )
    let historyId: string | null = null
    try {
      if (this._cancelReplayAnalysisRequested) throw new Error('任务已被用户取消')
      const identity = await this._replayImportController.createAnalysisIdentity(
        sourcePath,
        sidecarPath,
        params.metadata,
        params.roi
      )
      if (retryOf) {
        const previous = this._replayHistoryController.get(retryOf)
        if (
          !previous ||
          previous.artifactSha256 !== identity.artifactSha256 ||
          previous.sidecarSha256 !== identity.sidecarSha256
        ) {
          throw new Error('重新选择的录像或 Sidecar 与原任务不匹配')
        }
      }

      const fingerprint = createReplayAnalysisFingerprint({
        artifactSha256: identity.artifactSha256,
        sidecarSha256: identity.sidecarSha256,
        metadata: identity.metadata,
        roi: params.roi ?? null,
        manifest: identity.manifest
      })
      const started = await this._replayHistoryController.startTask({
        sourceKind,
        artifactSha256: identity.artifactSha256,
        sidecarSha256: identity.sidecarSha256,
        analysisFingerprint: fingerprint,
        metadata: identity.metadata,
        roi: params.roi ?? null,
        manifest: identity.manifest,
        retryOf
      })
      if (started.duplicate) {
        if (sourceKind === 'video') {
          this._replayImportController.associateReplayFileGrants(started.duplicate.id, [
            params.source.token
          ])
        }
        this._replayImportController.revokeReplayFileGrants(
          [sourceKind === 'json' ? params.source.token : null, params.sidecar?.token].filter(
            (token): token is string => Boolean(token)
          )
        )
        const stored = await this._replayHistoryController.getResult(started.duplicate.id)
        if (!stored) throw new Error('已有复盘记录的结果不可用')
        return { entry: started.duplicate, result: stored, duplicate: true }
      }

      historyId = started.entry.id
      this._replayImportController.associateReplayFileGrants(historyId, grantTokens)
      this._activeReplayHistoryId = historyId
      if (this._cancelReplayAnalysisRequested) throw new Error('任务已被用户取消')
      await this._replayHistoryController.updateProgress(historyId, {
        stage: 'analyzing',
        progress: 1
      })
      if (this._cancelReplayAnalysisRequested) throw new Error('任务已被用户取消')
      const runtimeResult = await this._replayImportController.importVideoReplay(
        sourcePath,
        sidecarPath,
        params.roi,
        identity.metadata,
        historyId
      )
      const runtimeMetadata = runtimeResult.session?.metadata ?? runtimeResult.session ?? {}
      const durationSeconds = Number(
        runtimeMetadata.durationSeconds ??
          runtimeResult.session?.durationSeconds ??
          runtimeResult.sidecar.gameDurationSeconds
      )
      const frameCount = Number(
        runtimeResult.session?.frameCount ?? runtimeResult.session?.frames?.length ?? 0
      )
      const analysisFps = Number(
        runtimeResult.session?.analysisFps ??
          (durationSeconds > 0 ? Math.max(0.001, frameCount / durationSeconds) : 1)
      )
      const capabilityStatus =
        runtimeResult.session?.capabilityStatus ??
        getReplayCapabilityStatus(
          identity.metadata,
          identity.sidecarSha256 !== null,
          identity.metadata.videoGameStartMs !== null
        )
      const projectedResult = projectReplayAnalysisResult({
        historyId,
        analysisFingerprint: fingerprint,
        summary: {
          sourceKind,
          artifactSha256: identity.artifactSha256,
          sidecarSha256: identity.sidecarSha256,
          metadata: identity.metadata,
          durationSeconds,
          frameCount,
          analysisFps,
          totalCues: runtimeResult.sidecar.totalCues,
          totalEvidences: runtimeResult.sidecar.evidencesSummary.totalEvidences
        },
        capabilityStatus,
        timeline: runtimeResult.sidecar.timeline.map((item) => ({
          gameTimeFormatted: item.gameTimeFormatted,
          category: item.category,
          observation: item.observation,
          spokenText: item.spokenText,
          options: item.options,
          evidenceIds: item.evidenceIds
        }))
      })
      const completed = await this._replayHistoryController.completeTask(historyId, projectedResult)
      this._replayImportController.revokeReplayFileGrants(
        [sourceKind === 'json' ? params.source.token : null, params.sidecar?.token].filter(
          (token): token is string => Boolean(token)
        )
      )
      await this._acceptanceController.recordOfflineSuccess({
        format: sourceKind,
        artifactSha256: identity.artifactSha256,
        patch: identity.metadata.patch,
        durationSeconds,
        frameCount,
        cueCount: runtimeResult.cues.length
      })
      return { entry: completed, result: projectedResult, duplicate: false }
    } catch (error) {
      const failureCode = classifyReplayFailure(error)
      if (historyId) {
        const entry = this._replayHistoryController.get(historyId)
        if (entry && (entry.status === 'preparing' || entry.status === 'analyzing')) {
          if (failureCode === 'user-cancelled') {
            await this._replayHistoryController.cancelTask(historyId)
          } else {
            await this._replayHistoryController.failTask(historyId, { failureCode })
          }
        }
      }
      await this._acceptanceController.recordOfflineFailure(sourceKind, failureCode)
      throw this._toPrivacySafeReplayError(
        error,
        [sourcePath, sidecarPath].filter(Boolean) as string[]
      )
    }
  }

  private _assertPrivacyConsent(): void {
    if (!hasCurrentLiveCoachPrivacyConsent(this._context.settings)) {
      throw new AkariIpcError(
        '请先完成实时教练本地处理与隐私说明确认',
        LIVE_COACH_CONSENT_REQUIRED_REASON
      )
    }
  }

  private _toPrivacySafeReplayError(
    error: unknown,
    sensitivePaths: readonly string[] = []
  ): AkariIpcError {
    if (error instanceof AkariIpcError) return error
    const safeError = createPrivacySafeReplayError(error, sensitivePaths)
    this._context.logger?.warn?.('Replay IPC operation failed', {
      failureCode: safeError.code
    })
    return safeError
  }
}

function classifyReplayFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes('取消') || message.includes('cancel')) return 'user-cancelled'
  if (
    message.includes('不存在') ||
    message.includes('not found') ||
    message.includes('授权已失效') ||
    message.includes('grant is unavailable')
  )
    return 'source-not-found'
  if (message.includes('sidecar') && message.includes('不匹配')) return 'sidecar-mismatch'
  if (message.includes('ffmpeg') || message.includes('ffprobe')) return 'decoder-error'
  if (message.includes('标定') || message.includes('roi')) return 'calibration-error'
  if (message.includes('上限') || message.includes('too large')) return 'size-limit'
  if (message.includes('history') && message.includes('limit')) return 'history-limit'
  return 'analysis-failed'
}

function toRendererFileGrant(grant: ResolvedReplayFileGrant): ReplaySelectedFileGrant {
  return {
    token: grant.token,
    displayName: grant.displayName,
    purpose: grant.purpose,
    expiresAt: grant.expiresAt
  }
}

function parseReplayIpcRequest<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value)
  } catch {
    throw new AkariIpcError('复盘请求参数无效', 'replay-invalid-request')
  }
}

function createPrivacySafeReplayError(
  error: unknown,
  _sensitivePaths: readonly string[] = []
): AkariIpcError {
  const failureCode = classifyReplayFailure(error)
  const messages: Record<string, string> = {
    'user-cancelled': '任务已被用户取消',
    'source-not-found': '所选本机文件已不可用，请重新选择',
    'sidecar-mismatch': 'Sidecar 与所选录像不匹配',
    'decoder-error': '录像解码失败，请检查文件格式或重新选择',
    'calibration-error': '录像标定参数无效',
    'size-limit': '所选文件超过复盘处理上限',
    'history-limit': '本机复盘历史已达上限',
    'analysis-failed': '复盘分析失败，请重试'
  }
  return new AkariIpcError(
    messages[failureCode] ?? messages['analysis-failed'],
    `replay-${failureCode}`
  )
}
