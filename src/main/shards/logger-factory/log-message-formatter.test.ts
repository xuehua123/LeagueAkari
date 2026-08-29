import { describe, expect, it } from 'vitest'

import { LogMessageFormatter, sanitizeLogMessage } from './log-message-formatter'

describe('LogMessageFormatter privacy boundary', () => {
  it('redacts local paths, URLs, tokens, and stack paths from errors', () => {
    const formatter = new LogMessageFormatter()
    const error = new Error(
      'Cannot open D:\\Users\\private\\LeagueAkari.db Authorization=secret via https://example.test/private'
    )
    error.stack = `${error.message}\n    at load (D:\\src\\private\\worker.ts:1:2)`

    const output = formatter.objectsToString('Storage failed', error)

    expect(output).toContain('Storage failed')
    expect(output).toContain('[local-path]')
    expect(output).not.toContain('private')
    expect(output).not.toContain('secret')
    expect(output).not.toContain('example.test')
  })

  it('redacts sensitive values nested in ordinary structured log arguments', () => {
    const formatter = new LogMessageFormatter()
    const output = formatter.objectsToString({
      namespace: 'live-coach-main',
      patch: '16.17.1',
      path: '/home/private/replay.webm',
      authToken: 'private-token',
      endpoint: 'https://example.test/private'
    })

    expect(output).toContain('live-coach-main')
    expect(output).toContain('16.17.1')
    expect(output).toContain('[local-path]')
    expect(output).toContain('[redacted]')
    expect(output).toContain('[url]')
    expect(output).not.toContain('private-token')
    expect(output).not.toContain('example.test')
  })

  it('redacts common bearer, JWT, API-key, UNC, and file URL forms', () => {
    const output = sanitizeLogMessage(
      'Bearer abc.def sk-1234567890abcdefghijkl eyJabc.def.ghi \\\\server\\share\\secret file:///C:/Users/private/file'
    )

    expect(output).not.toContain('abc.def')
    expect(output).not.toContain('1234567890abcdefghijkl')
    expect(output).not.toContain('eyJabc')
    expect(output).not.toContain('server')
    expect(output).not.toContain('Users/private')
  })
})
