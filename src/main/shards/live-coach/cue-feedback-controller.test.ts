import { describe, expect, it, vi } from 'vitest'

import { CueFeedbackController } from './cue-feedback-controller'

describe('CueFeedbackController', () => {
  it('persists feedback with rule evidence and supports idempotent submit, withdraw, and delete', async () => {
    const writes: unknown[] = []
    const settingService = {
      jsonConfigFileExists: vi.fn().mockResolvedValue(false),
      writeToJsonConfigFile: vi.fn(async (_filename: string, document: unknown) => {
        writes.push(document)
      }),
      deleteJsonConfigFile: vi.fn().mockResolvedValue(undefined)
    }
    const context = {
      settingService,
      logger: { warn: vi.fn() }
    } as any
    const scheduler = {
      getCue: vi.fn().mockReturnValue({
        id: 'cue-1',
        sessionId: 'session-1',
        ruleId: 'fog-risk',
        ruleVersion: '2.1',
        evidenceIds: ['last-seen-1', 'route-1']
      })
    } as any
    const controller = new CueFeedbackController(context, scheduler)
    await controller.init()

    const submitted = await controller.submit({ cueId: 'cue-1', type: 'incorrect' })
    const duplicate = await controller.submit({ cueId: 'cue-1', type: 'incorrect' })

    expect(duplicate.id).toBe(submitted.id)
    expect(submitted).toMatchObject({
      cueId: 'cue-1',
      ruleId: 'fog-risk',
      ruleVersion: '2.1',
      evidenceIds: ['last-seen-1', 'route-1'],
      status: 'active'
    })
    expect(controller.list({ cueId: 'cue-1' })).toHaveLength(1)
    expect(writes).toHaveLength(1)

    const withdrawn = await controller.withdraw(submitted.id)
    expect(withdrawn).toMatchObject({ status: 'withdrawn' })

    expect(await controller.delete(submitted.id)).toBe(true)
    expect(controller.list()).toEqual([])
    expect(settingService.writeToJsonConfigFile).toHaveBeenCalledTimes(3)

    await controller.submit({ cueId: 'cue-1', type: 'useful' })
    expect(await controller.clear()).toBe(1)
    expect(settingService.deleteJsonConfigFile).toHaveBeenCalledWith('cue-feedback.json')
  })

  it('restores valid persisted feedback and removes records beyond retention', async () => {
    const now = Date.now()
    const recent = {
      id: 'feedback-recent',
      cueId: 'cue-recent',
      sessionId: 'session',
      ruleId: 'rule',
      ruleVersion: '1',
      evidenceIds: [],
      type: 'useful',
      comment: null,
      status: 'active',
      createdAt: now,
      withdrawnAt: null
    }
    const expired = { ...recent, id: 'feedback-expired', createdAt: 0 }
    const settingService = {
      jsonConfigFileExists: vi.fn().mockResolvedValue(true),
      readFromJsonConfigFile: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        feedback: [recent, expired]
      }),
      writeToJsonConfigFile: vi.fn().mockResolvedValue(undefined)
    }
    const controller = new CueFeedbackController(
      { settingService, logger: { warn: vi.fn() } } as any,
      { getCue: vi.fn() } as any
    )

    await controller.init()

    expect(controller.list()).toEqual([recent])
    expect(settingService.writeToJsonConfigFile).toHaveBeenCalledOnce()
  })

  it('rolls back in-memory feedback when persistence fails', async () => {
    const settingService = {
      jsonConfigFileExists: vi.fn().mockResolvedValue(false),
      writeToJsonConfigFile: vi.fn().mockRejectedValue(new Error('disk full'))
    }
    const controller = new CueFeedbackController(
      { settingService, logger: { warn: vi.fn() } } as any,
      {
        getCue: vi.fn().mockReturnValue({
          id: 'cue-1',
          sessionId: 'session-1',
          ruleId: 'rule',
          ruleVersion: '1',
          evidenceIds: []
        })
      } as any
    )

    await controller.init()
    await expect(controller.submit({ cueId: 'cue-1', type: 'incorrect' })).rejects.toThrow(
      'disk full'
    )
    expect(controller.list()).toEqual([])
  })
})
