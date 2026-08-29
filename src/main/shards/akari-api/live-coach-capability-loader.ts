import { IntervalTask } from '@main/utils/timer'
import type {
  LiveCoachCapabilityEnvelope,
  LiveCoachCapabilityPayload,
  LiveCoachCapabilitySnapshotStatus
} from '@shared/types/live-coach'
import { z } from 'zod'

import { formatSanitizedErrorLog } from '../minimap-observer/public-error'
import { LIVE_COACH_CAPABILITY_CACHED_RESOURCE as resource } from './cached-resources'
import type { AkariApiMainContext } from './context'
import {
  getLiveCoachCapabilityVerificationStatus,
  verifyLiveCoachCapabilityEnvelope
} from './live-coach-capability-verifier'

interface CapabilityAcceptanceMetadata {
  generation: number
  issuedAt: string
  lastAcceptedAt: string
}

const capabilityAcceptanceMetadataSchema: z.ZodType<CapabilityAcceptanceMetadata> = z
  .object({
    generation: z.number().int().nonnegative(),
    issuedAt: z.iso.datetime({ offset: true }),
    lastAcceptedAt: z.iso.datetime({ offset: true })
  })
  .strict()

const MAX_TIMEOUT_MS = 2_147_483_647

export class LiveCoachCapabilityLoader {
  private readonly _task: IntervalTask
  private _metadata: CapabilityAcceptanceMetadata | null = null
  private _acceptedEnvelope: LiveCoachCapabilityEnvelope | null = null
  private _expiryTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly _context: AkariApiMainContext,
    private readonly _now: () => number = Date.now,
    private readonly _verify = verifyLiveCoachCapabilityEnvelope
  ) {
    this._task = new IntervalTask(() => this._updateAndSave(), {
      interval: resource.intervalMs
    })
  }

  async initFromLocal(): Promise<void> {
    await this._loadMetadata()

    if (!(await this._context.settingService.jsonConfigFileExists(resource.cachePath))) {
      return
    }

    let cached: unknown
    try {
      cached = await this._context.settingService.readFromJsonConfigFile(resource.cachePath)
    } catch (error) {
      this._context.logger.warn(formatSanitizedErrorLog(`Invalid cached ${resource.name}`, error))
      await this._deleteCachedEnvelope()
      this._setUnavailable('invalid-envelope')
      return
    }

    const envelopeResult = resource.schema.safeParse(cached)
    if (!envelopeResult.success) {
      this._context.logger.warn(`Invalid cached ${resource.name}; schema validation failed`)
      await this._deleteCachedEnvelope()
      this._setUnavailable('invalid-envelope')
      return
    }

    try {
      const payload = this._verifyEnvelope(envelopeResult.data)
      await this._persistAccepted(envelopeResult.data, payload)
      this._accept(envelopeResult.data, payload)
    } catch (error) {
      const status = getLiveCoachCapabilityVerificationStatus(error)
      this._context.logger.warn(`Rejected cached ${resource.name}`, { status })
      await this._deleteCachedEnvelope()
      this._setUnavailable(status)
    }
  }

  watch(): void {
    this._task.start({ runImmediately: true })
  }

  dispose(): void {
    this._task.cancel()
    this._clearExpiryTimer()
  }

  private async _loadMetadata(): Promise<void> {
    if (!(await this._context.settingService.jsonConfigFileExists(resource.metadataCachePath))) {
      return
    }

    try {
      const input = await this._context.settingService.readFromJsonConfigFile(
        resource.metadataCachePath
      )
      const result = capabilityAcceptanceMetadataSchema.safeParse(input)
      if (!result.success) {
        throw result.error
      }
      this._metadata = result.data
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog(`Invalid cached ${resource.name} acceptance metadata`, error)
      )
      await this._deleteMetadata()
      this._metadata = null
    }
  }

  private _verifyEnvelope(envelope: LiveCoachCapabilityEnvelope): LiveCoachCapabilityPayload {
    return this._verify(envelope, {
      nowMs: this._now(),
      minimumGeneration: this._metadata?.generation,
      minimumIssuedAtMs: this._metadata ? Date.parse(this._metadata.issuedAt) : null,
      lastAcceptedAtMs: this._metadata ? Date.parse(this._metadata.lastAcceptedAt) : null
    })
  }

  private _accept(
    envelope: LiveCoachCapabilityEnvelope,
    payload: LiveCoachCapabilityPayload
  ): void {
    this._acceptedEnvelope = envelope
    this._context.state.setLiveCoachCapabilities(payload, 'valid')
    this._scheduleExpiry(payload)
  }

  private async _persistAccepted(
    envelope: LiveCoachCapabilityEnvelope,
    payload: LiveCoachCapabilityPayload
  ): Promise<void> {
    const nowMs = this._now()
    const metadata: CapabilityAcceptanceMetadata = {
      generation: payload.generation,
      issuedAt: payload.issuedAt,
      lastAcceptedAt: new Date(
        Math.max(nowMs, this._metadata ? Date.parse(this._metadata.lastAcceptedAt) : 0)
      ).toISOString()
    }

    // Persist the signed source before advancing the anti-rollback floor. A crash
    // between these writes can only cause the newer envelope to be revalidated.
    await this._context.settingService.writeToJsonConfigFile(resource.cachePath, envelope)
    await this._context.settingService.writeToJsonConfigFile(resource.metadataCachePath, metadata)
    this._metadata = metadata
  }

  private async _updateAndSave(): Promise<void> {
    const { api, logger, state } = this._context
    if (state.isUpdatingLiveCoachCapabilities) {
      return
    }

    state.setUpdatingLiveCoachCapabilities(true)
    try {
      // Revalidate the last accepted snapshot on every poll. This closes an
      // expired snapshot even when the remote endpoint is offline.
      if (this._acceptedEnvelope) {
        try {
          const payload = this._verifyEnvelope(this._acceptedEnvelope)
          await this._persistAccepted(this._acceptedEnvelope, payload)
          this._accept(this._acceptedEnvelope, payload)
        } catch (error) {
          const status = getLiveCoachCapabilityVerificationStatus(error)
          logger.warn(`Previously accepted ${resource.name} is no longer valid`, { status })
          await this._quarantineAcceptedEnvelope(status)
        }
      }

      const response = await api.getConfig(resource.resource)
      const envelopeResult = resource.schema.safeParse(response.data)
      if (!envelopeResult.success) {
        logger.warn(`Invalid ${resource.name} response; schema validation failed`)
        await this._quarantineAcceptedEnvelope('invalid-envelope')
        return
      }

      let payload: LiveCoachCapabilityPayload
      try {
        payload = this._verifyEnvelope(envelopeResult.data)
      } catch (error) {
        const status = getLiveCoachCapabilityVerificationStatus(error)
        logger.warn(`Rejected ${resource.name} response`, { status })
        await this._quarantineAcceptedEnvelope(status)
        return
      }

      await this._persistAccepted(envelopeResult.data, payload)
      this._accept(envelopeResult.data, payload)
      logger.info(`Updated ${resource.name}`, {
        generation: payload.generation,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        killSwitch: payload.killSwitch
      })
    } catch (error) {
      // A transport failure keeps the last safe snapshot only while it remains
      // valid. Invalid signed data is handled above and always closes access.
      logger.warn(formatSanitizedErrorLog(`Update ${resource.name} failed`, error))
    } finally {
      state.setUpdatingLiveCoachCapabilities(false)
    }
  }

  private _scheduleExpiry(payload: LiveCoachCapabilityPayload): void {
    this._clearExpiryTimer()
    const delayMs = Date.parse(payload.expiresAt) - this._now()
    if (delayMs <= 0) {
      this._setUnavailable('expired')
      return
    }

    this._expiryTimer = setTimeout(
      () => {
        this._expiryTimer = null
        if (this._now() >= Date.parse(payload.expiresAt)) {
          this._setUnavailable('expired')
        } else {
          this._scheduleExpiry(payload)
        }
      },
      Math.min(delayMs, MAX_TIMEOUT_MS)
    )
  }

  private _setUnavailable(status: Exclude<LiveCoachCapabilitySnapshotStatus, 'valid'>): void {
    this._clearExpiryTimer()
    this._context.state.setLiveCoachCapabilities(null, status)
  }

  private async _quarantineAcceptedEnvelope(
    status: Exclude<LiveCoachCapabilitySnapshotStatus, 'valid'>
  ): Promise<void> {
    // A schema, signature, rollback, or expiry failure is a trust failure rather than a transport
    // outage. Drop the in-memory and persisted snapshot before another poll can reuse it. Only the
    // outer transport-error path may keep a still-current accepted snapshot available.
    this._acceptedEnvelope = null
    this._setUnavailable(status)
    await this._deleteCachedEnvelope()
  }

  private _clearExpiryTimer(): void {
    if (this._expiryTimer) {
      clearTimeout(this._expiryTimer)
      this._expiryTimer = null
    }
  }

  private async _deleteCachedEnvelope(): Promise<void> {
    try {
      await this._context.settingService.deleteJsonConfigFile(resource.cachePath)
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog(`Failed to delete cached ${resource.name}`, error)
      )
    }
  }

  private async _deleteMetadata(): Promise<void> {
    try {
      await this._context.settingService.deleteJsonConfigFile(resource.metadataCachePath)
    } catch (error) {
      this._context.logger.warn(
        formatSanitizedErrorLog(`Failed to delete cached ${resource.name} metadata`, error)
      )
    }
  }
}
