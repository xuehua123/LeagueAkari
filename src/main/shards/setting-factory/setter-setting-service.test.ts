import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { SettingPath, SettingSchema } from '.'
import { DelayedTaskScheduler } from './delayed-task-scheduler'
import { SetterSettingService } from './setter-setting-service'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function createService<T extends object>(
  schema: SettingSchema<T>,
  obj: T,
  storageValues: Partial<Record<string, unknown>> = {}
) {
  const settingFactory = {
    _delayed: {
      add: vi.fn(),
      remove: vi.fn(),
      cancelAndWait: vi.fn(async () => undefined)
    },
    _getFromStorage: vi.fn(
      async (_namespace: string, key: SettingPath<T>, defaultValue: unknown) =>
        Object.hasOwn(storageValues, key) ? storageValues[key] : defaultValue
    ),
    _saveToStorage: vi.fn(async (_namespace: string, key: string, value: unknown) => {
      storageValues[key] = value
    }),
    _removeFromStorage: vi.fn(async (_namespace: string, key: string) => {
      delete storageValues[key]
    }),
    _getByPrefixFromStorage: vi.fn(),
    _removeByPrefixFromStorage: vi.fn(),
    _setJsonValue: vi.fn(),
    _removeJsonValue: vi.fn(),
    readFromJsonConfigFile: vi.fn(),
    writeToJsonConfigFile: vi.fn(),
    jsonConfigFileExists: vi.fn(),
    deleteJsonConfigFile: vi.fn()
  }
  const logger = {
    warn: vi.fn()
  }

  return {
    service: new SetterSettingService(
      settingFactory as any,
      'test-main',
      schema,
      obj,
      logger as any
    ),
    settingFactory,
    logger
  }
}

