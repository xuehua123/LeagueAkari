import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { protocol } from 'electron'
import { Readable } from 'node:stream'

import { AkariIpcMain } from '../ipc'
import {
  AKARI_PROTOCOL_MAIN_NAMESPACE,
  AKARI_PROXY_PROTOCOL,
  type AkariProtocolDomainHandler
} from './context'
import { createLocalFileDomainHandler } from './local-file-domain'
import {
  type LocalFileGrantDescriptor,
  type LocalFileGrantPurpose,
  LocalFileGrantRegistry
} from './local-file-grants'
import { AkariProtocolRouter } from './protocol-router'

/**
 * 实现 `akari://` 协议, 用户特殊资源的代理
 * akari://local/* 仅代理 main 进程签发的短期单文件 capability token
 * akari://league-client/* 代理到 LeagueClient 的 HTTP 服务
 * akari://riot-client/* 代理到 RiotClient 的 HTTP 服务
 */
@Shard(AkariProtocolMain.id)
export class AkariProtocolMain implements IAkariShardInitDispose {
  static id = AKARI_PROTOCOL_MAIN_NAMESPACE

  static AKARI_PROXY_PROTOCOL = AKARI_PROXY_PROTOCOL

  private readonly _router = new AkariProtocolRouter()
  private readonly _localFileGrants = new LocalFileGrantRegistry()

  constructor(private readonly _ipc: AkariIpcMain) {}

  async onInit(): Promise<void> {
    this.registerDomain('local', createLocalFileDomainHandler(this._localFileGrants))
    this._ipc.onCall(AkariProtocolMain.id, 'cancelProxyRequest', (_, requestId: string) => {
      return this.cancelProxyRequest(requestId)
    })
  }

  async onDispose(): Promise<void> {
    this._localFileGrants.clear()
  }

  issueLocalFileGrant(
    filePath: string,
    purpose: LocalFileGrantPurpose
  ): Promise<LocalFileGrantDescriptor> {
    return this._localFileGrants.issue(filePath, purpose)
  }

  resolveLocalFileGrant(token: string, allowedPurposes: readonly LocalFileGrantPurpose[]) {
    return this._localFileGrants.resolve(token, allowedPurposes)
  }

  revokeLocalFileGrant(token: string): boolean {
    return this._localFileGrants.revoke(token)
  }

  revokeLocalFileGrantsByPurposes(purposes: readonly LocalFileGrantPurpose[]): number {
    return this._localFileGrants.revokeByPurposes(purposes)
  }

  static convertWebStreamToNodeStream(readableStream: ReadableStream): Readable {
    const reader = readableStream.getReader()

    const nodeStream = Readable.from({
      async *[Symbol.asyncIterator]() {
        while (true) {
          try {
            const { done, value } = await reader.read()
            if (done) break
            yield value
          } catch {
            break
          }
        }
      }
    })

    return nodeStream
  }

  static convertNodeStreamToWebStream(nodeStream: Readable): ReadableStream {
    return new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => controller.enqueue(chunk))
        nodeStream.on('end', () => controller.close())
        nodeStream.on('error', (err) => controller.error(err))
      },
      cancel(reason) {
        nodeStream.destroy(reason)
      }
    })
  }

  registerPartition(partition: string) {
    this._router.registerPartition(partition)
  }

  unregisterPartition(partition: string) {
    this._router.unregisterPartition(partition)
  }

  registerDomain(domain: string, handler: AkariProtocolDomainHandler) {
    this._router.registerDomain(domain, handler)
  }

  unregisterDomain(domain: string) {
    this._router.unregisterDomain(domain)
  }

  cancelProxyRequest(requestId: string) {
    return this._router.cancelProxyRequest(requestId)
  }

  static shouldNotHaveBody(code: number) {
    return (code >= 100 && code < 200) || code === 204 || code === 205 || code === 304
  }

  static register() {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: AkariProtocolMain.AKARI_PROXY_PROTOCOL,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          stream: true,
          bypassCSP: true
        }
      }
    ])
  }
}

export * from './local-file-grants'
