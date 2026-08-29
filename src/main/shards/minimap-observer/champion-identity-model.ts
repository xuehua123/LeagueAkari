import type { ChampionIdentityModelRuntimeDescriptor } from '@shared/types/live-coach'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

import trustedModelManifestJson from '../../../../resources/live-coach/models/manifest.json'

export type ChampionIdentityModelDescriptor = ChampionIdentityModelRuntimeDescriptor

interface ModelManifestEntry extends Omit<ChampionIdentityModelRuntimeDescriptor, 'path'> {
  file: string
  workerProtocolVersion: '1.0.0'
  license: {
    status: 'unreviewed' | 'approved'
    identifier: string | null
    noticeFile: string | null
    noticeSha256: string | null
  }
  dataset: {
    kind: string
    sha256: string
    sampleCount: number
  }
  validation: {
    status: 'unvalidated' | 'accepted' | 'rejected'
    reportFile?: string | null
    reportSha256: string | null
    releaseEligible: boolean
  }
}

interface ModelManifest {
  schemaVersion: number
  models: Record<string, ModelManifestEntry>
}

const championIdentityValidationReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    decision: z.literal('accepted'),
    evaluatedAt: z.iso.datetime({ offset: true }),
    model: z
      .object({
        modelName: z.string().min(1),
        version: z.string().min(1),
        sha256: z.string().regex(/^[a-f\d]{64}$/i)
      })
      .strict(),
    dataset: z
      .object({
        kind: z.literal('real-minimap-roi'),
        sha256: z.string().regex(/^[a-f\d]{64}$/i),
        sampleCount: z.number().int().positive(),
        distinctMatches: z.number().int().positive(),
        classCount: z.number().int().positive()
      })
      .strict(),
    metrics: z
      .object({
        top1Accuracy: z.number().min(0).max(1),
        macroF1: z.number().min(0).max(1),
        minimumClassRecall: z.number().min(0).max(1),
        unknownFalseAcceptRate: z.number().min(0).max(1)
      })
      .strict(),
    datasetGates: z.unknown().optional(),
    coverage: z
      .object({
        patches: z.array(z.string().min(1)).min(1),
        resolutions: z.array(z.string().regex(/^\d+x\d+$/)).min(1),
        minimapSides: z.array(z.enum(['left', 'right'])).min(1),
        uiScales: z.array(z.number().positive()).min(1)
      })
      .strict(),
    training: z
      .object({
        architecture: z.literal('mobilenet-v3-small'),
        seed: z.number().int(),
        epochs: z.number().int().positive(),
        inputSize: z.number().int().min(8).max(256),
        torchVersion: z.string().min(1)
      })
      .strict()
      .optional()
  })
  .strict()

export interface ChampionIdentityModelResolveOptions {
  validationMode?: 'release' | 'bootstrap-smoke'
  /** Test-only trust-anchor injection. Production callers use the manifest bundled in app code. */
  trustedManifest?: unknown
}

