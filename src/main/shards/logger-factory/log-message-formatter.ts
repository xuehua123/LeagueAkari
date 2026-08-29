import { formatError } from '@shared/utils/errors'

const SENSITIVE_KEY_PATTERN =
  /(["']?\b(?:access[_-]?token|auth[_-]?token|riot[_-]?token|api[_-]?token|authorization|client[_-]?secret|password|secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi

export class LogMessageFormatter {
  objectsToString(...args: any[]) {
    const rendered = args
      .map((arg) => {
        if (arg instanceof Error || this._isLikelyErrorObject(arg)) {
          return formatError(arg)
        }

        if (typeof arg === 'undefined') {
          return 'undefined'
        }

        if (typeof arg === 'function') {
          return arg.toString()
        }

        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2)
          } catch {
            return `[Cannot stringify: ${arg}]`
          }
        }

        return arg
      })
      .join(' ')

    return sanitizeLogMessage(rendered)
  }

  private _isLikelyErrorObject(obj: any) {
    if (!obj || typeof obj !== 'object') {
      return false
    }

    const props = Object.getOwnPropertyNames(obj)

    const hasStack = props.includes('stack') && typeof obj.stack === 'string'
    const hasMessage = props.includes('message') && typeof obj.message === 'string'

    if (hasStack || hasMessage) {
      return true
    }

    return false
  }
}

/**
 * LoggerFactory 是所有主进程日志的最后一道边界。调用方即使误传了底层异常或对象，
 * 也不能把本机路径、远程 URL 或凭据写入持久日志。
 */
export function sanitizeLogMessage(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '[redacted-token]')
    .replace(SENSITIVE_KEY_PATTERN, '$1[redacted]')
    .replace(/\bfile:\/\/\/?[^\s,;)"'<>]+/gi, '[local-path]')
    .replace(/\\\\[^\\\s]+\\[^\r\n,;)"'<>]*/g, '[local-path]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;)"'<>|]*/g, '[local-path]')
    .replace(
      /(^|[\s("'`])\/(?:Users|home|tmp|var|opt|private|Applications|Volumes)\/[^\r\n,;)"'`<>]*/gim,
      '$1[local-path]'
    )
    .replace(/\bhttps?:\/\/[^\s,;)"'<>]+/gi, '[url]')
}
