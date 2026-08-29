import type { NativeInputStatus } from '@renderer-shared/shards/app-common/native-input-status'
import type {
  CaptureEnvironmentFingerprint,
  CoachUnavailableReason
} from '@shared/types/live-coach'

export type EnvironmentCheckStatus = 'available' | 'partial' | 'unavailable' | 'unknown'

export type EnvironmentProbeGroup = 'capture' | 'preview' | 'voices' | 'audio'

export type EnvironmentHelpTopic =
  | 'automatic-pause'
  | 'calibration'
  | 'capture'
  | 'consent'
  | 'getting-started'
  | 'live-data'
  | 'no-sound'
  | 'patch'
  | 'permission'
  | 'platform'
  | 'privacy'
  | 'unsupported'

export type EnvironmentCheckId =
  | 'platform'
  | 'capture'
  | 'resolution'
  | 'dpi'
  | 'hdr'
  | 'windowMode'
  | 'roi'
  | 'map'
  | 'queue'
  | 'region'
  | 'patch'
  | 'liveData'
  | 'voice'
  | 'audioOutput'
  | 'nativeShortcuts'

export interface CaptureSupportProbe {
  supported: boolean
  realtimeSupported: boolean
  platform: string
  backends: string[]
  nativeBackends: Array<'wgc' | 'dda'>
  fallbackAvailable: boolean
  hdrSupported: boolean
  permissionGranted: boolean | null
}

export interface CalibrationPreviewProbe {
  calibration: {
    confidence: number
  }
  fingerprint: CaptureEnvironmentFingerprint
  sourceSize: { width: number; height: number } | null
  thumbnailSize: { width: number; height: number }
}

export type ProbeResult<T> =
  { state: 'not-run' } | { state: 'success'; value: T } | { state: 'error'; message: string }

export interface EnvironmentProbeCache {
  checkedAt: number | null
  capture: ProbeResult<CaptureSupportProbe>
  preview: ProbeResult<CalibrationPreviewProbe>
  voices: ProbeResult<Array<{ id: string; name: string }>>
  audio: ProbeResult<{
    outputDevices: Array<{ id: string; name: string; isDefault: boolean }>
  }>
}

export interface EnvironmentMatrixInput {
  platform: string
  isElevated: boolean
  nativeInputStatus: NativeInputStatus
  nativeInputRequiresElevation: boolean
  session: {
    mapId: number | null
    queueId: number | null
    patch: string | null
  }
  capability: {
    enabledFeatureIds: string[]
    unavailable: Record<string, CoachUnavailableReason>
  }
  capture: {
    state: string
    backend: string | null
    resolution: { width: number; height: number } | null
    roiState: string
    confidence: number | null
  }
  liveData: {
    state: string
    lastSuccessAt: number | null
  }
  settings: {
    speechVoiceId: string | null
    speechOutputDeviceId: string | null
    shortcuts: Array<string | null>
  }
  probes: EnvironmentProbeCache
}

export interface EnvironmentCheck {
  id: EnvironmentCheckId
  status: EnvironmentCheckStatus
  valueKey: string
  valueParams?: Record<string, string | number>
  reasonKey: string
  fixKey: string
  helpTopic: EnvironmentHelpTopic
  probeGroups: EnvironmentProbeGroup[]
}

export function createEmptyEnvironmentProbeCache(): EnvironmentProbeCache {
  return {
    checkedAt: null,
    capture: { state: 'not-run' },
    preview: { state: 'not-run' },
    voices: { state: 'not-run' },
    audio: { state: 'not-run' }
  }
}