function isSafeFileName(file: string): boolean {
  return file.length > 0 && file === path.basename(file)
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function isUnique<T>(values: T[]): boolean {
  return new Set(values).size === values.length
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hasValidModelProfile(entry: ModelManifestEntry): boolean {
  if (entry.modelName === 'champion-icon-onnx-bootstrap') {
    return (
      entry.architecture === 'bootstrap-linear' &&
      entry.preprocessing === 'per-channel-standardize-l2' &&
      entry.outputLayout === 'prototype-scores' &&
      entry.variantsPerChampion === entry.cropRatios.length
    )
  }
  if (entry.modelName === 'champion-icon-mobilenetv3-small') {
    return (
      entry.architecture === 'mobilenet-v3-small' &&
      entry.preprocessing === 'imagenet' &&
      entry.outputLayout === 'champion-logits' &&
      entry.variantsPerChampion === 1
    )
  }
  return false
}

function hasValidLicenseContract(entry: ModelManifestEntry): boolean {
  if (!entry.license || !['unreviewed', 'approved'].includes(entry.license.status)) return false
  if (entry.license.status === 'unreviewed') {
    return (
      entry.license.identifier === null &&
      entry.license.noticeFile === null &&
      entry.license.noticeSha256 === null
    )
  }
  return Boolean(
    typeof entry.license.identifier === 'string' &&
    entry.license.identifier.trim() &&
    typeof entry.license.noticeFile === 'string' &&
    isSafeFileName(entry.license.noticeFile) &&
    /\.(?:md|txt)$/i.test(entry.license.noticeFile) &&
    entry.license.noticeFile !== entry.file &&
    typeof entry.license.noticeSha256 === 'string' &&
    /^[a-f\d]{64}$/i.test(entry.license.noticeSha256)
  )
}

function isValidEntry(entry: ModelManifestEntry | undefined): entry is ModelManifestEntry {
  return Boolean(
    entry &&
    hasValidModelProfile(entry) &&
    entry.workerProtocolVersion === '1.0.0' &&
    hasValidLicenseContract(entry) &&
    entry.format === 'onnx' &&
    entry.opset === 17 &&
    entry.version &&
    /^[a-f\d]{64}$/i.test(entry.sha256) &&
    isSafeFileName(entry.file) &&
    entry.inputName &&
    entry.outputName &&
    Array.isArray(entry.inputShape) &&
    entry.inputShape.length === 4 &&
    entry.inputShape[0] === 1 &&
    entry.inputShape[1] === 3 &&
    Number.isInteger(entry.inputShape[2]) &&
    entry.inputShape[2] >= 8 &&
    entry.inputShape[2] === entry.inputShape[3] &&
    Array.isArray(entry.cropRatios) &&
    entry.cropRatios.length > 0 &&
    entry.cropRatios.every((value) => Number.isFinite(value) && value >= 0 && value <= 0.4) &&
    Array.isArray(entry.championIds) &&
    entry.championIds.length > 0 &&
    entry.championIds.every((value) => Number.isInteger(value) && value > 0) &&
    isUnique(entry.championIds) &&
    Number.isInteger(entry.variantsPerChampion) &&
    entry.variantsPerChampion > 0 &&
    Number.isFinite(entry.confidenceThreshold) &&
    entry.confidenceThreshold >= 0 &&
    entry.confidenceThreshold <= 1 &&
    Number.isFinite(entry.top2MarginThreshold) &&
    entry.top2MarginThreshold >= 0 &&
    entry.top2MarginThreshold <= 1 &&
    entry.dataset &&
    typeof entry.dataset.kind === 'string' &&
    /^[a-f\d]{64}$/i.test(entry.dataset.sha256) &&
    Number.isInteger(entry.dataset.sampleCount) &&
    entry.dataset.sampleCount > 0 &&
    entry.validation &&
    ['unvalidated', 'accepted', 'rejected'].includes(entry.validation.status) &&
    typeof entry.validation.releaseEligible === 'boolean'
  )
}

function hasAcceptedValidation(root: string, patch: string, entry: ModelManifestEntry): boolean {
  if (
    entry.validation.status !== 'accepted' ||
    !entry.validation.releaseEligible ||
    !entry.validation.reportFile ||
    !isSafeFileName(entry.validation.reportFile) ||
    !entry.validation.reportFile.toLowerCase().endsWith('.json') ||
    entry.validation.reportFile === entry.file ||
    entry.validation.reportFile === entry.license.noticeFile ||
    !entry.validation.reportSha256 ||
    !/^[a-f\d]{64}$/i.test(entry.validation.reportSha256) ||
    entry.license.status !== 'approved' ||
    entry.dataset.kind !== 'real-minimap-roi'
  ) {
    return false
  }

  const reportPath = path.join(root, entry.validation.reportFile)
  const noticePath = path.join(root, entry.license.noticeFile!)
  if (
    !fs.existsSync(reportPath) ||
    !fs.lstatSync(reportPath).isFile() ||
    sha256File(reportPath).toLowerCase() !== entry.validation.reportSha256.toLowerCase() ||
    !fs.existsSync(noticePath) ||
    !fs.lstatSync(noticePath).isFile() ||
    sha256File(noticePath).toLowerCase() !== entry.license.noticeSha256!.toLowerCase()
  ) {
    return false
  }

  try {
    const report = championIdentityValidationReportSchema.parse(
      JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    )
    return (
      report.model.modelName === entry.modelName &&
      report.model.version === entry.version &&
      report.model.sha256.toLowerCase() === entry.sha256.toLowerCase() &&
      report.dataset.kind === entry.dataset.kind &&
      report.dataset.sha256.toLowerCase() === entry.dataset.sha256.toLowerCase() &&
      report.dataset.sampleCount === entry.dataset.sampleCount &&
      report.dataset.sampleCount >= entry.championIds.length * 20 &&
      report.dataset.distinctMatches >= 10 &&
      report.dataset.classCount === entry.championIds.length &&
      report.metrics.top1Accuracy >= 0.95 &&
      report.metrics.macroF1 >= 0.93 &&
      report.metrics.minimumClassRecall >= 0.8 &&
      report.metrics.unknownFalseAcceptRate <= 0.01 &&
      report.coverage.patches.includes(patch) &&
      report.coverage.resolutions.includes('1920x1080') &&
      report.coverage.resolutions.includes('2560x1440') &&
      report.coverage.minimapSides.includes('left') &&
      report.coverage.minimapSides.includes('right') &&
      [1, 1.25, 1.5].every((scale) => report.coverage.uiScales.includes(scale))
    )
  } catch {
    return false
  }
}

export function resolveChampionIdentityModelFromRoots(
  patch: string,
  roots: string[],
  options: ChampionIdentityModelResolveOptions = {}
): ChampionIdentityModelDescriptor | null {
  const validationMode = options.validationMode ?? 'release'
  if (validationMode !== 'release' && validationMode !== 'bootstrap-smoke') return null
  const trustedManifestFingerprint = createHash('sha256')
    .update(canonicalJson(options.trustedManifest ?? trustedModelManifestJson))
    .digest('hex')

  for (const root of roots) {
    const manifestPath = path.join(root, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ModelManifest
      const manifestFingerprint = createHash('sha256').update(canonicalJson(manifest)).digest('hex')
      if (manifestFingerprint !== trustedManifestFingerprint) continue
      const entry = manifest.schemaVersion === 2 ? manifest.models?.[patch] : undefined
      if (!isValidEntry(entry)) continue
      const isBootstrap = entry.modelName === 'champion-icon-onnx-bootstrap'
      if (validationMode === 'bootstrap-smoke' && !isBootstrap) continue
      if (
        validationMode === 'release' &&
        (isBootstrap || !hasAcceptedValidation(root, patch, entry))
      ) {
        continue
      }

      const modelPath = path.join(root, entry.file)
      if (!fs.existsSync(modelPath) || !fs.lstatSync(modelPath).isFile()) continue
      if (sha256File(modelPath).toLowerCase() !== entry.sha256.toLowerCase()) continue

      return {
        modelName: entry.modelName,
        architecture: entry.architecture,
        format: entry.format,
        version: entry.version,
        sha256: entry.sha256,
        path: modelPath,
        opset: entry.opset,
        inputName: entry.inputName,
        outputName: entry.outputName,
        inputShape: entry.inputShape,
        preprocessing: entry.preprocessing,
        outputLayout: entry.outputLayout,
        cropRatios: [...entry.cropRatios],
        championIds: [...entry.championIds],
        variantsPerChampion: entry.variantsPerChampion,
        confidenceThreshold: entry.confidenceThreshold,
        top2MarginThreshold: entry.top2MarginThreshold
      }
    } catch {
      // Try the next packaged/development root. A corrupt manifest never enables the capability.
    }
  }
  return null
}

export function createChampionIdentityModelRoots(appPath: string, resourcesPath: string): string[] {
  return [
    path.join(appPath, 'resources/live-coach/models'),
    path.join(resourcesPath, 'app.asar.unpacked/resources/live-coach/models'),
    path.join(resourcesPath, 'app.asar/resources/live-coach/models'),
    path.join(resourcesPath, 'resources/live-coach/models')
  ]
}
