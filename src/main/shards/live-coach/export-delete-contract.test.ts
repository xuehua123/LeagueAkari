import { CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION } from '@shared/types/live-coach'
import { liveCoachAcceptanceReportSchema } from '@shared/types/live-coach'
import { dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { LiveCoachAcceptanceEvidenceController } from './acceptance-evidence-controller'
import { CueFeedbackController } from './cue-feedback-controller'
import { liveCoachDiagnosticsReportSchema } from './diagnostics-report'
import { LiveCoachIpcHandlers } from './ipc-handlers'
import { liveCoachLocalDataExportSchema } from './local-data-export'
import {
  ReplayHistoryController,
  createReplayAnalysisFingerprint,
  projectReplayAnalysisResult
} from './replay-history'
import { LiveCoachSettings, LiveCoachState } from './state'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.5.1'),
    getAppMetrics: vi.fn(() => [])
  },
  dialog: {
    showSaveDialog: vi.fn()
  }
}))

describe('LiveCoach export/delete persistence contract', () => {
  it('exports every deleted group, removes its storage, and remains empty after reload', async () => {
    vi.useFakeTimers()
    const temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'league-akari-live-coach-export-')
    )
    const configDirectory = path.join(temporaryDirectory, 'config')
    const replayDirectory = path.join(temporaryDirectory, 'replay-history')
    await fs.promises.mkdir(configDirectory, { recursive: true })

    const settings = new LiveCoachSettings()
    settings.enabled = true
    settings.onboardingCompleted = true
    settings.privacyConsentVersion = CURRENT_LIVE_COACH_PRIVACY_NOTICE_VERSION
    settings.manualCalibration = {
      schemaVersion: 1,
      id: 'calibration-1',
      fingerprintHash: 'fingerprint-hash',
      roi: { x: 0.7, y: 0.7, width: 0.2, height: 0.2 },
      transform: 'blue-normal',
      source: 'manual',
      confidence: 1,
      createdAt: 10
    }
    const state = createStateWithDeletableData()
    const settingService = createFileBackedSettingService(configDirectory, settings)
    const scheduler = {
      onCueAudit: null,
      getCue: vi.fn(() => ({
        id: 'cue-1',
        sessionId: 'session-1',
        ruleId: 'rule-1',
        ruleVersion: '1',
        evidenceIds: ['evidence-1']
      }))
    }
    const context: any = {
      namespace: 'live-coach-main',
      state,
      settings,
      settingService,
      logger: { warn: vi.fn() },
      mobxUtils: { reaction: vi.fn(() => () => undefined) },
      ipc: {
        onCall: vi.fn((_namespace, name, handler) => {
          calls[name] = handler
        })
      }
    }
    const calls: Record<string, (...args: any[]) => any> = {}
    const feedbackController = new CueFeedbackController(context, scheduler as any)
    const acceptanceController = new LiveCoachAcceptanceEvidenceController(
      context,
      scheduler as any
    )
    const replayHistoryController = new ReplayHistoryController({
      rootDirectory: replayDirectory
    })

    let reloadedAcceptanceController: LiveCoachAcceptanceEvidenceController | null = null
    let reloadedReplayHistoryController: ReplayHistoryController | null = null
    try {
      await feedbackController.init()
      await acceptanceController.init()
      await replayHistoryController.init()
      await feedbackController.submit({
        cueId: 'cue-1',
        type: 'useful',
        comment: 'user-owned feedback'
      })
      await acceptanceController.recordOfflineSuccess({
        format: 'video',
        artifactSha256: 'a'.repeat(64),
        patch: '16.17.1',
        durationSeconds: 60,
        frameCount: 300,
        cueCount: 1
      })
      await seedReplayHistory(replayHistoryController)

      const replayImportController = {
        activeTaskId: null,
        cancelImport: vi.fn(async () => ({ cancelled: false, taskId: null })),
        revokeAnalysisFileGrants: vi.fn(() => 0),
        revokeUnassociatedReplayFileGrants: vi.fn(() => 0),
        revokeAllReplayFileGrants: vi.fn(() => 0)
      }
      new LiveCoachIpcHandlers(
        context,
        { endSession: vi.fn() } as any,
        {} as any,
        scheduler as any,
        feedbackController,
        acceptanceController,
        {} as any,
        {} as any,
        replayImportController as any,
        replayHistoryController
      ).register()

      const localExportPath = path.join(temporaryDirectory, 'local-export.json')
      const diagnosticsExportPath = path.join(temporaryDirectory, 'diagnostics-export.json')
      const acceptanceExportPath = path.join(temporaryDirectory, 'acceptance-export.json')
      vi.mocked(dialog.showSaveDialog)
        .mockResolvedValueOnce({ canceled: false, filePath: localExportPath } as any)
        .mockResolvedValueOnce({ canceled: false, filePath: diagnosticsExportPath } as any)
        .mockResolvedValueOnce({ canceled: false, filePath: acceptanceExportPath } as any)

      await calls.exportLocalCoachData({} as any)
      await calls.exportDiagnosticsReport({} as any)
      await calls.exportAcceptanceReport({} as any)

      const localDocument = liveCoachLocalDataExportSchema.parse(
        JSON.parse(await fs.promises.readFile(localExportPath, 'utf8'))
      )
      const diagnosticsDocument = liveCoachDiagnosticsReportSchema.parse(
        JSON.parse(await fs.promises.readFile(diagnosticsExportPath, 'utf8'))
      )
      const acceptanceDocument = liveCoachAcceptanceReportSchema.parse(
        JSON.parse(await fs.promises.readFile(acceptanceExportPath, 'utf8'))
      )

      expect(Object.keys(localDocument)).toEqual(
        expect.arrayContaining([
          'session',
          'cue',
          'recentCues',
          'sessionCueStats',
          'lastSessionSummary',
          'fogInferences',
          'itemGuidance',
          'cooldowns',
          'communicationHistory',
          'conversation',
          'lastError',
          'feedback',
          'manualCalibration',
          'acceptance',
          'replayHistory',
          'replayResults'
        ])
      )
      expect(localDocument.feedback).toHaveLength(1)
      expect(localDocument.acceptance.offlineRecords).toHaveLength(1)
      expect(localDocument.replayHistory).toHaveLength(1)
      expect(localDocument.replayResults).toHaveLength(1)
      expect(diagnosticsDocument.privacy).toMatchObject({
        rawFramesIncluded: false,
        gameVideoIncluded: false,
        microphoneAudioIncluded: false,
        fullPathsIncluded: false
      })
      expect(acceptanceDocument.offlineRecords).toHaveLength(1)
      for (const document of [localDocument, diagnosticsDocument, acceptanceDocument]) {
        const serialized = JSON.stringify(document)
        expect(serialized).not.toContain('private-frame-payload')
        expect(serialized).not.toContain('private-audio-payload')
        expect(serialized).not.toContain('private-video-payload')
        expect(serialized).not.toContain('C:\\\\Users\\\\private\\\\match.mp4')
      }

      const deleted = await calls.deleteLocalCoachData({} as any)
      expect(deleted).toMatchObject({
        deletedFeedbackCount: 1,
        deletedAcceptance: { sessions: 0, offlineRecords: 1 },
        deletedReplayHistory: { deletedEntries: 1 }
      })
      expect(state.cue).toBeNull()
      expect(state.recentCues).toEqual([])
      expect(state.cooldowns).toEqual([])
      expect(state.communicationHistory).toEqual([])
      expect(state.lastSessionSummary).toBeNull()
      expect(state.lastError).toBeNull()
      expect(settings.manualCalibration).toBeNull()
      expect(feedbackController.list()).toEqual([])
      expect(acceptanceController.getReport([]).offlineRecords).toEqual([])
      expect(replayHistoryController.list()).toEqual([])
      await expect(fileExists(path.join(configDirectory, 'cue-feedback.json'))).resolves.toBe(false)
      await expect(
        fileExists(path.join(configDirectory, 'live-coach-acceptance.json'))
      ).resolves.toBe(false)
      await expect(fs.promises.readdir(path.join(replayDirectory, 'results'))).resolves.toEqual([])

      await acceptanceController.dispose()
      await replayHistoryController.dispose()

      const reloadedFeedbackController = new CueFeedbackController(context, scheduler as any)
      reloadedAcceptanceController = new LiveCoachAcceptanceEvidenceController(
        context,
        scheduler as any
      )
      reloadedReplayHistoryController = new ReplayHistoryController({
        rootDirectory: replayDirectory
      })
      await reloadedFeedbackController.init()
      await reloadedAcceptanceController.init()
      await reloadedReplayHistoryController.init()

      expect(reloadedFeedbackController.list()).toEqual([])
      expect(reloadedAcceptanceController.getReport([])).toMatchObject({
        sessions: [],
        offlineRecords: []
      })
      expect(reloadedReplayHistoryController.list()).toEqual([])
    } finally {
      await reloadedAcceptanceController?.dispose()
      await reloadedReplayHistoryController?.dispose()
      await acceptanceController.dispose()
      await replayHistoryController.dispose()
      await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
      vi.useRealTimers()
      vi.mocked(dialog.showSaveDialog).mockReset()
    }
  })
})

