import type { LoggerRenderer } from '../logger'
import { type AkariIpcRendererContext, LOGGER_SHARD_NAMESPACE } from './context'
import type { IpcMainDataType } from './types'

export class AkariIpcRendererCallService {
  constructor(private readonly _context: AkariIpcRendererContext) {}

  async call<T = any>(namespace: string, fnName: string, ...args: any[]) {
    const result: IpcMainDataType<T> = await window.electron.ipcRenderer.invoke(
      'akariCall',
      namespace,
      fnName,
      ...args
    )

    if (result.success) {
      return result.data as T
    }

    // axios 错误将不会触发特殊日志
    if (result.isAxiosError) {
      throw result.error
    }

    if (import.meta.env.DEV) {
      // for lazy loading
      const logger = this._context.shared.manager.getInstance(
        LOGGER_SHARD_NAMESPACE
      ) as LoggerRenderer
      // IPC arguments may contain access tokens, local file grants, player identifiers, or user
      // content. The main-process handler owns stable error classification, so renderer diagnostics
      // record only routing metadata and never serialize args or the raw error/stack.
      logger?.warn('ipc call failed', { namespace, fnName })
    }

    throw result.error
  }
}