export function buildEnvironmentChecks(input: EnvironmentMatrixInput): EnvironmentCheck[] {
  const unavailableReasons = new Set(Object.values(input.capability.unavailable))
  const fingerprint =
    input.probes.preview.state === 'success' ? input.probes.preview.value.fingerprint : null
  const captureSupport =
    input.probes.capture.state === 'success' ? input.probes.capture.value : null

  return [
    buildPlatformCheck(input.platform),
    buildCaptureCheck(input, captureSupport),
    buildResolutionCheck(input.capture.resolution, fingerprint),
    buildDpiCheck(fingerprint),
    buildHdrCheck(fingerprint, captureSupport),
    buildWindowModeCheck(fingerprint),
    buildRoiCheck(input),
    buildMapCheck(input.session.mapId, unavailableReasons),
    buildQueueCheck(input.session.queueId, unavailableReasons),
    buildRegionCheck(unavailableReasons),
    buildPatchCheck(input.session.patch, unavailableReasons),
    buildLiveDataCheck(input.liveData, unavailableReasons),
    buildVoiceCheck(input),
    buildAudioOutputCheck(input),
    buildNativeShortcutsCheck(input)
  ]
}

export function summarizeEnvironmentChecks(checks: EnvironmentCheck[]): EnvironmentCheckStatus {
  if (checks.some((check) => check.status === 'unavailable')) return 'unavailable'
  if (checks.some((check) => check.status === 'partial')) return 'partial'
  if (checks.some((check) => check.status === 'unknown')) return 'unknown'
  return 'available'
}

export function selectProbeGroupsForUnreadyChecks(
  checks: EnvironmentCheck[]
): EnvironmentProbeGroup[] {
  const groups = new Set<EnvironmentProbeGroup>()
  for (const check of checks) {
    if (check.status === 'available') continue
    check.probeGroups.forEach((group) => groups.add(group))
  }
  return [...groups]
}

export function listUnprobeableUnreadyChecks(checks: EnvironmentCheck[]): EnvironmentCheckId[] {
  return checks
    .filter((check) => check.status !== 'available' && check.probeGroups.length === 0)
    .map((check) => check.id)
}

export function resolveErrorHelpTopic(code: string): EnvironmentHelpTopic {
  switch (code) {
    case 'unsupported-platform':
      return 'platform'
    case 'unsupported-patch':
      return 'patch'
    case 'consent-required':
      return 'consent'
    case 'capture-permission-denied':
      return 'permission'
    case 'capture-target-not-found':
    case 'capture-black-frame':
    case 'capture-stalled':
    case 'capture-crash-loop':
    case 'cv-overloaded':
      return 'capture'
    case 'calibration-required':
    case 'roi-occluded':
      return 'calibration'
    case 'speech-unavailable':
    case 'microphone-unavailable':
    case 'provider-credential-missing':
    case 'provider-timeout':
    case 'provider-rate-limited':
    case 'provider-region-unavailable':
      return 'no-sound'
    case 'live-data-unavailable':
      return 'live-data'
    case 'unsupported-map':
    case 'unsupported-queue':
    case 'unsupported-region':
    case 'capability-disabled':
      return 'unsupported'
    case 'storage-unavailable':
      return 'privacy'
    default:
      return 'automatic-pause'
  }
}

export function resolveUnavailableReasonHelpTopic(reason: string): EnvironmentHelpTopic {
  return resolveErrorHelpTopic(reason)
}

function buildPlatformCheck(platform: string): EnvironmentCheck {
  if (platform === 'win32') {
    return check(
      'platform',
      'available',
      'platformWindows',
      'platformSupported',
      'none',
      'platform'
    )
  }
  if (platform === 'unknown') {
    return check(
      'platform',
      'unknown',
      'platformUnknown',
      'platformUnknown',
      'restartApp',
      'platform'
    )
  }
  return check(
    'platform',
    'unavailable',
    'platformOther',
    'platformUnsupported',
    'useWindows',
    'platform',
    [],
    { platform }
  )
}

