import { createHash } from 'node:crypto'
import fs from 'node:fs'
import type { InferenceSession, Tensor } from 'onnxruntime-node'

import type { ChampionIdentityModelRuntimeDescriptor } from '../../../shared/types/live-coach'
import type { ChampionIconClassifier, OnnxModelManifest } from './minimap-cv'
import { verifyTrustedOnnxRuntime } from './trusted-onnx-runtime'

const ORT_RUNTIME_VERSION = '1.29.0'
type OnnxRuntimeModule = typeof import('onnxruntime-node')
let trustedOnnxRuntime: OnnxRuntimeModule | null = null

function getTrustedOnnxRuntime(): OnnxRuntimeModule {
  if (trustedOnnxRuntime) return trustedOnnxRuntime
  const verified = verifyTrustedOnnxRuntime()
  if (verified.version !== ORT_RUNTIME_VERSION) {
    throw new Error('ONNX Runtime version is incompatible with the classifier')
  }
  trustedOnnxRuntime = require('onnxruntime-node') as OnnxRuntimeModule
  return trustedOnnxRuntime
}

function sampleChannel(
  buffer: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number
): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)))
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const at = (px: number, py: number) => buffer[(py * width + px) * 4 + channel]
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx
  return top * (1 - ty) + bottom * ty
}

function createNormalizedNchwPatch(
  buffer: Uint8Array,
  width: number,
  height: number,
  outputSize: number,
  cropRatio: number,
  preprocessing: ChampionIdentityModelRuntimeDescriptor['preprocessing']
): Float32Array | null {
  const cropX = width * cropRatio
  const cropY = height * cropRatio
  const cropWidth = width * (1 - cropRatio * 2)
  const cropHeight = height * (1 - cropRatio * 2)
  const pixelsPerChannel = outputSize * outputSize
  const output = new Float32Array(pixelsPerChannel * 3)

  for (let channel = 0; channel < 3; channel += 1) {
    let sum = 0
    for (let y = 0; y < outputSize; y += 1) {
      for (let x = 0; x < outputSize; x += 1) {
        const sourceX = cropX + ((x + 0.5) / outputSize) * cropWidth - 0.5
        const sourceY = cropY + ((y + 0.5) / outputSize) * cropHeight - 0.5
        const value = sampleChannel(buffer, width, height, sourceX, sourceY, channel)
        output[channel * pixelsPerChannel + y * outputSize + x] = value
        sum += value
      }
    }

    const channelOffset = channel * pixelsPerChannel
    if (preprocessing === 'imagenet') {
      const means = [0.485, 0.456, 0.406]
      const standardDeviations = [0.229, 0.224, 0.225]
      for (let index = 0; index < pixelsPerChannel; index += 1) {
        const scaled = output[channelOffset + index] / 255
        output[channelOffset + index] = (scaled - means[channel]) / standardDeviations[channel]
      }
    } else {
      const mean = sum / pixelsPerChannel
      let variance = 0
      for (let index = 0; index < pixelsPerChannel; index += 1) {
        variance += (output[channelOffset + index] - mean) ** 2
      }
      const standardDeviation = Math.sqrt(variance / pixelsPerChannel)
      if (standardDeviation < 1) return null
      for (let index = 0; index < pixelsPerChannel; index += 1) {
        output[channelOffset + index] = (output[channelOffset + index] - mean) / standardDeviation
      }
    }
  }

  if (preprocessing === 'imagenet') return output

  let energy = 0
  for (const value of output) energy += value * value
  const magnitude = Math.sqrt(energy)
  if (!Number.isFinite(magnitude) || magnitude < 1e-6) return null
  for (let index = 0; index < output.length; index += 1) output[index] /= magnitude
  return output
}

function validateSessionMetadata(
  session: InferenceSession,
  descriptor: ChampionIdentityModelRuntimeDescriptor
): void {
  if (
    session.inputNames.length !== 1 ||
    session.inputNames[0] !== descriptor.inputName ||
    session.outputNames.length !== 1 ||
    session.outputNames[0] !== descriptor.outputName
  ) {
    throw new Error('Champion identity ONNX input/output names do not match the manifest')
  }

  const input = session.inputMetadata[0]
  const output = session.outputMetadata[0]
  const expectedOutputWidth =
    descriptor.outputLayout === 'champion-logits'
      ? descriptor.championIds.length
      : descriptor.championIds.length * descriptor.variantsPerChampion
  if (
    !input?.isTensor ||
    input.type !== 'float32' ||
    input.shape.length !== 4 ||
    input.shape[1] !== descriptor.inputShape[1] ||
    input.shape[2] !== descriptor.inputShape[2] ||
    input.shape[3] !== descriptor.inputShape[3] ||
    !output?.isTensor ||
    output.type !== 'float32' ||
    output.shape.length !== 2 ||
    output.shape[1] !== expectedOutputWidth
  ) {
    throw new Error('Champion identity ONNX tensor metadata does not match the manifest')
  }
}

