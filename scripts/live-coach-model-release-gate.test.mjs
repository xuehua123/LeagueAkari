import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  claimsReleaseEligibility,
  hasAcceptedCurrentPatchModel,
  selectPreferredModelSmokeEntry
} = require('./live-coach-model-release-gate.cjs')

function model(modelName, status = 'unvalidated', releaseEligible = false) {
  return { modelName, validation: { status, releaseEligible } }
}

describe('packaged Live Coach model release gate', () => {
  it('prefers an accepted current-patch packaged model over the bootstrap transport fixture', () => {
    const selection = selectPreferredModelSmokeEntry(
      {
        releasePatch: '16.17.1',
        models: {
          '16.16.1': model('champion-icon-mobilenetv3-small', 'accepted', true),
          '16.17.1': model('champion-icon-mobilenetv3-small', 'accepted', true)
        }
      },
      { models: { '16.15.1': model('champion-icon-onnx-bootstrap') } }
    )

    expect(selection).toMatchObject({
      entry: ['16.17.1', expect.any(Object)],
      mode: 'accepted-packaged-model',
      currentPatchModelReleaseEligible: true
    })
  })

  it('labels bootstrap-only execution as transport smoke and not release eligibility', () => {
    const bootstrap = model('champion-icon-onnx-bootstrap', 'accepted', true)
    expect(claimsReleaseEligibility(bootstrap)).toBe(false)

    const selection = selectPreferredModelSmokeEntry(
      { releasePatch: '16.17.1', models: { '16.17.1': bootstrap } },
      { models: { '16.16.1': bootstrap } }
    )
    expect(selection).toMatchObject({
      entry: ['16.16.1', bootstrap],
      mode: 'bootstrap-transport-only',
      currentPatchModelReleaseEligible: false
    })
    expect(hasAcceptedCurrentPatchModel('16.17.1', [])).toBe(false)
  })

  it('loads an accepted older model for runtime coverage without calling it current-patch ready', () => {
    const accepted = model('champion-icon-mobilenetv3-small', 'accepted', true)
    const selection = selectPreferredModelSmokeEntry(
      { releasePatch: '16.17.1', models: { '16.16.1': accepted } },
      { models: { '16.17.1': model('champion-icon-onnx-bootstrap') } }
    )
    expect(selection).toMatchObject({
      entry: ['16.16.1', accepted],
      mode: 'accepted-packaged-model',
      currentPatchModelReleaseEligible: false
    })
    expect(hasAcceptedCurrentPatchModel('16.17.1', ['16.16.1'])).toBe(false)
    expect(hasAcceptedCurrentPatchModel('16.17.1', ['16.16.1', '16.17.1'])).toBe(true)
  })
})