describe('SetterSettingService', () => {
  it('rejects invalid code defaults when a schema is declared', () => {
    expect(() =>
      createService(
        {
          count: {
            default: 'invalid' as unknown as number,
            schema: z.number()
          }
        },
        { count: 1 }
      )
    ).toThrow('Invalid default value for setting test-main/count')
  })

  it('applies storage values as-is without restore', async () => {
    const obj = { tags: { enabled: true, showSelf: true } }
    const { service, settingFactory } = createService(
      {
        tags: {
          default: obj.tags
        }
      },
      obj,
      {
        tags: { enabled: false }
      }
    )

    await service.applyToState()

    expect(obj.tags).toEqual({ enabled: false })
    expect(settingFactory._delayed.add).not.toHaveBeenCalled()
  })

  it('uses a schema default without storage correction when no value is stored', async () => {
    const obj = { enabled: false }
    const { service, settingFactory, logger } = createService(
      {
        enabled: {
          default: true,
          schema: z.boolean()
        }
      },
      obj
    )

    await service.applyToState()

    expect(obj.enabled).toBe(true)
    expect(settingFactory._saveToStorage).not.toHaveBeenCalled()
    expect(settingFactory._removeFromStorage).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('validates restored values and writes normalized output back immediately', async () => {
    const obj = { tags: { enabled: true, showSelf: true } }
    const { service, settingFactory, logger } = createService(
      {
        tags: {
          default: obj.tags,
          schema: z.object({
            enabled: z.boolean(),
            showSelf: z.boolean()
          }),
          restore: ({ value, defaultValue }) => ({
            ...defaultValue,
            ...(value as Partial<typeof defaultValue>)
          })
        }
      },
      obj,
      {
        tags: { enabled: false, legacy: true }
      }
    )

    await service.applyToState()

    expect(obj.tags).toEqual({ enabled: false, showSelf: true })
    expect(settingFactory._saveToStorage).toHaveBeenCalledWith('test-main', 'tags', {
      enabled: false,
      showSelf: true
    })
    expect(settingFactory._delayed.add).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('removes invalid stored values and falls back to the schema default', async () => {
    const obj = { enabled: false }
    const { service, settingFactory, logger } = createService(
      {
        enabled: {
          default: true,
          schema: z.boolean()
        }
      },
      obj,
      {
        enabled: 'definitely'
      }
    )

    await service.applyToState()

    expect(obj.enabled).toBe(true)
    expect(settingFactory._removeFromStorage).toHaveBeenCalledWith('test-main', 'enabled')
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'Invalid setting value, falling back to default',
      expect.objectContaining({
        namespace: 'test-main',
        key: 'enabled',
        source: 'restore'
      })
    )
  })

  it('falls back when restore cannot handle a stored value', async () => {
    const obj = { count: 0 }
    const { service, settingFactory, logger } = createService(
      {
        count: {
          default: 1,
          schema: z.number(),
          restore: () => {
            throw new Error('unrecognized legacy value')
          }
        }
      },
      obj,
      { count: 'legacy' }
    )

    await service.applyToState()

    expect(obj.count).toBe(1)
    expect(settingFactory._removeFromStorage).toHaveBeenCalledWith('test-main', 'count')
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('still applies the default when removing an invalid stored value fails', async () => {
    const obj = { enabled: false }
    const { service, settingFactory, logger } = createService(
      {
        enabled: {
          default: true,
          schema: z.boolean()
        }
      },
      obj,
      { enabled: 'invalid' }
    )
    settingFactory._removeFromStorage.mockRejectedValueOnce(
      new Error('D:\\Users\\private\\LeagueAkari.db Authorization=secret')
    )

    await service.applyToState()

    expect(obj.enabled).toBe(true)
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenLastCalledWith(
      'Failed to remove invalid setting value',
      expect.objectContaining({ namespace: 'test-main', key: 'enabled' })
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private')
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret')
  })

  it('uses explicit restore output before applying storage values to state', async () => {
    const obj = { tags: { enabled: true, showSelf: true } }
    const transform = vi.fn(({ value }) => value)
    const sideEffect = vi.fn()
    const { service, settingFactory } = createService(
      {
        tags: {
          default: obj.tags,
          restore: ({ value, defaultValue }) => ({
            ...defaultValue,
            ...(value as Partial<typeof defaultValue>)
          }),
          transform,
          sideEffect
        }
      },
      obj,
      {
        tags: { enabled: false }
      }
    )

    await service.applyToState()

    expect(obj.tags).toEqual({ enabled: false, showSelf: true })
    expect(transform).not.toHaveBeenCalled()
    expect(sideEffect).not.toHaveBeenCalled()
    expect(settingFactory._delayed.add).not.toHaveBeenCalled()
  })

  it('commits transformed values', async () => {
    const obj = { count: 1 }
    const { service, settingFactory } = createService(
      {
        count: {
          default: 1,
          transform: ({ value }) => Math.max(0, value)
        }
      },
      obj
    )

    await service.set('count', -1)

    expect(obj.count).toBe(0)
    expect(settingFactory._delayed.add).toHaveBeenCalledWith(
      'test-main/count',
      expect.any(Function),
      1000
    )
  })

  it('validates transformed values before side effects and falls back on invalid input', async () => {
    const obj = { count: 1 }
    const sideEffect = vi.fn()
    const { service, settingFactory, logger } = createService(
      {
        count: {
          default: 1,
          schema: z.number(),
          transform: ({ value }) => value,
          sideEffect
        }
      },
      obj
    )

    await service.set('count', 'invalid' as unknown as number)

    expect(obj.count).toBe(1)
    expect(sideEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: 1,
        value: 1
      })
    )
    expect(settingFactory._delayed.add).toHaveBeenCalledWith(
      'test-main/count',
      expect.any(Function),
      1000
    )
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('commits parsed output instead of the unrecognized parts of a valid input', async () => {
    const obj = { options: { enabled: false } }
    const sideEffect = vi.fn()
    const { service, logger } = createService(
      {
        options: {
          default: obj.options,
          schema: z.object({ enabled: z.boolean() }),
          sideEffect
        }
      },
      obj
    )

    await service.set('options', { enabled: true, legacy: true } as typeof obj.options)

    expect(obj.options).toEqual({ enabled: true })
    expect(sideEffect).toHaveBeenCalledWith(expect.objectContaining({ value: { enabled: true } }))
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('runs side effects before commit with transformed value', async () => {
    const obj = { count: 1 }
    const sideEffect = vi.fn(({ oldValue, value }) => {
      expect(obj.count).toBe(1)
      expect(oldValue).toBe(1)
      expect(value).toBe(2)
    })
    const { service } = createService(
      {
        count: {
          default: 1,
          transform: ({ value }) => value + 1,
          sideEffect
        }
      },
      obj
    )

    await service.set('count', 1)

    expect(sideEffect).toHaveBeenCalledTimes(1)
    expect(obj.count).toBe(2)
  })

  it('blocks commits when side effects throw', async () => {
    const obj = { count: 1 }
    const { service, settingFactory } = createService(
      {
        count: {
          default: 1,
          sideEffect: () => {
            throw new Error('side effect failed')
          }
        }
      },
      obj
    )

    await expect(service.set('count', 2)).rejects.toThrow('side effect failed')

    expect(obj.count).toBe(1)
    expect(settingFactory._delayed.add).not.toHaveBeenCalled()
  })

  it('does not restore values on set', async () => {
    const obj = { count: 1 }
    const restore = vi.fn(({ value }) => Number(value))
    const { service } = createService(
      {
        count: {
          default: 1,
          restore
        }
      },
      obj
    )

    await service.set('count', 2)

    expect(restore).not.toHaveBeenCalled()
    expect(obj.count).toBe(2)
  })

  it('returns pending setting saves before the delayed task is flushed', async () => {
    const obj = { count: 1 }
    const { service, settingFactory } = createService(
      {
        count: {
          default: 1
        }
      },
      obj,
      {
        count: 1
      }
    )

    await service.set('count', 2)

    expect(settingFactory._saveToStorage).not.toHaveBeenCalled()
    expect(await service._getFromStorage('count')).toBe(2)

    const delayedTask = settingFactory._delayed.add.mock.calls[0][1]
    await delayedTask()

    expect(settingFactory._saveToStorage).toHaveBeenCalledWith('test-main', 'count', 2)
  })

  it('returns defaults for pending setting removals before the delayed task is flushed', async () => {
    const obj = { shortcut: 'Ctrl+K' as string | null }
    const { service, settingFactory } = createService(
      {
        shortcut: {
          default: null
        }
      },
      obj,
      {
        shortcut: 'Ctrl+K'
      }
    )

    await service.set('shortcut', null)

    expect(settingFactory._removeFromStorage).not.toHaveBeenCalled()
    expect(await service._getFromStorage('shortcut')).toBeUndefined()
    expect(await service._getFromStorage('shortcut', 'fallback')).toBe('fallback')

    const delayedTask = settingFactory._delayed.add.mock.calls[0][1]
    await delayedTask()

    expect(settingFactory._removeFromStorage).toHaveBeenCalledWith('test-main', 'shortcut')
  })

  it('returns pending delayed storage saves before the delayed task is flushed', async () => {
    const obj = { trackedBounds: null as Electron.Rectangle | null }
    const oldBounds = { x: 0, y: 0, width: 100, height: 100 }
    const newBounds = { x: 10, y: 20, width: 300, height: 240 }
    const storageValues = {
      trackedBounds: oldBounds
    }
    const { service, settingFactory } = createService({}, obj, storageValues)
    // @ts-expect-error delay requires explicit milliseconds
    const invalidDelayConfig: Parameters<typeof service._saveToStorage>[2] = { delay: true }
    void invalidDelayConfig

    await service._saveToStorage('trackedBounds', newBounds, { delay: 1000 })

    expect(settingFactory._saveToStorage).not.toHaveBeenCalled()
    expect(await service._getFromStorage('trackedBounds')).toEqual(newBounds)

    const delayedTask = settingFactory._delayed.add.mock.calls[0][1]
    await delayedTask()

    expect(settingFactory._saveToStorage).toHaveBeenCalledWith(
      'test-main',
      'trackedBounds',
      newBounds
    )
    storageValues.trackedBounds = oldBounds
    expect(await service._getFromStorage('trackedBounds')).toEqual(oldBounds)
  })

  it('cancels a pending delayed storage save when an immediate save supersedes it', async () => {
    const obj = { trackedBounds: null as Electron.Rectangle | null }
    const delayedBounds = { x: 10, y: 20, width: 300, height: 240 }
    const immediateBounds = { x: 30, y: 40, width: 500, height: 360 }
    const { service, settingFactory } = createService({}, obj)

    await service._saveToStorage('trackedBounds', delayedBounds, { delay: 1000 })
    await service._saveToStorage('trackedBounds', immediateBounds)

    expect(settingFactory._delayed.cancelAndWait).toHaveBeenCalledWith('test-main/trackedBounds')
    expect(settingFactory._saveToStorage).toHaveBeenCalledWith(
      'test-main',
      'trackedBounds',
      immediateBounds
    )
    expect(await service._getFromStorage('trackedBounds')).toEqual(immediateBounds)
  })

  it('waits for an in-flight delayed write before persisting the durable replacement', async () => {
    vi.useFakeTimers()
    try {
      const obj = { enabled: true }
      const storageValues: Partial<Record<string, unknown>> = { enabled: true }
      const staleWriteStarted = deferred()
      const staleWriteCompletion = deferred()
      const { service, settingFactory } = createService(
        {
          enabled: {
            default: true,
            schema: z.boolean()
          }
        },
        obj,
        storageValues
      )
      ;(settingFactory as any)._delayed = new DelayedTaskScheduler()
      settingFactory._saveToStorage.mockImplementation(
        async (_namespace: string, key: string, value: unknown) => {
          if (value === true) {
            staleWriteStarted.resolve()
            await staleWriteCompletion.promise
          }
          storageValues[key] = value
        }
      )

      await service._saveToStorage('enabled', true, { delay: 0 })
      await vi.advanceTimersByTimeAsync(0)
      await staleWriteStarted.promise

      let completed = false
      const replacement = service.setAndPersist('enabled', false).then(() => {
        completed = true
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(obj.enabled).toBe(false)
      expect(completed).toBe(false)

      staleWriteCompletion.resolve()
      await replacement

      expect(storageValues.enabled).toBe(false)
      expect(settingFactory._saveToStorage.mock.calls.map((call) => call[2])).toEqual([true, false])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not resolve a durable set until storage has completed', async () => {
    const obj = { enabled: true }
    const persistence = deferred()
    const { service, settingFactory } = createService(
      {
        enabled: {
          default: true,
          schema: z.boolean()
        }
      },
      obj,
      { enabled: true }
    )
    settingFactory._saveToStorage.mockImplementationOnce(async () => persistence.promise)

    let completed = false
    const operation = service.setAndPersist('enabled', false).then(() => {
      completed = true
    })
    await vi.waitFor(() => {
      expect(settingFactory._saveToStorage).toHaveBeenCalledWith('test-main', 'enabled', false)
    })

    expect(obj.enabled).toBe(false)
    expect(completed).toBe(false)
    expect(settingFactory._delayed.add).not.toHaveBeenCalled()

    persistence.resolve()
    await operation

    expect(completed).toBe(true)
  })

  it('serializes concurrent durable writes for the same key in commit order', async () => {
    const obj = { enabled: true }
    const firstPersistence = deferred()
    const storageValues: Partial<Record<string, unknown>> = { enabled: true }
    const { service, settingFactory } = createService(
      {
        enabled: {
          default: true,
          schema: z.boolean()
        }
      },
      obj,
      storageValues
    )
    settingFactory._saveToStorage.mockImplementation(
      async (_namespace: string, key: string, value: unknown) => {
        if (value === false) {
          await firstPersistence.promise
        }
        storageValues[key] = value
      }
    )

    const first = service.setAndPersist('enabled', false)
    const second = service.setAndPersist('enabled', true)
    await vi.waitFor(() => {
      expect(settingFactory._saveToStorage).toHaveBeenCalledTimes(1)
    })

    expect(obj.enabled).toBe(true)
    expect(settingFactory._saveToStorage.mock.calls.map((call) => call[2])).toEqual([false])

    firstPersistence.resolve()
    await Promise.all([first, second])

    expect(storageValues.enabled).toBe(true)
    expect(settingFactory._saveToStorage.mock.calls.map((call) => call[2])).toEqual([false, true])
  })

  it('rejects a durable set while keeping the in-memory state fail-closed', async () => {
    const obj = { enabled: true }
    const { service, settingFactory } = createService(
      {
        enabled: {
          default: true,
          schema: z.boolean()
        }
      },
      obj,
      { enabled: true }
    )
    settingFactory._saveToStorage.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(service.setAndPersist('enabled', false)).rejects.toThrow('storage unavailable')

    expect(obj.enabled).toBe(false)
    expect(await service.get('enabled')).toBe(false)
    expect(settingFactory._delayed.add).not.toHaveBeenCalled()
  })

  it('restores durable fail-closed consent values after a simulated restart', async () => {
    type ConsentSettings = {
      enabled: boolean
      onboardingCompleted: boolean
      privacyConsentVersion: string | null
    }
    const schema: SettingSchema<ConsentSettings> = {
      enabled: { default: false, schema: z.boolean() },
      onboardingCompleted: { default: false, schema: z.boolean() },
      privacyConsentVersion: { default: null, schema: z.string().nullable() }
    }
    const storageValues: Partial<Record<string, unknown>> = {
      enabled: true,
      onboardingCompleted: true,
      privacyConsentVersion: '1.0.0'
    }
    const runningState: ConsentSettings = {
      enabled: true,
      onboardingCompleted: true,
      privacyConsentVersion: '1.0.0'
    }
    const { service } = createService(schema, runningState, storageValues)

    await Promise.all([
      service.setAndPersist('enabled', false),
      service.setAndPersist('onboardingCompleted', false),
      service.setAndPersist('privacyConsentVersion', null)
    ])

    const restartedState: ConsentSettings = {
      enabled: true,
      onboardingCompleted: true,
      privacyConsentVersion: '1.0.0'
    }
    const { service: restartedService } = createService(schema, restartedState, storageValues)
    await restartedService.applyToState()

    expect(restartedState).toEqual({
      enabled: false,
      onboardingCompleted: false,
      privacyConsentVersion: null
    })
  })
})
