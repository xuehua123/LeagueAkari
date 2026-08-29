import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { OFFICIAL_CHAMPION_CATALOG_16_16_1 } from '../live-coach/catalog/champions-16-16-1'
import {
  createChampionIdentityModelRoots,
  resolveChampionIdentityModelFromRoots
} from './champion-identity-model'

const modelRoot = path.resolve(process.cwd(), 'resources/live-coach/models')

describe('champion identity model registration', () => {
  it('keeps the bootstrap ONNX model closed for release but resolves it for runtime smoke tests', () => {
    expect(resolveChampionIdentityModelFromRoots('16.16.1', [modelRoot])).toBeNull()

    const descriptor = resolveChampionIdentityModelFromRoots('16.16.1', [modelRoot], {
      validationMode: 'bootstrap-smoke'
    })
    expect(descriptor).not.toBeNull()
    const contents = fs.readFileSync(descriptor!.path)
    expect(createHash('sha256').update(contents).digest('hex')).toBe(descriptor!.sha256)
    expect(descriptor).toMatchObject({
      modelName: 'champion-icon-onnx-bootstrap',
      architecture: 'bootstrap-linear',
      format: 'onnx',
      opset: 17,
      inputShape: [1, 3, 12, 12],
      preprocessing: 'per-channel-standardize-l2',
      outputLayout: 'prototype-scores',
      variantsPerChampion: 3
    })
    expect(descriptor!.championIds.map(String).sort()).toEqual(
      Object.keys(OFFICIAL_CHAMPION_CATALOG_16_16_1).sort()
    )
    expect(
      resolveChampionIdentityModelFromRoots('16.16.1', [modelRoot], {
        validationMode: 'typo' as any
      })
    ).toBeNull()
  })

  it('fails closed for an unsupported patch or a path-traversal manifest entry', () => {
    expect(resolveChampionIdentityModelFromRoots('unsupported', [modelRoot])).toBeNull()

    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-model-root-'))
    try {
      fs.writeFileSync(
        path.join(temporaryDirectory, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 2,
          models: {
            '16.16.1': {
              modelName: 'champion-icon-onnx-bootstrap',
              architecture: 'bootstrap-linear',
              format: 'onnx',
              version: 'test',
              sha256: 'a'.repeat(64),
              file: '../outside.onnx',
              workerProtocolVersion: '1.0.0',
              license: {
                status: 'approved',
                identifier: 'MIT',
                noticeFile: 'LICENSE.txt',
                noticeSha256: 'd'.repeat(64)
              },
              opset: 17,
              inputName: 'input',
              outputName: 'output',
              inputShape: [1, 3, 12, 12],
              preprocessing: 'per-channel-standardize-l2',
              outputLayout: 'prototype-scores',
              cropRatios: [0],
              championIds: [1],
              variantsPerChampion: 1,
              confidenceThreshold: 0.75,
              top2MarginThreshold: 0.15,
              dataset: { kind: 'real-minimap-roi', sha256: 'b'.repeat(64), sampleCount: 1 },
              validation: {
                status: 'accepted',
                reportFile: 'report.json',
                reportSha256: 'c'.repeat(64),
                releaseEligible: true
              }
            }
          }
        })
      )
      expect(
        resolveChampionIdentityModelFromRoots('16.16.1', [temporaryDirectory], {
          validationMode: 'bootstrap-smoke'
        })
      ).toBeNull()
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('rejects a model and external manifest that were altered together', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-model-co-tamper-'))
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(modelRoot, 'manifest.json'), 'utf8'))
      const entry = manifest.models['16.16.1']
      fs.copyFileSync(path.join(modelRoot, entry.file), path.join(temporaryDirectory, entry.file))
      fs.writeFileSync(path.join(temporaryDirectory, 'manifest.json'), JSON.stringify(manifest))
      expect(
        resolveChampionIdentityModelFromRoots('16.16.1', [temporaryDirectory], {
          validationMode: 'bootstrap-smoke'
        })
      ).not.toBeNull()

      const replacement = Buffer.from('self-consistent but untrusted replacement model')
      fs.writeFileSync(path.join(temporaryDirectory, entry.file), replacement)
      entry.sha256 = createHash('sha256').update(replacement).digest('hex')
      fs.writeFileSync(path.join(temporaryDirectory, 'manifest.json'), JSON.stringify(manifest))

      expect(
        resolveChampionIdentityModelFromRoots('16.16.1', [temporaryDirectory], {
          validationMode: 'bootstrap-smoke'
        })
      ).toBeNull()
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('requires a hash-locked real-ROI validation report and the full phase-one matrix', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-validated-model-'))
    try {
      const modelFile = 'identity.onnx'
      const reportFile = 'identity-validation.json'
      const licenseFile = 'identity-LICENSE.txt'
      fs.writeFileSync(path.join(temporaryDirectory, modelFile), Buffer.from('test-onnx-model'))
      fs.writeFileSync(path.join(temporaryDirectory, licenseFile), 'Approved test model license\n')
      const modelSha256 = createHash('sha256')
        .update(fs.readFileSync(path.join(temporaryDirectory, modelFile)))
        .digest('hex')
      const licenseSha256 = createHash('sha256')
        .update(fs.readFileSync(path.join(temporaryDirectory, licenseFile)))
        .digest('hex')
      const report = {
        schemaVersion: 1,
        decision: 'accepted',
        evaluatedAt: '2026-08-27T00:00:00.000Z',
        model: {
          modelName: 'champion-icon-mobilenetv3-small',
          version: '16.16.1-mobilenetv3-small.1',
          sha256: modelSha256
        },
        dataset: {
          kind: 'real-minimap-roi',
          sha256: 'b'.repeat(64),
          sampleCount: 20,
          distinctMatches: 10,
          classCount: 1
        },
        metrics: {
          top1Accuracy: 0.96,
          macroF1: 0.95,
          minimumClassRecall: 0.9,
          unknownFalseAcceptRate: 0.005
        },
        datasetGates: {
          passed: true,
          checks: { testResolutionsCovered: true }
        },
        coverage: {
          patches: ['16.16.1'],
          resolutions: ['1920x1080', '2560x1440'],
          minimapSides: ['left', 'right'],
          uiScales: [1, 1.25, 1.5]
        }
      }
      const writeManifest = () => {
        fs.writeFileSync(path.join(temporaryDirectory, reportFile), JSON.stringify(report))
        const reportSha256 = createHash('sha256')
          .update(fs.readFileSync(path.join(temporaryDirectory, reportFile)))
          .digest('hex')
        const manifest = {
          schemaVersion: 2,
          releasePatch: '16.16.1',
          models: {
            '16.16.1': {
              modelName: 'champion-icon-mobilenetv3-small',
              architecture: 'mobilenet-v3-small',
              format: 'onnx',
              version: '16.16.1-mobilenetv3-small.1',
              sha256: modelSha256,
              file: modelFile,
              workerProtocolVersion: '1.0.0',
              license: {
                status: 'approved',
                identifier: 'LicenseRef-Test-Approved',
                noticeFile: licenseFile,
                noticeSha256: licenseSha256
              },
              opset: 17,
              inputName: 'input',
              outputName: 'logits',
              inputShape: [1, 3, 64, 64],
              preprocessing: 'imagenet',
              outputLayout: 'champion-logits',
              cropRatios: [0, 0.08, 0.14],
              championIds: [1],
              variantsPerChampion: 1,
              confidenceThreshold: 0.75,
              top2MarginThreshold: 0.15,
              dataset: {
                kind: 'real-minimap-roi',
                sha256: 'b'.repeat(64),
                sampleCount: 20
              },
              validation: {
                status: 'accepted',
                reportFile,
                reportSha256,
                releaseEligible: true
              }
            }
          }
        }
        fs.writeFileSync(path.join(temporaryDirectory, 'manifest.json'), JSON.stringify(manifest))
        return manifest
      }

      let trustedManifest = writeManifest()
      expect(
        resolveChampionIdentityModelFromRoots('16.16.1', [temporaryDirectory], {
          trustedManifest
        })
      ).toMatchObject({
        modelName: 'champion-icon-mobilenetv3-small',
        outputLayout: 'champion-logits'
      })
      expect(
        resolveChampionIdentityModelFromRoots('16.16.1', [temporaryDirectory], {
          validationMode: 'bootstrap-smoke',
          trustedManifest
        })
      ).toBeNull()

      report.metrics.top1Accuracy = 0.94
      trustedManifest = writeManifest()
      expect(
        resolveChampionIdentityModelFromRoots('16.16.1', [temporaryDirectory], {
          trustedManifest
        })
      ).toBeNull()

      report.metrics.top1Accuracy = 0.96
      trustedManifest = writeManifest()
      fs.writeFileSync(path.join(temporaryDirectory, licenseFile), 'tampered license\n')
      expect(
        resolveChampionIdentityModelFromRoots('16.16.1', [temporaryDirectory], {
          trustedManifest
        })
      ).toBeNull()

      fs.writeFileSync(path.join(temporaryDirectory, licenseFile), 'Approved test model license\n')
      writeManifest()
      const deceptiveLicenseManifest = JSON.parse(
        fs.readFileSync(path.join(temporaryDirectory, 'manifest.json'), 'utf8')
      )
      const deceptiveLicenseEntry = deceptiveLicenseManifest.models['16.16.1']
      deceptiveLicenseEntry.license.noticeFile = reportFile
      deceptiveLicenseEntry.license.noticeSha256 = deceptiveLicenseEntry.validation.reportSha256
      fs.writeFileSync(
        path.join(temporaryDirectory, 'manifest.json'),
        JSON.stringify(deceptiveLicenseManifest)
      )
      expect(
        resolveChampionIdentityModelFromRoots('16.16.1', [temporaryDirectory], {
          trustedManifest: deceptiveLicenseManifest
        })
      ).toBeNull()

      writeManifest()
      report.model.modelName = 'champion-icon-onnx-bootstrap'
      fs.writeFileSync(path.join(temporaryDirectory, reportFile), JSON.stringify(report))
      const bootstrapManifest = JSON.parse(
        fs.readFileSync(path.join(temporaryDirectory, 'manifest.json'), 'utf8')
      )
      const bootstrapEntry = bootstrapManifest.models['16.16.1']
      bootstrapEntry.modelName = 'champion-icon-onnx-bootstrap'
      bootstrapEntry.architecture = 'bootstrap-linear'
      bootstrapEntry.preprocessing = 'per-channel-standardize-l2'
      bootstrapEntry.outputLayout = 'prototype-scores'
      bootstrapEntry.variantsPerChampion = bootstrapEntry.cropRatios.length
      bootstrapEntry.validation.reportSha256 = createHash('sha256')
        .update(fs.readFileSync(path.join(temporaryDirectory, reportFile)))
        .digest('hex')
      fs.writeFileSync(
        path.join(temporaryDirectory, 'manifest.json'),
        JSON.stringify(bootstrapManifest)
      )
      expect(
        resolveChampionIdentityModelFromRoots('16.16.1', [temporaryDirectory], {
          trustedManifest: bootstrapManifest
        })
      ).toBeNull()
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('covers development and packaged resource layouts', () => {
    expect(createChampionIdentityModelRoots('C:/app', 'C:/resources')).toEqual([
      path.join('C:/app', 'resources/live-coach/models'),
      path.join('C:/resources', 'app.asar.unpacked/resources/live-coach/models'),
      path.join('C:/resources', 'app.asar/resources/live-coach/models'),
      path.join('C:/resources', 'resources/live-coach/models')
    ])
  })
})