export class ChampionOnnxClassifier implements ChampionIconClassifier {
  private _session: InferenceSession
  private _executionProvider: 'dml' | 'cpu'
  private readonly _championIndex = new Map<number, number>()

  private constructor(
    private readonly _descriptor: ChampionIdentityModelRuntimeDescriptor,
    session: InferenceSession,
    executionProvider: 'dml' | 'cpu'
  ) {
    this._session = session
    this._executionProvider = executionProvider
    this._descriptor.championIds.forEach((championId, index) => {
      this._championIndex.set(championId, index)
    })
  }

  public static async load(
    descriptor: ChampionIdentityModelRuntimeDescriptor
  ): Promise<ChampionOnnxClassifier> {
    if (descriptor.format !== 'onnx' || descriptor.opset !== 17) {
      throw new Error('Champion identity model must be an ONNX opset-17 artifact')
    }
    const validProfile =
      (descriptor.modelName === 'champion-icon-onnx-bootstrap' &&
        descriptor.architecture === 'bootstrap-linear' &&
        descriptor.preprocessing === 'per-channel-standardize-l2' &&
        descriptor.outputLayout === 'prototype-scores') ||
      (descriptor.modelName === 'champion-icon-mobilenetv3-small' &&
        descriptor.architecture === 'mobilenet-v3-small' &&
        descriptor.preprocessing === 'imagenet' &&
        descriptor.outputLayout === 'champion-logits' &&
        descriptor.variantsPerChampion === 1)
    if (!validProfile) {
      throw new Error('Champion identity model profile is not supported')
    }
    const contents = fs.readFileSync(descriptor.path)
    const actualSha256 = createHash('sha256').update(contents).digest('hex')
    if (actualSha256.toLowerCase() !== descriptor.sha256.toLowerCase()) {
      throw new Error(
        `Champion identity model SHA-256 mismatch: expected ${descriptor.sha256}, got ${actualSha256}`
      )
    }

    if (process.platform === 'win32') {
      try {
        const session = await ChampionOnnxClassifier._createSession(descriptor.path, 'dml')
        validateSessionMetadata(session, descriptor)
        return new ChampionOnnxClassifier(descriptor, session, 'dml')
      } catch {
        // DirectML availability differs across adapters and drivers. CPU is the
        // required deterministic fallback and is validated independently below.
      }
    }

    const session = await ChampionOnnxClassifier._createSession(descriptor.path, 'cpu')
    validateSessionMetadata(session, descriptor)
    return new ChampionOnnxClassifier(descriptor, session, 'cpu')
  }

  private static _createSession(modelPath: string, provider: 'dml' | 'cpu') {
    return getTrustedOnnxRuntime().InferenceSession.create(modelPath, {
      executionProviders: [provider],
      executionMode: 'sequential',
      enableMemPattern: provider !== 'dml',
      graphOptimizationLevel: 'all'
    })
  }

  public isReady(): boolean {
    return Boolean(this._session)
  }

  public getManifest(): OnnxModelManifest {
    return {
      modelName: this._descriptor.modelName,
      version: this._descriptor.version,
      sha256: this._descriptor.sha256,
      opset: this._descriptor.opset,
      inputShape: this._descriptor.inputShape,
      confidenceThreshold: this._descriptor.confidenceThreshold,
      top2MarginThreshold: this._descriptor.top2MarginThreshold,
      classes: this._descriptor.championIds.map(String),
      executionProvider: this._executionProvider,
      runtimeVersion: ORT_RUNTIME_VERSION
    }
  }

