import { describe, expect, it } from 'vitest'

import {
  createSanitizedPublicError,
  createWorkerPublicError,
  formatSanitizedErrorLog,
  sanitizeCaughtErrorDetails,
  sanitizePublicErrorDetails
} from './public-error'

describe('minimap public errors', () => {
  it('maps worker failures to fixed public codes without exposing raw worker details', () => {
    const error = createWorkerPublicError(
      {
        type: 'error',
        code: 'LC_ERR_IDENTITY_MODEL_LOAD_FAILED',
        stage: 'model-load',
        recoverable: true,
        details:
          'ENOENT C:\\Users\\private\\models\\champion.onnx authToken=secret\n    at loadModel (worker.js:1:1)'
      },
      1234
    )

    expect(error).toEqual({
      code: 'internal-error',
      stage: 'minimap-identity-model',
      recoverable: true,
      occurredAt: 1234,
      details: null
    })
    expect(JSON.stringify(error)).not.toContain('private')
    expect(JSON.stringify(error)).not.toContain('secret')
  })

  it('redacts paths, URLs, tokens, and stack lines from non-worker public details', () => {
    expect(
      sanitizePublicErrorDetails(
        'Failed at D:\\Users\\private\\model.onnx via https://example.test/?token=secret authToken=abc\n    at worker.js:1:1'
      )
    ).toBe('Failed at [local-path]')
    expect(sanitizePublicErrorDetails('Authorization=abc via https://example.test/private')).toBe(
      'Authorization=[redacted] via [url]'
    )

    expect(
      createSanitizedPublicError(
        {
          code: 'internal-error',
          stage: 'Unsafe Stage / C:\\private',
          recoverable: false,
          details: '/Users/private/model.onnx'
        },
        42
      )
    ).toEqual({
      code: 'internal-error',
      stage: 'unsafe-stage---c--private',
      recoverable: false,
      occurredAt: 42,
      details: '[local-path]'
    })
  })

  it.each([
    ['Windows path', new Error('Cannot open C:\\Users\\private\\model.onnx'), '[local-path]'],
    ['Unix path', new Error('Cannot open /home/private/model.onnx'), '[local-path]'],
    [
      'URL and token',
      new Error('Authorization=private-token via https://example.test/private'),
      'Authorization=[redacted] via [url]'
    ]
  ])('sanitizes %s before formatting a log message', (_name, error, expected) => {
    const details = sanitizeCaughtErrorDetails(error)
    const logMessage = formatSanitizedErrorLog('Capture failed', error)

    expect(details).toContain(expected)
    expect(logMessage).toBe(`Capture failed: ${details}`)
    expect(logMessage).not.toContain('private')
  })

  it('does not stringify arbitrary thrown objects into logs', () => {
    expect(
      formatSanitizedErrorLog('Capture failed', {
        message: 'C:\\Users\\private\\model.onnx',
        token: 'private-token'
      })
    ).toBe('Capture failed')
  })
})