function createStateWithDeletableData(): LiveCoachState {
  const state = new LiveCoachState()
  const cue = {
    id: 'cue-1',
    sessionId: 'session-1',
    category: 'warning' as const,
    priority: 80,
    observationText: 'River pressure',
    impactText: null,
    options: [{ id: 'retreat', label: 'Retreat', role: 'primary' as const }],
    spokenText: 'Back away',
    createdAt: 2,
    expiresAt: 10,
    status: 'spoken' as const,
    cancellationReason: null
  }
  state.setCue(cue)
  state.addRecentCue(cue)
  state.setCooldowns([
    {
      id: 'cooldown-1',
      sessionId: 'session-1',
      kind: 'ultimate',
      label: 'Ultimate',
      ownerTeam: 'enemy',
      championId: 1,
      source: 'visible-screen',
      confidence: 0.9,
      observedAt: 2,
      earliestReadyAt: 50,
      latestReadyAt: 60,
      status: 'running',
      evidenceIds: ['evidence-1']
    }
  ])
  state.addCommunicationAudit({
    id: 'communication-1',
    sessionId: 'session-1',
    cueId: 'cue-1',
    optionId: 'retreat',
    kind: 'retreat',
    action: 'copied',
    channel: 'chat',
    message: 'Back away',
    reason: null,
    createdAt: 2
  })
  state.lastSessionSummary = {
    sessionId: 'session-0',
    mapId: 11,
    queueId: 420,
    patch: '16.17.1',
    startedAt: 1,
    endedAt: 11,
    durationSeconds: 10,
    endReason: 'completed',
    totalCues: 1,
    cueCounts: { information: 0, warning: 1, opportunity: 0, system: 0, review: 0 }
  }
  state.setLastError({
    code: 'capture-stalled',
    stage: 'capture',
    recoverable: true,
    occurredAt: 3,
    details: 'C:\\Users\\private\\match.mp4'
  })
  ;(state as any).rawFrames = ['private-frame-payload']
  ;(state as any).microphoneAudio = 'private-audio-payload'
  ;(state as any).gameVideo = 'private-video-payload'
  return state
}