  public async classifyIconPatch(
    patchBuffer: Uint8Array,
    width: number,
    height: number,
    candidateChampionIds: number[]
  ): Promise<{ championId: number; confidence: number; top2Margin: number } | null> {
    if (
      patchBuffer.byteLength !== width * height * 4 ||
      width < 4 ||
      height < 4 ||
      candidateChampionIds.length === 0
    ) {
      return null
    }

    const inputSize = this._descriptor.inputShape[2]
    const patchVariants = this._descriptor.cropRatios
      .map((cropRatio) =>
        createNormalizedNchwPatch(
          patchBuffer,
          width,
          height,
          inputSize,
          cropRatio,
          this._descriptor.preprocessing
        )
      )
      .filter((pixels): pixels is Float32Array => pixels !== null)
    if (patchVariants.length === 0) return null

    const featureCount = 3 * inputSize * inputSize
    const inputData = new Float32Array(patchVariants.length * featureCount)
    patchVariants.forEach((variant, index) => inputData.set(variant, index * featureCount))
    const input = new (getTrustedOnnxRuntime().Tensor)('float32', inputData, [
      patchVariants.length,
      3,
      inputSize,
      inputSize
    ])

    const output = await this._runWithCpuFallback(input)
    const scores = output.data
    if (!(scores instanceof Float32Array)) {
      throw new Error('Champion identity ONNX output must be float32')
    }

    const outputWidth =
      this._descriptor.outputLayout === 'champion-logits'
        ? this._descriptor.championIds.length
        : this._descriptor.championIds.length * this._descriptor.variantsPerChampion
    if (scores.length !== patchVariants.length * outputWidth) {
      throw new Error('Champion identity ONNX output length does not match the manifest')
    }
    if (scores.some((value) => !Number.isFinite(value))) {
      throw new Error('Champion identity ONNX output contains a non-finite score')
    }

    let bestChampionId = 0
    let bestScore = -1
    let secondScore = -1
    for (const championId of new Set(candidateChampionIds)) {
      const championIndex = this._championIndex.get(championId)
      if (championIndex === undefined) continue
      let championScore = 0
      if (this._descriptor.outputLayout === 'champion-logits') {
        for (let patchIndex = 0; patchIndex < patchVariants.length; patchIndex += 1) {
          const rowOffset = patchIndex * outputWidth
          let maximumLogit = -Infinity
          for (let classIndex = 0; classIndex < outputWidth; classIndex += 1) {
            maximumLogit = Math.max(maximumLogit, scores[rowOffset + classIndex])
          }
          let denominator = 0
          for (let classIndex = 0; classIndex < outputWidth; classIndex += 1) {
            denominator += Math.exp(scores[rowOffset + classIndex] - maximumLogit)
          }
          championScore += Math.exp(scores[rowOffset + championIndex] - maximumLogit) / denominator
        }
        championScore /= patchVariants.length
      } else {
        championScore = -1
        const templateOffset = championIndex * this._descriptor.variantsPerChampion
        for (let patchIndex = 0; patchIndex < patchVariants.length; patchIndex += 1) {
          const rowOffset = patchIndex * outputWidth
          for (
            let variantIndex = 0;
            variantIndex < this._descriptor.variantsPerChampion;
            variantIndex += 1
          ) {
            championScore = Math.max(
              championScore,
              scores[rowOffset + templateOffset + variantIndex]
            )
          }
        }
      }
      if (championScore > bestScore) {
        secondScore = bestScore
        bestScore = championScore
        bestChampionId = championId
      } else if (championScore > secondScore) {
        secondScore = championScore
      }
    }

    if (bestChampionId === 0) return null
    const confidence =
      this._descriptor.outputLayout === 'champion-logits'
        ? bestScore
        : Math.max(0, Math.min(1, (bestScore - 0.25) / 0.75))
    return {
      championId: bestChampionId,
      confidence,
      top2Margin: Math.max(0, Math.min(1, bestScore - secondScore))
    }
  }

  public async dispose(): Promise<void> {
    await this._session.release()
  }

  private async _runWithCpuFallback(input: Tensor): Promise<Tensor> {
    try {
      const results = await this._session.run({ [this._descriptor.inputName]: input }, [
        this._descriptor.outputName
      ])
      return results[this._descriptor.outputName] as Tensor
    } catch (error) {
      if (this._executionProvider !== 'dml') throw error
      await this._session.release().catch(() => undefined)
      this._session = await ChampionOnnxClassifier._createSession(this._descriptor.path, 'cpu')
      validateSessionMetadata(this._session, this._descriptor)
      this._executionProvider = 'cpu'
      const results = await this._session.run({ [this._descriptor.inputName]: input }, [
        this._descriptor.outputName
      ])
      return results[this._descriptor.outputName] as Tensor
    }
  }
}