function buildCaptureCheck(
  input: EnvironmentMatrixInput,
  support: CaptureSupportProbe | null
): EnvironmentCheck {
  const activeBackend = input.capture.backend?.toLowerCase() ?? null
  if ((activeBackend === 'wgc' || activeBackend === 'dda') && input.capture.state === 'running') {
    return check(
      'capture',
      'available',
      'captureBackend',
      'captureRunning',
      'none',
      'capture',
      ['capture'],
      { backend: activeBackend.toUpperCase() }
    )
  }

  if (!support) {
    const probeFailed = input.probes.capture.state === 'error'
    return check(
      'capture',
      'unknown',
      probeFailed ? 'probeFailed' : 'notChecked',
      probeFailed ? 'captureProbeFailed' : 'runCheck',
      'rerunCheck',
      'capture',
      ['capture']
    )
  }
  if (support.permissionGranted === false) {
    return check(
      'capture',
      'unavailable',
      'permissionDenied',
      'capturePermissionDenied',
      'grantCapturePermission',
      'permission',
      ['capture']
    )
  }
  if (support.realtimeSupported) {
    if (support.permissionGranted === null) {
      return check(
        'capture',
        'unknown',
        'captureBackends',
        'capturePermissionUnknown',
        'verifyCaptureInGame',
        'permission',
        ['capture'],
        { backends: support.nativeBackends.map((backend) => backend.toUpperCase()).join(' / ') }
      )
    }
    return check(
      'capture',
      'available',
      'captureBackends',
      'nativeCaptureAvailable',
      'none',
      'capture',
      ['capture'],
      { backends: support.nativeBackends.map((backend) => backend.toUpperCase()).join(' / ') }
    )
  }
  if (support.supported && support.fallbackAvailable) {
    return check(
      'capture',
      'partial',
      'previewOnly',
      'realtimeBackendMissing',
      'installNativeCapture',
      'capture',
      ['capture']
    )
  }
  return check(
    'capture',
    'unavailable',
    'unavailable',
    'captureUnsupported',
    'useSupportedCaptureEnvironment',
    'capture',
    ['capture']
  )
}

function buildResolutionCheck(
  liveResolution: { width: number; height: number } | null,
  fingerprint: CaptureEnvironmentFingerprint | null
): EnvironmentCheck {
  const resolution =
    fingerprint && fingerprint.width !== null && fingerprint.height !== null
      ? { width: fingerprint.width, height: fingerprint.height }
      : liveResolution
  if (!resolution) {
    return check(
      'resolution',
      'unknown',
      'waitingForGame',
      'resolutionUnknown',
      'enterGameAndRerun',
      'capture',
      ['preview']
    )
  }
  const supported =
    (resolution.width === 1920 && resolution.height === 1080) ||
    (resolution.width === 2560 && resolution.height === 1440)
  return check(
    'resolution',
    supported ? 'available' : 'unavailable',
    'resolution',
    supported ? 'resolutionSupported' : 'resolutionUnsupported',
    supported ? 'none' : 'useSupportedResolution',
    'capture',
    ['preview'],
    resolution
  )
}

function buildDpiCheck(fingerprint: CaptureEnvironmentFingerprint | null): EnvironmentCheck {
  if (!fingerprint || fingerprint.dpiScale === null) {
    return check('dpi', 'unknown', 'waitingForGame', 'dpiUnknown', 'enterGameAndRerun', 'capture', [
      'preview'
    ])
  }
  const supported = fingerprint.dpiScale >= 1 && fingerprint.dpiScale <= 1.5
  return check(
    'dpi',
    supported ? 'available' : 'unavailable',
    'dpi',
    supported ? 'dpiSupported' : 'dpiUnsupported',
    supported ? 'none' : 'useSupportedDpi',
    'capture',
    ['preview'],
    { percent: Math.round(fingerprint.dpiScale * 100) }
  )
}

