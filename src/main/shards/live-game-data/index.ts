import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { LiveGameDomain, LiveGameSnapshot } from '@shared/types/live-game-data'

import { GameClientMain } from '../game-client'
import { LeagueClientMain } from '../league-client'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { LIVE_GAME_DATA_MAIN_NAMESPACE, type LiveGameDataMainContext } from './context'
import { LiveGameDataPollingController } from './polling-controller'
import { LiveGameDataState } from './state'

/**
 * 实时对局数据 Shard（负责从 2999 端口轮询 Live Client Data 并向主进程模块提供归一化快照与订阅）
 */
@Shard(LiveGameDataMain.id)
export class LiveGameDataMain implements IAkariShardInitDispose {
  static id = LIVE_GAME_DATA_MAIN_NAMESPACE

  private readonly _logger: AkariLogger
  private readonly _context: LiveGameDataMainContext
  private readonly _pollingController: LiveGameDataPollingController

  public readonly state = new LiveGameDataState()

  constructor(
    _loggerFactory: LoggerFactoryMain,
    private readonly _leagueClient: LeagueClientMain,
    private readonly _gameClient: GameClientMain,
    private readonly _mobxUtils: MobxUtilsMain
  ) {
    this._logger = _loggerFactory.create(LiveGameDataMain.id)

    this._context = {
      namespace: LiveGameDataMain.id,
      logger: this._logger,
      state: this.state,
      leagueClient: this._leagueClient,
      gameClient: this._gameClient,
      mobxUtils: this._mobxUtils
    }

    this._pollingController = new LiveGameDataPollingController(this._context)
  }

  public async onInit(): Promise<void> {
    this._logger.info('Initializing LiveGameDataMain')
    this._pollingController.init()
  }

  public async onDispose(): Promise<void> {
    this._logger.info('Disposing LiveGameDataMain')
    this._pollingController.dispose()
  }

  /**
   * Main-only 类型安全的 domain 数据订阅方法
   * @param domain 关注的数据域 ('game-stats' | 'players' | 'events' | 'active-player')
   * @param listener 快照变更回调函数
   * @returns 取消订阅的 disposer 函数
   */
  public subscribe(
    domain: LiveGameDomain,
    listener: (snapshot: LiveGameSnapshot) => void
  ): () => void {
    return this._pollingController.subscribe(domain, listener)
  }
}
