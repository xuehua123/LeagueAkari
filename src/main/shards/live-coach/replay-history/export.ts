import {
  type ReplayAnalysisHistoryEntry,
  type ReplayAnalysisStoredResult,
  replayAnalysisHistoryEntrySchema,
  replayAnalysisStoredResultSchema
} from '@shared/types/live-coach'
import { z } from 'zod'

export const replayAnalysisExportDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('league-akari-replay-analysis'),
    exportedAt: z.iso.datetime({ offset: true }),
    privacy: z
      .object({
        sourceMediaIncluded: z.literal(false),
        sourcePathIncluded: z.literal(false),
        sourceFileNameIncluded: z.literal(false),
        rawFramesIncluded: z.literal(false),
        rawSidecarPayloadIncluded: z.literal(false),
        previewImageIncluded: z.literal(false),
        evidenceIdsHashed: z.literal(true)
      })
      .strict(),
    history: replayAnalysisHistoryEntrySchema,
    result: replayAnalysisStoredResultSchema
  })
  .strict()
  .superRefine((document, context) => {
    if (
      document.history.id !== document.result.historyId ||
      document.history.analysisFingerprint !== document.result.analysisFingerprint ||
      document.history.resultId !== document.result.historyId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Exported replay result does not match its history entry'
      })
    }
  })

export type ReplayAnalysisExportDocument = z.infer<typeof replayAnalysisExportDocumentSchema>

export function createReplayAnalysisExportDocument(
  history: ReplayAnalysisHistoryEntry,
  result: ReplayAnalysisStoredResult,
  now: Date = new Date()
): ReplayAnalysisExportDocument {
  return replayAnalysisExportDocumentSchema.parse({
    schemaVersion: 1,
    type: 'league-akari-replay-analysis',
    exportedAt: now.toISOString(),
    privacy: {
      sourceMediaIncluded: false,
      sourcePathIncluded: false,
      sourceFileNameIncluded: false,
      rawFramesIncluded: false,
      rawSidecarPayloadIncluded: false,
      previewImageIncluded: false,
      evidenceIdsHashed: true
    },
    history,
    result
  })
}

export function createReplayAnalysisMarkdown(
  history: ReplayAnalysisHistoryEntry,
  result: ReplayAnalysisStoredResult
): string {
  const models = Object.entries(history.manifest.models)
    .map(
      ([name, model]) =>
        `${escapeMarkdown(name)} ${escapeMarkdown(model.version)} (${model.sha256 ?? 'hash unavailable'})`
    )
    .join('；')
  const disabledCapabilities = result.capabilityStatus.disabled
    .map(({ capability, reason }) => `${escapeMarkdown(capability)} (${escapeMarkdown(reason)})`)
    .join('；')
  const lines = [
    '# League Akari 离线复盘报告',
    '',
    `- 分析 ID：\`${result.historyId}\``,
    `- 游戏版本：\`${result.summary.metadata.patch ?? 'unknown'}\``,
    `- 录像时长：${Math.round(result.summary.durationSeconds)} 秒`,
    `- 分析帧数：${result.summary.frameCount}`,
    `- 分析帧率：${result.summary.analysisFps} FPS`,
    `- 拟提示数量：${result.summary.totalCues}`,
    `- 证据数量：${result.summary.totalEvidences}`,
    `- 分析管线版本：\`${escapeMarkdown(history.manifest.pipelineVersion)}\``,
    `- 规则目录版本：\`${escapeMarkdown(history.manifest.ruleCatalogVersion)}\``,
    `- FFmpeg 版本：\`${escapeMarkdown(history.manifest.ffmpegVersion ?? 'not-used')}\``,
    `- 运行时版本：\`${escapeMarkdown(history.manifest.runtimeVersion ?? 'unknown')}\``,
    `- 模型：${models || '无'}`,
    '- 隐私：不包含源录像、完整路径、文件名、预览图、原始帧或原始 Sidecar payload。',
    '',
    '## 能力诊断',
    '',
    `- 可用：${result.capabilityStatus.available.map(escapeMarkdown).join('、') || '无'}`,
    `- 已关闭：${disabledCapabilities || '无'}`,
    `- 缺失字段：${result.capabilityStatus.missingFields.map(escapeMarkdown).join('、') || '无'}`,
    '',
    '## 战术关键时刻',
    ''
  ]

  if (result.timeline.length === 0) {
    lines.push('本次分析未生成战术提示。', '')
  } else {
    for (const item of result.timeline) {
      lines.push(
        `### [${formatGameTime(item.gameTimeMs)}] ${escapeMarkdown(item.category)}`,
        '',
        escapeMarkdown(item.observation),
        '',
        `- 拟播提示：${escapeMarkdown(item.spokenText || '无')}`,
        `- 建议选项：${item.options.length ? item.options.map(escapeMarkdown).join(' / ') : '无'}`,
        `- 证据哈希：${item.evidenceHashes.length ? item.evidenceHashes.join(', ') : '无'}`,
        ''
      )
    }
  }

  return `${lines.join('\n')}\n`
}

function formatGameTime(gameTimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(gameTimeMs / 1_000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+.!|>-]/g, '\\$&').replace(/[\r\n]+/g, ' ')
}