async function seedReplayHistory(controller: ReplayHistoryController): Promise<void> {
  const metadata = {
    patch: '16.17.1',
    mapId: 11,
    queueId: 420,
    selfTeam: 'blue' as const,
    selfChampionId: 266,
    minimapSide: 'right' as const,
    videoGameStartMs: 0,
    roster: null
  }
  const manifest = {
    pipelineVersion: 'replay-analysis-v1',
    ruleCatalogVersion: '16.17.1',
    ffmpegVersion: null,
    runtimeVersion: '1.5.1',
    models: {}
  }
  const identity = {
    artifactSha256: 'b'.repeat(64),
    sidecarSha256: null,
    metadata,
    roi: { x: 0.8, y: 0.7, width: 0.2, height: 0.3 },
    manifest
  }
  const analysisFingerprint = createReplayAnalysisFingerprint(identity)
  const started = await controller.startTask({
    ...identity,
    sourceKind: 'video',
    analysisFingerprint
  })
  const result = projectReplayAnalysisResult({
    historyId: started.entry.id,
    analysisFingerprint,
    generatedAt: new Date(100).toISOString(),
    summary: {
      sourceKind: 'video',
      artifactSha256: identity.artifactSha256,
      sidecarSha256: null,
      metadata,
      durationSeconds: 60,
      frameCount: 300,
      analysisFps: 5,
      totalCues: 1,
      totalEvidences: 1
    },
    capabilityStatus: { available: ['minimap-basic'], disabled: [], missingFields: [] },
    timeline: []
  })
  await controller.completeTask(started.entry.id, result)
}

function createFileBackedSettingService(rootDirectory: string, settings: LiveCoachSettings) {
  const configPath = (filename: string) => {
    if (path.basename(filename) !== filename) throw new Error('invalid config filename')
    return path.join(rootDirectory, filename)
  }
  return {
    jsonConfigFileExists: async (filename: string) => await fileExists(configPath(filename)),
    readFromJsonConfigFile: async (filename: string) =>
      JSON.parse(await fs.promises.readFile(configPath(filename), 'utf8')),
    writeToJsonConfigFile: async (filename: string, document: unknown) => {
      await fs.promises.writeFile(configPath(filename), JSON.stringify(document), 'utf8')
    },
    deleteJsonConfigFile: async (filename: string) => {
      await fs.promises.rm(configPath(filename), { force: true })
    },
    set: vi.fn(async (key: keyof LiveCoachSettings, value: unknown) => {
      Reflect.set(settings, key, value)
    })
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
