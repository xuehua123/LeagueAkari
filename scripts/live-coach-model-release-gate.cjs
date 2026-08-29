const BOOTSTRAP_MODEL_NAME = 'champion-icon-onnx-bootstrap'

function isBootstrapModel(entry) {
  return entry?.modelName === BOOTSTRAP_MODEL_NAME
}

function claimsReleaseEligibility(entry) {
  return (
    !isBootstrapModel(entry) &&
    entry?.validation?.status === 'accepted' &&
    entry.validation.releaseEligible === true
  )
}

function hasAcceptedCurrentPatchModel(releasePatch, acceptedModelPatches) {
  return (
    typeof releasePatch === 'string' &&
    Array.isArray(acceptedModelPatches) &&
    acceptedModelPatches.includes(releasePatch)
  )
}

function selectPreferredModelSmokeEntry(packagedManifest, sourceManifest) {
  const acceptedEntries = Object.entries(packagedManifest?.models ?? {}).filter(([, entry]) =>
    claimsReleaseEligibility(entry)
  )
  const acceptedEntry =
    acceptedEntries.find(([patch]) => patch === packagedManifest.releasePatch) ?? acceptedEntries[0]
  if (acceptedEntry) {
    return {
      entry: acceptedEntry,
      mode: 'accepted-packaged-model',
      currentPatchModelReleaseEligible: acceptedEntry[0] === packagedManifest.releasePatch
    }
  }

  const bootstrapEntry = Object.entries(sourceManifest?.models ?? {}).find(([, entry]) =>
    isBootstrapModel(entry)
  )
  if (!bootstrapEntry) return null
  return {
    entry: bootstrapEntry,
    mode: 'bootstrap-transport-only',
    currentPatchModelReleaseEligible: false
  }
}

module.exports = {
  BOOTSTRAP_MODEL_NAME,
  claimsReleaseEligibility,
  hasAcceptedCurrentPatchModel,
  isBootstrapModel,
  selectPreferredModelSmokeEntry
}