function buildHdrCheck(
  fingerprint: CaptureEnvironmentFingerprint | null,
  support: CaptureSupportProbe | null
): EnvironmentCheck {
  if (!fingerprint || fingerprint.hdr === null) {
    return check('hdr', 'unknown', 'waitingForGame', 'hdrUnknown', 'enterGameAndRerun', 'capture', [
      'capture',
      'preview'
    ])
  }
  if (!fingerprint.hdr) {
    return check('hdr', 'available', 'sdr', 'sdrSupported', 'none', 'capture', [
      'capture',
      'preview'
    ])
  }
  if (support?.hdrSupported) {
    return check('hdr', 'partial', 'hdr', 'hdrNotReleaseValidated', 'preferSdr', 'capture', [
      'capture',
      'preview'
    ])
  }
  return check('hdr', 'unavailable', 'hdr', 'hdrBackendUnsupported', 'disableHdr', 'capture', [
    'capture',
    'preview'
  ])
}

function buildWindowModeCheck(fingerprint: CaptureEnvironmentFingerprint | null): EnvironmentCheck {
  const mode = fingerprint?.windowMode
  if (!mode || mode === 'unknown') {
    return check(
      'windowMode',
      'unknown',
      'windowModeUnknown',
      'windowModeNotDetectable',
      'useWindowedOrBorderless',
      'capture',
      ['preview']
    )
  }
  if (mode === 'windowed' || mode === 'borderless') {
    return check(
      'windowMode',
      'available',
      mode === 'windowed' ? 'windowed' : 'borderless',
      'windowModeSupported',
      'none',
      'capture',
      ['preview']
    )
  }
  return check(
    'windowMode',
    'unavailable',
    'exclusiveFullscreen',
    'exclusiveFullscreenUnsupported',
    'useWindowedOrBorderless',
    'capture',
    ['preview']
  )
}

function buildRoiCheck(input: EnvironmentMatrixInput): EnvironmentCheck {
  if (input.probes.preview.state === 'success') {
    const confidence = input.probes.preview.value.calibration.confidence
    if (confidence >= 0.8) {
      return check(
        'roi',
        'available',
        'roiConfidence',
        'roiLocated',
        'none',
        'calibration',
        ['preview'],
        { confidence: Math.round(confidence * 100) }
      )
    }
    if (confidence > 0) {
      return check(
        'roi',
        'partial',
        'roiConfidence',
        'roiLowConfidence',
        'manualCalibration',
        'calibration',
        ['preview'],
        { confidence: Math.round(confidence * 100) }
      )
    }
    return check(
      'roi',
      'unavailable',
      'roiNotLocated',
      'roiNotLocated',
      'manualCalibration',
      'calibration',
      ['preview']
    )
  }

  switch (input.capture.roiState) {
    case 'healthy':
      return check('roi', 'available', 'roiHealthy', 'roiHealthy', 'none', 'calibration', [
        'preview'
      ])
    case 'degraded':
      return check(
        'roi',
        'partial',
        'roiDegraded',
        'roiDegraded',
        'rerunCalibration',
        'calibration',
        ['preview']
      )
    case 'unsupported':
      return check(
        'roi',
        'unavailable',
        'roiUnsupported',
        'roiUnsupported',
        'manualCalibration',
        'calibration',
        ['preview']
      )
    default:
      return check(
        'roi',
        'unknown',
        input.probes.preview.state === 'error' ? 'previewFailed' : 'waitingForCalibration',
        input.probes.preview.state === 'error' ? 'previewUnavailable' : 'roiUnknown',
        'enterGameAndCalibrate',
        'calibration',
        ['preview']
      )
  }
}

function buildMapCheck(
  mapId: number | null,
  unavailableReasons: Set<CoachUnavailableReason>
): EnvironmentCheck {
  if (unavailableReasons.has('unsupported-map')) {
    return check(
      'map',
      'unavailable',
      mapId === null ? 'waitingForGame' : 'mapId',
      'mapUnsupported',
      'useSummonersRift',
      'unsupported',
      [],
      mapId === null ? undefined : { id: mapId }
    )
  }
  if (mapId === null) {
    return check(
      'map',
      'unknown',
      'waitingForGame',
      'mapUnknown',
      'enterSupportedGame',
      'unsupported'
    )
  }
  return check(
    'map',
    mapId === 11 ? 'available' : 'unavailable',
    'mapId',
    mapId === 11 ? 'mapSupported' : 'mapUnsupported',
    mapId === 11 ? 'none' : 'useSummonersRift',
    'unsupported',
    [],
    { id: mapId }
  )
}

