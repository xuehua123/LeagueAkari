import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveChampionIdentityModelFromRoots } from '../../shards/minimap-observer/champion-identity-model'
import { ChampionOnnxClassifier } from './champion-onnx-classifier'

const modelRoot = path.resolve(process.cwd(), 'resources/live-coach/models')
const legacyBootstrapSource = path.join(modelRoot, 'champion-icons-16-16-1.json')
const classifiers: ChampionOnnxClassifier[] = []

afterEach(async () => {
  await Promise.all(classifiers.splice(0).map((classifier) => classifier.dispose()))
})

function getBootstrapDescriptor() {
  const descriptor = resolveChampionIdentityModelFromRoots('16.16.1', [modelRoot], {
    validationMode: 'bootstrap-smoke'
  })
  if (!descriptor) throw new Error('bootstrap ONNX model is missing')
  return descriptor
}

function getExactTemplatePatch(championId: number): Uint8Array {
  const source = JSON.parse(fs.readFileSync(legacyBootstrapSource, 'utf8'))
  const rgb = source.templates[String(championId)]?.[0] as number[] | undefined
  if (!rgb) throw new Error(`missing bootstrap template for champion ${championId}`)
  const rgba = new Uint8Array(source.inputSize * source.inputSize * 4)
  for (let pixel = 0; pixel < source.inputSize * source.inputSize; pixel += 1) {
    rgba[pixel * 4] = rgb[pixel * 3]
    rgba[pixel * 4 + 1] = rgb[pixel * 3 + 1]
    rgba[pixel * 4 + 2] = rgb[pixel * 3 + 2]
    rgba[pixel * 4 + 3] = 255
  }
  return rgba
}

describe('ChampionOnnxClassifier', () => {
  it('loads the hash-locked opset-17 artifact through DirectML/CPU and runs real inference', async () => {
    const descriptor = getBootstrapDescriptor()
    const classifier = await ChampionOnnxClassifier.load(descriptor)
    classifiers.push(classifier)

    const result = await classifier.classifyIconPatch(
      getExactTemplatePatch(103),
      12,
      12,
      [1, 64, 90, 103]
    )

    expect(result).toMatchObject({ championId: 103 })
    expect(result!.confidence).toBeGreaterThanOrEqual(descriptor.confidenceThreshold)
    expect(result!.top2Margin).toBeGreaterThanOrEqual(descriptor.top2MarginThreshold)
    expect(classifier.getManifest()).toMatchObject({
      opset: 17,
      runtimeVersion: '1.29.0',
      executionProvider: expect.stringMatching(/^(dml|cpu)$/)
    })
  })

  it('rejects model bytes that do not match the manifest hash', async () => {
    const descriptor = getBootstrapDescriptor()
    await expect(
      ChampionOnnxClassifier.load({ ...descriptor, sha256: '0'.repeat(64) })
    ).rejects.toThrow(/SHA-256 mismatch/)
  })
})