function buildQueueCheck(
  queueId: number | null,
  unavailableReasons: Set<CoachUnavailableReason>
): EnvironmentCheck {
  if (unavailableReasons.has('unsupported-queue')) {
    return check(
      'queue',
      'unavailable',
      queueId === null ? 'waitingForGame' : 'queueId',
      'queueUnsupported',
      'useSupportedQueue',
      'unsupported',
      [],
      queueId === null ? undefined : { id: queueId }
    )
  }
  if (queueId === null) {
    return check(
      'queue',
      'unknown',
      'waitingForGame',
      'queueUnknown',
      'enterSupportedGame',
      'unsupported'
    )
  }
  return check('queue', 'available', 'queueId', 'queueGatePassed', 'none', 'unsupported', [], {
    id: queueId
  })
}

function buildRegionCheck(unavailableReasons: Set<CoachUnavailableReason>): EnvironmentCheck {
  if (unavailableReasons.has('unsupported-region')) {
    return check(
      'region',
      'unavailable',
      'regionRejected',
      'regionUnsupported',
      'useSupportedRegionOrOffline',
      'unsupported'
    )
  }
  return check(
    'region',
    'unknown',
    'regionNotExposed',
    'regionNotExposed',
    'waitForRegionGate',
    'unsupported'
  )
}

function buildPatchCheck(
  patch: string | null,
  unavailableReasons: Set<CoachUnavailableReason>
): EnvironmentCheck {
  if (unavailableReasons.has('unsupported-patch')) {
    return check(
      'patch',
      'unavailable',
      patch ? 'patchVersion' : 'patchUnknown',
      'patchUnsupported',
      'updateAndWaitForPatch',
      'patch',
      [],
      patch ? { patch } : undefined
    )
  }
  if (!patch) {
    return check('patch', 'unknown', 'patchUnknown', 'patchUnknown', 'enterGameForPatch', 'patch')
  }
  return check('patch', 'available', 'patchVersion', 'patchGatePassed', 'none', 'patch', [], {
    patch
  })
}

function buildLiveDataCheck(
  liveData: EnvironmentMatrixInput['liveData'],
  unavailableReasons: Set<CoachUnavailableReason>
): EnvironmentCheck {
  if (
    unavailableReasons.has('live-data-unavailable') ||
    ['degraded', 'unavailable', 'error'].includes(liveData.state)
  ) {
    return check(
      'liveData',
      'unavailable',
      'liveDataUnavailable',
      'liveDataUnavailable',
      'restoreLiveData',
      'live-data'
    )
  }
  if (liveData.state === 'healthy' && liveData.lastSuccessAt !== null) {
    return check('liveData', 'available', 'liveDataHealthy', 'liveDataHealthy', 'none', 'live-data')
  }
  return check(
    'liveData',
    'unknown',
    'waitingForGame',
    'liveDataUnknown',
    'enterGameForLiveData',
    'live-data'
  )
}

function buildVoiceCheck(input: EnvironmentMatrixInput): EnvironmentCheck {
  if (input.probes.voices.state !== 'success') {
    return check(
      'voice',
      'unknown',
      input.probes.voices.state === 'error' ? 'probeFailed' : 'notChecked',
      input.probes.voices.state === 'error' ? 'voiceProbeFailed' : 'runCheck',
      'checkSpeechRuntime',
      'no-sound',
      ['voices']
    )
  }
  const voices = input.probes.voices.value
  if (voices.length === 0) {
    return check(
      'voice',
      'unavailable',
      'noVoices',
      'voiceUnavailable',
      'installLocalVoice',
      'no-sound',
      ['voices']
    )
  }
  const selectedVoice = input.settings.speechVoiceId
    ? voices.find((voice) => voice.id === input.settings.speechVoiceId)
    : null
  if (input.settings.speechVoiceId && !selectedVoice) {
    return check(
      'voice',
      'unavailable',
      'selectedVoiceMissing',
      'selectedVoiceMissing',
      'selectAvailableVoice',
      'no-sound',
      ['voices']
    )
  }
  return check(
    'voice',
    'available',
    selectedVoice ? 'selectedVoice' : 'voiceCount',
    'voiceAvailable',
    'none',
    'no-sound',
    ['voices'],
    selectedVoice ? { name: selectedVoice.name } : { count: voices.length }
  )
}

function buildAudioOutputCheck(input: EnvironmentMatrixInput): EnvironmentCheck {
  if (input.probes.audio.state !== 'success') {
    return check(
      'audioOutput',
      'unknown',
      input.probes.audio.state === 'error' ? 'probeFailed' : 'notChecked',
      input.probes.audio.state === 'error' ? 'audioProbeFailed' : 'runCheck',
      'checkAudioDevices',
      'no-sound',
      ['audio']
    )
  }
  const devices = input.probes.audio.value.outputDevices
  if (devices.length === 0) {
    return check(
      'audioOutput',
      'unavailable',
      'noAudioOutputs',
      'audioOutputUnavailable',
      'connectAudioOutput',
      'no-sound',
      ['audio']
    )
  }
  const selectedDevice = input.settings.speechOutputDeviceId
    ? devices.find((device) => device.id === input.settings.speechOutputDeviceId)
    : (devices.find((device) => device.isDefault) ?? devices[0])
  if (input.settings.speechOutputDeviceId && !selectedDevice) {
    return check(
      'audioOutput',
      'unavailable',
      'selectedAudioOutputMissing',
      'selectedAudioOutputMissing',
      'selectAvailableAudioOutput',
      'no-sound',
      ['audio']
    )
  }
  return check(
    'audioOutput',
    'available',
    'selectedAudioOutput',
    'audioOutputAvailable',
    'none',
    'no-sound',
    ['audio'],
    { name: selectedDevice?.name ?? '' }
  )
}

function buildNativeShortcutsCheck(input: EnvironmentMatrixInput): EnvironmentCheck {
  const configuredCount = input.settings.shortcuts.filter(Boolean).length
  if (input.nativeInputStatus === 'available') {
    return check(
      'nativeShortcuts',
      configuredCount > 0 ? 'available' : 'partial',
      'shortcutsConfigured',
      'nativeShortcutsAvailable',
      configuredCount > 0 ? 'none' : 'configureShortcuts',
      'getting-started',
      [],
      { count: configuredCount }
    )
  }
  if (input.nativeInputStatus === 'requires-elevation') {
    return check(
      'nativeShortcuts',
      'unavailable',
      'elevationRequired',
      'shortcutElevationRequired',
      'restartElevated',
      'getting-started'
    )
  }
  if (input.nativeInputStatus === 'unsupported-platform') {
    return check(
      'nativeShortcuts',
      'unavailable',
      'unavailable',
      'shortcutPlatformUnsupported',
      'useWindows',
      'platform'
    )
  }
  return check(
    'nativeShortcuts',
    'unavailable',
    input.nativeInputRequiresElevation && !input.isElevated
      ? 'elevationRequired'
      : 'initializationFailed',
    'shortcutInitializationFailed',
    input.nativeInputRequiresElevation && !input.isElevated ? 'restartElevated' : 'restartApp',
    'getting-started'
  )
}

function check(
  id: EnvironmentCheckId,
  status: EnvironmentCheckStatus,
  valueKey: string,
  reasonKey: string,
  fixKey: string,
  helpTopic: EnvironmentHelpTopic,
  probeGroups: EnvironmentProbeGroup[] = [],
  valueParams?: Record<string, string | number>
): EnvironmentCheck {
  return {
    id,
    status,
    valueKey,
    valueParams,
    reasonKey,
    fixKey,
    helpTopic,
    probeGroups
  }
}
