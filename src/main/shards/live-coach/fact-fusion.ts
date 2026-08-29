import {
  CoachEvidence,
  CustomItemBuilds,
  FogInference,
  ItemGuidanceMode,
  ItemPurchaseGuidance,
  ItemPurchasePlan,
  MinimapDerivedEvent,
  MinimapEntityObservation,
  MinimapObservationBatch,
  NormalizedMapPoint
} from '@shared/types/live-coach'
import {
  LiveGameSnapshot,
  NormalizedActivePlayer,
  NormalizedGameEvent,
  NormalizedPlayer
} from '@shared/types/live-game-data'

import {
  CURRENT_LIVE_COACH_PATCH,
  CURRENT_RIOT_ITEM_CATALOG,
  getChampionRole
} from './catalog/current'
import { RecipeTreeEngine } from './catalog/recipe-tree'

export interface ObjectiveSchedule {
  name: string
  nextSpawnGameTime: number
  isAlive: boolean
}

export interface ChampionBuildDefinition {
  archetype: 'fighter' | 'mage' | 'marksman' | 'tank' | 'assassin' | 'support'
  coreItems: Array<{
    id: number
    name: string
    cost: number
    components: Array<{ id: number; name: string; cost: number }>
    reason: string
  }>
  boots: { id: number; name: string; cost: number; reason: string }
}

export interface ItemGuidancePreferences {
  mode: ItemGuidanceMode
  customItemBuilds: CustomItemBuilds
  systemRecommendedItemIds: Record<string, number[]>
}

const CHAMPION_BUILDS: Record<string, ChampionBuildDefinition> = {
  fighter: {
    archetype: 'fighter',
    coreItems: [
      {
        id: 6631, // 挺进破坏者 (Riot 16.17.1: 3300g)
        name: '挺进破坏者',
        cost: 3300,
        components: [
          { id: 3077, name: '提亚马特', cost: 1200 }, // 提亚马特 3077
          { id: 3044, name: '净蚀', cost: 1100 },
          { id: 1042, name: '短剑', cost: 250 }
        ],
        reason: '核心减速留人与清线战力'
      },
      {
        id: 3071, // 黑色切割者 (Riot 16.17.1: 3000g)
        name: '黑色切割者',
        cost: 3000,
        components: [
          { id: 3044, name: '净蚀', cost: 1100 },
          { id: 3067, name: '燃烧宝石', cost: 800 }, // 燃烧宝石 3067
          { id: 1037, name: '十字镐', cost: 875 } // 十字镐 1037
        ],
        reason: '破甲与移速提升'
      }
    ],
    boots: { id: 3047, name: '铁板靴', cost: 1200, reason: '物理抗性与减伤' } // 铁板靴 1200g
  },
  mage: {
    archetype: 'mage',
    coreItems: [
      {
        id: 6655, // 卢登的回声 (Riot 16.17.1: 2750g)
        name: '卢登的回声',
        cost: 2750,
        components: [
          { id: 3802, name: '遗失的章节', cost: 1200 }, // 遗失的章节 3802
          { id: 3145, name: '海克斯科技发电机', cost: 1100 }
        ],
        reason: '法力续航与爆发伤害支点'
      },
      {
        id: 4645, // 影焰 (Riot 16.17.1: 3200g)
        name: '影焰',
        cost: 3200,
        components: [
          { id: 3145, name: '海克斯科技发电机', cost: 1100 },
          { id: 1058, name: '无用大棒', cost: 1200 } // 无用大棒 1200g
        ],
        reason: '高额法强与暴击斩杀'
      }
    ],
    boots: { id: 3020, name: '法师之靴', cost: 1100, reason: '法术穿透' }
  },
  marksman: {
    archetype: 'marksman',
    coreItems: [
      {
        id: 3031, // 无尽之刃 (Riot 16.17.1: 3500g)
        name: '无尽之刃',
        cost: 3500,
        components: [
          { id: 1038, name: '暴风之剑', cost: 1300 },
          { id: 1037, name: '十字镐', cost: 875 },
          { id: 1018, name: '灵巧披风', cost: 600 } // 灵巧披风 1018
        ],
        reason: '核心高额暴击伤害提升'
      },
      {
        id: 6672, // 海妖杀手 (Riot 16.17.1: 3000g)
        name: '海妖杀手',
        cost: 3000,
        components: [
          { id: 6690, name: '剑翎', cost: 775 }, // 剑翎 6690
          { id: 3051, name: '缚炉之斧', cost: 1200 }, // 缚炉之斧 3051
          { id: 1043, name: '反曲之弓', cost: 700 } // 反曲之弓 1043
        ],
        reason: '持续攻速与击中特效输出'
      }
    ],
    boots: { id: 3006, name: '狂战士胫甲', cost: 1100, reason: '攻速提升' }
  },
  tank: {
    archetype: 'tank',
    coreItems: [
      {
        id: 3068, // 日炎圣盾 (Riot 16.17.1: 2800g)
        name: '日炎圣盾',
        cost: 2800,
        components: [
          { id: 6660, name: '斑比的熔渣', cost: 900 }, // 斑比的熔渣 6660
          { id: 1031, name: '锁子甲', cost: 800 },
          { id: 1028, name: '红水晶', cost: 400 }
        ],
        reason: '持续魔法伤害与坦度'
      },
      {
        id: 3083, // 狂徒铠甲 (Riot 16.17.1: 3100g)
        name: '狂徒铠甲',
        cost: 3100,
        components: [
          { id: 3801, name: '晶体护腕', cost: 800 }, // 晶体护腕 3801
          { id: 1011, name: '巨人腰带', cost: 900 }, // 巨人腰带 1011
          { id: 1011, name: '巨人腰带', cost: 900 } // 巨人腰带 1011 (第2件)
        ],
        reason: '脱战高额生命恢复'
      }
    ],
    boots: { id: 3111, name: '水银之靴', cost: 1250, reason: '韧性与魔抗' } // 水银之靴 1250g
  },
  assassin: {
    archetype: 'assassin',
    coreItems: [
      {
        id: 3142, // 幽梦之灵 (Riot 16.17.1: 2800g)
        name: '幽梦之灵',
        cost: 2800,
        components: [
          { id: 3134, name: '锯齿短匕', cost: 1000 },
          { id: 6690, name: '剑翎', cost: 775 }, // 剑翎 6690
          { id: 1036, name: '长剑', cost: 350 }
        ],
        reason: '爆发穿甲与高额游走移速'
      },
      {
        id: 3814, // 夜之锋刃 (Riot 16.17.1: 3000g)
        name: '夜之锋刃',
        cost: 3000,
        components: [
          { id: 3134, name: '锯齿短匕', cost: 1000 },
          { id: 2021, name: '掘道钻头', cost: 1150 } // 掘道钻头 2021
        ],
        reason: '法术护盾防先手'
      }
    ],
    boots: { id: 3158, name: '明朗之靴', cost: 900, reason: '技能急速' }
  },
  support: {
    archetype: 'support',
    coreItems: [
      {
        id: 3504, // 炽热香炉 (Riot 16.17.1: 2200g)
        name: '炽热香炉',
        cost: 2200,
        components: [
          { id: 3113, name: '以太精魂', cost: 900 }, // 以太精魂 900g
          { id: 3114, name: '禁忌雕像', cost: 600 } // 禁忌雕像 600g
        ],
        reason: '护盾强度与友方攻速增益'
      },
      {
        id: 6617, // 月石再生器 (Riot 16.17.1: 2200g)
        name: '月石再生器',
        cost: 2200,
        components: [
          { id: 3067, name: '燃烧宝石', cost: 800 },
          { id: 4642, name: '班德尔玻璃镜', cost: 900 } // 班德尔玻璃镜 900g
        ],
        reason: '连锁治疗与护盾扩散'
      }
    ],
    boots: { id: 3158, name: '明朗之靴', cost: 900, reason: '技能与召唤师技能急速' }
  }
}

function normalizeTeamName(rawTeam: unknown): 'ORDER' | 'CHAOS' | 'UNKNOWN' {
  if (typeof rawTeam !== 'string') return 'UNKNOWN'
  const upper = rawTeam.toUpperCase()
  if (upper.includes('ORDER') || upper === '100' || upper === 'BLUE') return 'ORDER'
  if (upper.includes('CHAOS') || upper === '200' || upper === 'RED') return 'CHAOS'
  return 'UNKNOWN'
}

export function findActivePlayerRecord(snapshot: LiveGameSnapshot): NormalizedPlayer | null {
  const active = snapshot.activePlayer
  if (!active) return null

  const identityMatch = snapshot.players.find(
    (player) =>
      (Boolean(active.summonerName) && player.summonerName === active.summonerName) ||
      (Boolean(active.riotId) && player.riotId === active.riotId) ||
      (Boolean(active.riotIdGameName) &&
        player.riotIdGameName === active.riotIdGameName &&
        (!active.riotIdTagLine || player.riotIdTagLine === active.riotIdTagLine))
  )
  if (identityMatch) return identityMatch

  if (active.championName) {
    return (
      snapshot.players.find(
        (player) => player.championName.toLowerCase() === active.championName.toLowerCase()
      ) ?? null
    )
  }
  return null
}

export class FactFusionEngine {
  private readonly _evidences = new Map<string, CoachEvidence>()
  private readonly _fogInferences = new Map<string, FogInference>()
  private readonly _minimapEvents = new Map<string, MinimapDerivedEvent>()
  private _fogInferenceEnabled = true
  private _latestLiveGameSnapshot: LiveGameSnapshot | null = null
  private _latestMinimapBatch: MinimapObservationBatch | null = null
  private _latestItemGuidance: ItemPurchaseGuidance | null = null
  private _itemGuidancePlanKey: string | null = null
  private _itemGuidanceEvidenceIds: string[] = []
  private readonly _trackIdToEvidenceId = new Map<string, string>()
  private readonly _deadEnemyChampionIds = new Set<number>()
  private readonly _deadEnemyIdentityKeys = new Set<string>()
  private _itemGuidancePreferences: ItemGuidancePreferences = {
    mode: 'adaptive',
    customItemBuilds: {},
    systemRecommendedItemIds: {}
  }

  // 记录历史可见轨迹以计算速度向量
  private readonly _lastSeenEnemies = new Map<
    string,
    {
      trackId: string
      lastObservedAt: number
      prevObservedAt?: number
      point: NormalizedMapPoint
      prevPoint?: NormalizedMapPoint
      championId: number | null
      regionId: string | null
    }
  >()

  /** 证据失效回调（通知调度器撤销受影响的 Cue） */
  public onEvidenceInvalidated?: (invalidatedEvidenceIds: string[]) => void

  public reset(): void {
    this._evidences.clear()
    this._fogInferences.clear()
    this._minimapEvents.clear()
    this._latestLiveGameSnapshot = null
    this._latestMinimapBatch = null
    this._latestItemGuidance = null
    this._itemGuidancePlanKey = null
    this._itemGuidanceEvidenceIds = []
    this._trackIdToEvidenceId.clear()
    this._lastSeenEnemies.clear()
    this._deadEnemyChampionIds.clear()
    this._deadEnemyIdentityKeys.clear()
  }

  public configureItemGuidance(preferences: ItemGuidancePreferences): void {
    this._itemGuidancePreferences = preferences
  }

  public configureFogInference(enabled: boolean): void {
    this._fogInferenceEnabled = enabled
    if (!enabled) {
      const invalidatedIds: string[] = []
      for (const [id, evidence] of this._evidences.entries()) {
        if (evidence.source === 'fog-inference') {
          this._evidences.delete(id)
          invalidatedIds.push(id)
        }
      }
      this._fogInferences.clear()
      if (invalidatedIds.length > 0) {
        this.onEvidenceInvalidated?.(invalidatedIds)
      }
    }
  }

  public invalidateLiveGameData(): void {
    const invalidatedIds: string[] = []
    for (const [id, evidence] of this._evidences.entries()) {
      if (evidence.source === 'live-client-data' || evidence.source === 'item-guidance') {
        this._evidences.delete(id)
        invalidatedIds.push(id)
      }
    }
    this._latestLiveGameSnapshot = null
    this._latestItemGuidance = null
    this._itemGuidancePlanKey = null
    this._itemGuidanceEvidenceIds = []
    this._deadEnemyChampionIds.clear()
    this._deadEnemyIdentityKeys.clear()
    if (invalidatedIds.length > 0) {
      this.onEvidenceInvalidated?.(invalidatedIds)
    }
  }

  public invalidateMinimapData(): void {
    const invalidatedIds: string[] = []
    for (const [id, evidence] of this._evidences.entries()) {
      if (evidence.source === 'minimap' || evidence.source === 'fog-inference') {
        this._evidences.delete(id)
        invalidatedIds.push(id)
      }
    }

    this._latestMinimapBatch = null
    this._fogInferences.clear()
    this._minimapEvents.clear()
    this._lastSeenEnemies.clear()
    this._trackIdToEvidenceId.clear()
    if (invalidatedIds.length > 0) {
      this.onEvidenceInvalidated?.(invalidatedIds)
    }
  }

  public updateLiveGameSnapshot(snapshot: LiveGameSnapshot, virtualNow?: number): void {
    this._latestLiveGameSnapshot = snapshot
    const now = virtualNow ?? Date.now()

    // 1. 同步玩家经济与状态证据
    if (snapshot.activePlayer) {
      const activeEviId = `evi_active_player_${now}`
      this.addEvidence({
        id: activeEviId,
        sessionId: snapshot.sessionId,
        temporalScope: 'current',
        source: 'live-client-data',
        kind: 'player-economy-inventory',
        confidence: 1,
        patch: snapshot.patch || 'unknown',
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        freshness: { expiresAt: now + 35000, state: 'fresh' },
        payload: snapshot.activePlayer
      })
    }

    // 2. 处理击杀事件与死亡玩家，实时撤销阵亡英雄在迷雾中的推断与关联证据
    const matchingActivePlayer = findActivePlayerRecord(snapshot)
    const activeTeam = normalizeTeamName(matchingActivePlayer?.team ?? snapshot.activePlayer?.team)
    const enemyTeam =
      activeTeam === 'ORDER' ? 'CHAOS' : activeTeam === 'CHAOS' ? 'ORDER' : 'UNKNOWN'
    const deadChampionIds = new Set<number>()
    const deadIdentityKeys = new Set<string>()
    for (const p of snapshot.players) {
      if (enemyTeam === 'UNKNOWN' || normalizeTeamName(p.team) !== enemyTeam) {
        continue
      }
      if (p.isDead || (p.respawnTimer && p.respawnTimer > 0)) {
        if (p.championId) deadChampionIds.add(p.championId)
        deadIdentityKeys.add(p.championName.toLowerCase())
        deadIdentityKeys.add(p.summonerName.toLowerCase())
      }
    }

    const hasNewEnemyDeath =
      [...deadChampionIds].some((id) => !this._deadEnemyChampionIds.has(id)) ||
      [...deadIdentityKeys].some((key) => !this._deadEnemyIdentityKeys.has(key))

    const invalidatedIds: string[] = []
    for (const [trackId, lastSeen] of this._lastSeenEnemies.entries()) {
      const isDead =
        (lastSeen.championId && deadChampionIds.has(lastSeen.championId)) ||
        deadIdentityKeys.has(trackId.toLowerCase()) ||
        (!lastSeen.championId && hasNewEnemyDeath)

      if (isDead) {
        const fog = this._fogInferences.get(trackId)
        if (fog) {
          invalidatedIds.push(`evi_fog_${fog.id}`)
          invalidatedIds.push(...fog.basisEvidenceIds)
          this._fogInferences.delete(trackId)
        }
        this._lastSeenEnemies.delete(trackId)
      }
    }

    if (invalidatedIds.length > 0 && this.onEvidenceInvalidated) {
      this.onEvidenceInvalidated(invalidatedIds)
    }

    this._deadEnemyChampionIds.clear()
    for (const championId of deadChampionIds) this._deadEnemyChampionIds.add(championId)
    this._deadEnemyIdentityKeys.clear()
    for (const identityKey of deadIdentityKeys) this._deadEnemyIdentityKeys.add(identityKey)

    // 3. 运行动态装备流派与组件抵扣计算
    this._computeItemGuidance(snapshot, now)
  }

  public updateMinimapBatch(batch: MinimapObservationBatch, virtualNow?: number): void {
    const now = virtualNow ?? Date.now()
    const invalidatedEvidenceIds: string[] = []

    if (batch.health !== 'healthy') {
      this.invalidateMinimapData()
      return
    }

    this._latestMinimapBatch = batch

    for (const event of batch.events) {
      const observedAt = Math.min(event.timestamp, now)
      const expiresAt = observedAt + 10000
      if (expiresAt <= now || this._minimapEvents.has(event.eventId)) continue
      this._minimapEvents.set(event.eventId, event)
      this.addEvidence({
        id: `evi_minimap_event_${event.eventId}`,
        sessionId: batch.sessionId,
        temporalScope: 'current',
        source: 'minimap',
        kind: `minimap-${event.kind}`,
        confidence: 0.9,
        patch: batch.patch,
        clock: {
          observedAt,
          receivedAt: batch.frame.receivedAt,
          sequence: batch.frame.sequence
        },
        freshness: { expiresAt, state: 'fresh' },
        payload: event.payload
      })
    }

    for (const entity of batch.entities) {
      // candidate 只是视觉去抖阶段的内部候选，不能成为正式观察、最后可见位置或
      // 迷雾预测依据。只有跨帧确认后的轨迹才能进入教练事实链。
      if (entity.lifecycle !== 'confirmed') {
        continue
      }

      // 同一条确认轨迹使用稳定证据 ID，并用最新帧覆盖内容。这样不会以采集帧率
      // 持续堆积旧证据，也不会让等待播报的提示继续引用同一轨迹的过时帧。
      const evidenceId = `evi_minimap_${entity.trackId}`
      this._trackIdToEvidenceId.set(entity.trackId, evidenceId)

      const observationKind =
        entity.kind === 'enemy'
          ? 'enemy-seen'
          : entity.kind === 'ally'
            ? 'ally-seen'
            : entity.kind === 'self'
              ? 'self-seen'
              : `${entity.kind}-seen`

      this.addEvidence({
        id: evidenceId,
        sessionId: batch.sessionId,
        temporalScope: 'current',
        source: 'minimap',
        kind: observationKind,
        confidence: entity.confidence,
        patch: batch.patch,
        clock: {
          observedAt: entity.lastObservedAt,
          receivedAt: batch.frame.receivedAt,
          sequence: batch.frame.sequence
        },
        freshness: {
          expiresAt: entity.expiresAt,
          state: 'fresh'
        },
        payload: entity
      })

      if (entity.team === 'enemy') {
        const prev = this._lastSeenEnemies.get(entity.trackId)
        this._lastSeenEnemies.set(entity.trackId, {
          trackId: entity.trackId,
          lastObservedAt: entity.lastObservedAt,
          prevObservedAt: prev?.lastObservedAt,
          point: entity.point,
          prevPoint: prev?.point,
          championId: entity.championId,
          regionId: entity.regionId
        })

        // 如果敌人在小地图上重新出现，立即撤销之前的迷雾推断及关联证据
        const oldFog = this._fogInferences.get(entity.trackId)
        if (oldFog) {
          invalidatedEvidenceIds.push(`evi_fog_${oldFog.id}`)
          invalidatedEvidenceIds.push(...oldFog.basisEvidenceIds)
          this._fogInferences.delete(entity.trackId)
        }
      }
    }

    if (invalidatedEvidenceIds.length > 0 && this.onEvidenceInvalidated) {
      this.onEvidenceInvalidated(invalidatedEvidenceIds)
    }

    // 运行迷雾时空推断。独立开关关闭时仍保留直接小地图观察，但不生成或缓存预测。
    if (this._fogInferenceEnabled) {
      this._computeFogInferences(batch.sessionId, batch.patch, now)
    }
  }

  /**
   * 计算迷雾与不可见敌人时空推断（考虑速度向量、死亡英雄 ID 抑制、地图图结构与阵营）
   */
  private _computeFogInferences(sessionId: string, patch: string, now: number): void {
    const invalidatedEvidenceIds: string[] = []
    // 检查是否有玩家已死亡（死亡玩家不参与迷雾游走推断）
    for (const [trackId, lastSeen] of this._lastSeenEnemies.entries()) {
      // 仅对能够精确关联身份的死亡敌方英雄持续抑制；匿名轨迹只在死亡转换发生时撤销一次。
      const isDead =
        (lastSeen.championId && this._deadEnemyChampionIds.has(lastSeen.championId)) ||
        this._deadEnemyIdentityKeys.has(trackId.toLowerCase())

      if (isDead) {
        this._fogInferences.delete(trackId)
        continue
      }

      const elapsedSec = Math.max(0, (now - lastSeen.lastObservedAt) / 1000)

      // 敌方英雄消失在迷雾中 3 秒至 30 秒之间进行空间推断
      if (elapsedSec >= 3 && elapsedSec <= 30) {
        // 计算运动方向向量
        let vx = 0
        let vy = 0
        if (lastSeen.prevPoint && lastSeen.prevObservedAt) {
          const dt = Math.max(0.1, (lastSeen.lastObservedAt - lastSeen.prevObservedAt) / 1000)
          vx = (lastSeen.point.x - lastSeen.prevPoint.x) / dt
          vy = (lastSeen.point.y - lastSeen.prevPoint.y) / dt
        }

        // 英雄移动速度：归一化速度约 0.022 / s (340 码/s)
        const heroSpeed = 0.022
        const moveDist = elapsedSec * heroSpeed

        const predictedRegions: Array<{ regionId: string; probability: number }> = []
        const candidateRoutes: Array<{ regionIds: string[]; probability: number }> = []

        // 根据位置与运动向量推断（静止时对称分布，消除单向偏好退化）
        // 召唤师峡谷上、下半区以 x+y=1 为分界。使用速度在该法向量上的投影，
        // 而不是只看屏幕纵向速度；纯横向离开中路同样能正确识别游走方向。
        const sideVelocity = vx + vy
        const isMoving = Math.hypot(vx, vy) > 0.005
        const isHeadingBot = isMoving && sideVelocity > 0.005
        const isHeadingTop = isMoving && sideVelocity < -0.005

        if (
          lastSeen.regionId === 'mid_lane' ||
          (lastSeen.point.x > 0.35 &&
            lastSeen.point.x < 0.65 &&
            lastSeen.point.y > 0.35 &&
            lastSeen.point.y < 0.65)
        ) {
          if (isHeadingBot) {
            predictedRegions.push({ regionId: 'bot_river', probability: 0.65 })
            predictedRegions.push({ regionId: 'top_river', probability: 0.25 })
            predictedRegions.push({ regionId: 'base_recall', probability: 0.1 })
            candidateRoutes.push({
              regionIds: ['mid_lane', 'bot_river', 'bot_lane'],
              probability: 0.65
            })
            candidateRoutes.push({
              regionIds: ['mid_lane', 'top_river', 'top_lane'],
              probability: 0.25
            })
          } else if (isHeadingTop) {
            predictedRegions.push({ regionId: 'top_river', probability: 0.65 })
            predictedRegions.push({ regionId: 'bot_river', probability: 0.25 })
            predictedRegions.push({ regionId: 'base_recall', probability: 0.1 })
            candidateRoutes.push({
              regionIds: ['mid_lane', 'top_river', 'top_lane'],
              probability: 0.65
            })
            candidateRoutes.push({
              regionIds: ['mid_lane', 'bot_river', 'bot_lane'],
              probability: 0.25
            })
          } else {
            // 静止时对称分布
            predictedRegions.push({ regionId: 'bot_river', probability: 0.45 })
            predictedRegions.push({ regionId: 'top_river', probability: 0.45 })
            predictedRegions.push({ regionId: 'base_recall', probability: 0.1 })
            candidateRoutes.push({
              regionIds: ['mid_lane', 'bot_river', 'bot_lane'],
              probability: 0.45
            })
            candidateRoutes.push({
              regionIds: ['mid_lane', 'top_river', 'top_lane'],
              probability: 0.45
            })
          }
        } else if (lastSeen.point.x + lastSeen.point.y > 1) {
          predictedRegions.push({ regionId: 'bot_lane', probability: 0.6 })
          predictedRegions.push({ regionId: 'dragon_pit', probability: 0.4 })
          candidateRoutes.push({ regionIds: ['bot_lane', 'dragon_pit'], probability: 0.6 })
          candidateRoutes.push({ regionIds: ['bot_lane', 'bot_jungle'], probability: 0.4 })
        } else {
          predictedRegions.push({ regionId: 'top_lane', probability: 0.6 })
          predictedRegions.push({ regionId: 'baron_pit', probability: 0.4 })
          candidateRoutes.push({ regionIds: ['top_lane', 'top_river'], probability: 0.6 })
          candidateRoutes.push({ regionIds: ['top_lane', 'top_jungle'], probability: 0.4 })
        }

        // 到达时间动态区间计算
        const targetDist = 0.22
        const remainingDist = Math.max(0.03, targetDist - moveDist)
        const minArrivalSec = Math.max(1, Math.round(remainingDist / (heroSpeed * 1.2)))
        const maxArrivalSec = Math.max(
          minArrivalSec + 3,
          Math.round((remainingDist + 0.12) / (heroSpeed * 0.85))
        )

        const arrivalWindow = {
          earliestAt: now + minArrivalSec * 1000,
          latestAt: now + maxArrivalSec * 1000
        }

        let basisEviId = this._trackIdToEvidenceId.get(trackId)
        if (!basisEviId || !this.getEvidence(basisEviId, now)) {
          basisEviId = `evi_last_seen_${trackId}_${now}`
          this.addEvidence({
            id: basisEviId,
            sessionId,
            temporalScope: 'current',
            source: 'minimap',
            kind: 'enemy-last-seen',
            confidence: 0.9,
            patch,
            clock: { observedAt: lastSeen.lastObservedAt, receivedAt: now, sequence: 1 },
            freshness: { expiresAt: now + 35000, state: 'fresh' },
            payload: lastSeen
          })
          this._trackIdToEvidenceId.set(trackId, basisEviId)
        }

        const intents: Array<{
          kind: 'unknown' | 'roam' | 'recall' | 'ambush' | 'flank' | 'objective' | 'lane-swap'
          probability: number
        }> = []
        if (
          predictedRegions.some((r) => r.regionId.includes('river') || r.regionId.includes('lane'))
        ) {
          intents.push({
            kind: 'roam',
            probability: Math.max(0.45, predictedRegions[0]?.probability ?? 0.5)
          })
        }
        if (
          predictedRegions.some(
            (r) =>
              r.regionId.includes('pit') ||
              r.regionId.includes('dragon') ||
              r.regionId.includes('baron')
          )
        ) {
          intents.push({ kind: 'objective', probability: 0.35 })
        }
        if (
          predictedRegions.some((r) => r.regionId.includes('base') || r.regionId.includes('recall'))
        ) {
          intents.push({ kind: 'recall', probability: 0.25 })
        }
        if (intents.length === 0) {
          intents.push({ kind: 'roam', probability: 0.5 })
        }

        // 同一次“最后可见”episode 使用稳定 ID；后续 tick 更新同一证据，避免 10 FPS 下证据无限膨胀。
        const inferenceId = `${trackId}_${lastSeen.lastObservedAt}`
        const fogEviId = `evi_fog_${inferenceId}`
        const inference: FogInference = {
          id: inferenceId,
          sessionId,
          enemyTrackId: trackId,
          basisEvidenceIds: [basisEviId],
          lastSeenAt: lastSeen.lastObservedAt,
          predictedRegions,
          candidateRoutes,
          arrivalWindow,
          intents,
          // 随不可见时长真实衰减；不再把长时间失联的推断强行托底到播报阈值。
          confidence: Math.max(0, Math.min(0.95, 1 - elapsedSec / 35)),
          createdAt: now,
          expiresAt: now + 25000,
          modelVersion: '1.2.0'
        }

        this._fogInferences.set(trackId, inference)

        this.addEvidence({
          id: fogEviId,
          sessionId,
          temporalScope: 'current',
          source: 'fog-inference',
          kind: 'enemy-fog-prediction',
          confidence: inference.confidence,
          patch,
          clock: { observedAt: now, receivedAt: now, sequence: 1 },
          freshness: { expiresAt: inference.expiresAt, state: 'fresh' },
          payload: inference
        })
      } else if (elapsedSec > 30) {
        const expiredInference = this._fogInferences.get(trackId)
        if (expiredInference) {
          const fogEvidenceId = `evi_fog_${expiredInference.id}`
          invalidatedEvidenceIds.push(fogEvidenceId, ...expiredInference.basisEvidenceIds)
          this._evidences.delete(fogEvidenceId)
          this._fogInferences.delete(trackId)
        }
        const minimapEvidenceId = this._trackIdToEvidenceId.get(trackId)
        if (minimapEvidenceId) {
          invalidatedEvidenceIds.push(minimapEvidenceId)
          this._evidences.delete(minimapEvidenceId)
          this._trackIdToEvidenceId.delete(trackId)
        }
        this._lastSeenEnemies.delete(trackId)
      }
    }

    if (invalidatedEvidenceIds.length > 0) {
      this.onEvidenceInvalidated?.([...new Set(invalidatedEvidenceIds)])
    }
  }

  /**
   * 基于本人真实英雄、已有装备、当前金币与流派数据计算装备购买指导
   */
  private _computeItemGuidance(snapshot: LiveGameSnapshot, now: number): void {
    const active = snapshot.activePlayer
    if (!active) {
      this._clearItemGuidance()
      return
    }

    const currentGold = active.currentGold ?? 0

    // 匹配本人玩家记录，获取准确的 championId 和 inventory
    const matchingPlayer = findActivePlayerRecord(snapshot)

    const championId = matchingPlayer?.championId ?? (active as any).championId ?? null

    // 关键修复：当本人英雄无法确认 (championId === null 或非正数) 时，不生成非法 Guidance！
    if (championId === null || typeof championId !== 'number' || championId <= 0) {
      this._clearItemGuidance()
      return
    }

    // 当前装备数据库只允许与已注册目录完全相同的补丁，其他补丁一律停用推荐。
    const patch = snapshot.patch
    if (!patch || patch !== CURRENT_LIVE_COACH_PATCH) {
      this._clearItemGuidance()
      return
    }

    const mode = this._itemGuidancePreferences.mode

    // 确定英雄流派（严格使用显式英雄配置，优先按 championId 索引，严禁仅凭位置强行推导流派！）
    const role = getChampionRole(championId, active.championName)
    const buildDef = role ? CHAMPION_BUILDS[role] : null
    if ((mode === 'common' || mode === 'adaptive') && !buildDef) {
      // 通用与战局自适应模式依赖显式英雄流派；未知英雄不做猜测。
      this._clearItemGuidance()
      return
    }

    const inventoryItemIds = (matchingPlayer?.items ?? []).map((i) => i.itemID)
    const playerItems = matchingPlayer?.items ?? []

    // 装备栏容量校验：计算非饰品道具占用格数（召唤师峡谷主装备栏最大 6 格，Slot 7 为饰品栏 3340/3363/3364）
    const TRINKET_IDS = new Set([3340, 3363, 3364])
    const normalItems = playerItems.filter((i) => !TRINKET_IDS.has(i.itemID))
    const occupiedSlots = normalItems.length
    const freeSlots = Math.max(0, 6 - occupiedSlots)
    const isInventoryFull = freeSlots === 0

    // 控制守卫购买资格：有空余格位，或已有未叠满的控制守卫 (最大堆叠 2)
    const controlWardItem = playerItems.find((i) => i.itemID === 2055)
    const canBuyControlWard = freeSlots > 0 || (controlWardItem && (controlWardItem.count || 1) < 2)

    // 鞋子唯一性与升级资格校验：
    // 若已拥有任意 2 级鞋，则不重复推荐鞋子；若已拥有草鞋 (1001)，则支持原位升级（无需空槽）
    const TIER2_BOOTS = new Set([3047, 3111, 3006, 3020, 3158, 3009, 3117])
    const hasTier2Boots = inventoryItemIds.some((id) => TIER2_BOOTS.has(id))
    const hasTier1Boots = inventoryItemIds.includes(1001)
    const canUpgradeBoots = freeSlots > 0 || hasTier1Boots

    // 分析敌方阵容威胁（AP 法系伤害、重伤需求）并进行战局自适应出装微调
    const myTeam = normalizeTeamName(matchingPlayer?.team ?? active.team)
    const enemyTeam = myTeam === 'ORDER' ? 'CHAOS' : myTeam === 'CHAOS' ? 'ORDER' : 'UNKNOWN'
    // 玩家阵营不确定时不能把 ORDER 侧擅自当作敌方；保留英雄通用方案，关闭阵容自适应分支。
    const enemyPlayers =
      enemyTeam === 'UNKNOWN'
        ? []
        : (snapshot.players || []).filter((p) => normalizeTeamName(p.team) === enemyTeam)

    const HEALING_CHAMPIONS = new Set([
      'soraka',
      'yuumi',
      'aatrox',
      'warwick',
      'vladimir',
      'sylas',
      'briar',
      'swain',
      'kayn',
      'drmundo',
      'mundo',
      'illaoi',
      'volibear',
      'fiora',
      'irelia'
    ])
    const HEAVY_AP_CHAMPIONS = new Set([
      'ahri',
      'syndra',
      'leblanc',
      'veigar',
      'viktor',
      'lux',
      'xerath',
      'kassadin',
      'katarina',
      'fizz',
      'ekko',
      'evelynn',
      'elise',
      'nidalee',
      'karthus',
      'brand',
      'zyra',
      'velkoz'
    ])

    let apCount = 0
    let healingThreat = false

    for (const ep of enemyPlayers) {
      const cleanName = (ep.championName || '').toLowerCase().replace(/[^a-z]/g, '')
      if (HEAVY_AP_CHAMPIONS.has(cleanName)) apCount++
      if (HEALING_CHAMPIONS.has(cleanName)) healingThreat = true
    }

    const recipeEngine = new RecipeTreeEngine(CURRENT_RIOT_ITEM_CATALOG)

    // 动态合成候选大件列表（优先包含针对敌方战局的自适应装备，后接流派核心装）
    const candidateTargetItems: Array<{ id: number; reason: string }> = []

    if (mode === 'adaptive' && role && healingThreat) {
      if (role === 'fighter' || role === 'marksman' || role === 'assassin') {
        candidateTargetItems.push({
          id: 3123, // 处刑人的重击 (800g)
          reason: '敌方存在高回复/吸血英雄，自适应优先提供重伤克制'
        })
      } else if (role === 'mage' || role === 'support') {
        candidateTargetItems.push({
          id: 3916, // 湮灭宝珠 (800g)
          reason: '敌方存在高回复英雄，法系自适应优先提供重伤克制'
        })
      } else if (role === 'tank') {
        candidateTargetItems.push({
          id: 3076, // 棘刺背心 (800g)
          reason: '敌方高回复/普攻英雄，坦克自适应优先提供反伤重伤'
        })
      }
    }

    if (mode === 'adaptive' && role && apCount >= 2) {
      if (role === 'fighter' || role === 'assassin') {
        candidateTargetItems.push({
          id: 3156, // 玛莫提乌斯之噬 (3100g, 3155+3133)
          reason: '敌方法系伤害较高，自适应提供魔抗与救主灵刃护盾'
        })
      } else if (role === 'mage') {
        candidateTargetItems.push({
          id: 3102, // 女妖面纱 (3000g, 1058+4632)
          reason: '敌方法系爆发较高，自适应提供魔抗与法术护盾'
        })
      } else if (role === 'tank') {
        candidateTargetItems.push({
          id: 2504, // 败魔 (2900g, 3211+1057)
          reason: '敌方法系伤害主导，自适应提供高额魔抗与魔法护盾'
        })
      }
    }

    if ((mode === 'common' || mode === 'adaptive') && buildDef) {
      for (const core of buildDef.coreItems) {
        candidateTargetItems.push({ id: core.id, reason: core.reason })
      }
    } else {
      const configuredIds =
        mode === 'system'
          ? this._itemGuidancePreferences.systemRecommendedItemIds[String(championId)]
          : this._itemGuidancePreferences.customItemBuilds[String(championId)]

      if (!configuredIds?.length) {
        this._clearItemGuidance()
        return
      }

      const reason = mode === 'system' ? '英雄联盟客户端推荐出装' : '你的自定义出装方案'
      for (const itemId of configuredIds) {
        const item = CURRENT_RIOT_ITEM_CATALOG.items[itemId]
        if (!item?.purchasable || itemId >= 100000) continue
        candidateTargetItems.push({ id: itemId, reason })
      }
    }

    if (candidateTargetItems.length === 0) {
      this._clearItemGuidance()
      return
    }

    const configuredBoots = candidateTargetItems.find((candidate) =>
      CURRENT_RIOT_ITEM_CATALOG.items[candidate.id]?.tags.includes('Boots')
    )
    const preferredBoots = configuredBoots
      ? { id: configuredBoots.id, reason: configuredBoots.reason }
      : buildDef?.boots

    // 1. 找到尚未完成的第一个核心/自适应大件并进行递归多重集合抵扣计算
    let chosenTarget: { id: number; reason: string } | null = null
    let deductionResult: ReturnType<RecipeTreeEngine['calculateNetCost']> | null = null

    for (const cand of candidateTargetItems) {
      const res = recipeEngine.calculateNetCost(cand.id, playerItems, currentGold)
      if (!res.isCompleted) {
        chosenTarget = cand
        deductionResult = res
        break
      }
    }

    // All configured core items may already be complete. In that case move on
    // to boots, then a control ward, instead of presenting an already-owned
    // item as the primary purchase.
    if (
      !chosenTarget &&
      preferredBoots &&
      !hasTier2Boots &&
      canUpgradeBoots &&
      !inventoryItemIds.includes(preferredBoots.id)
    ) {
      chosenTarget = preferredBoots
      deductionResult = recipeEngine.calculateNetCost(preferredBoots.id, playerItems, currentGold)
    }
    if (!chosenTarget && canBuyControlWard) {
      chosenTarget = { id: 2055, reason: '视野控制与隐形反制' }
      deductionResult = recipeEngine.calculateNetCost(2055, playerItems, currentGold)
    }
    if (!chosenTarget || !deductionResult) {
      this._clearItemGuidance()
      return
    }

    const netCost = deductionResult.netCost
    const targetItemName = deductionResult.targetItemName

    // 2. 构建购买方案
    let primaryPlan: ItemPurchasePlan
    if (currentGold >= netCost && netCost > 0) {
      primaryPlan = {
        itemIds: [chosenTarget.id],
        totalCost: netCost,
        remainingGold: currentGold - netCost,
        missingGold: 0,
        reasonCodes: ['CORE_ITEM_COMPLETE'],
        conditions: [`完成核心装备：${targetItemName}（${chosenTarget.reason}）`]
      }
    } else if (deductionResult.isCompleted) {
      primaryPlan = {
        itemIds: [chosenTarget.id],
        totalCost: 0,
        remainingGold: currentGold,
        missingGold: 0,
        reasonCodes: ['CORE_ITEM_COMPLETE'],
        conditions: [`已完成核心装备：${targetItemName}`]
      }
    } else {
      // 关键修复：使用 recipeEngine 精确计算的 purchaseCost（扣除已拥有子组件后的实际购买/升级花费）
      const opt = deductionResult.nextPurchasableOption
      const nextCompId = opt ? opt.itemId : chosenTarget.id
      const nextCompName = opt ? opt.name : targetItemName
      const nextCompCost = opt ? opt.purchaseCost : netCost

      if (isInventoryFull && !opt?.isCombineUpgrade) {
        // 满背包时只有“消费已有组件并原位合成”的选项不需要新格子。
        primaryPlan = {
          itemIds: [chosenTarget.id],
          totalCost: netCost,
          remainingGold: 0,
          missingGold: Math.max(0, netCost - currentGold),
          reasonCodes: ['INVENTORY_FULL_SAVE_GOLD'],
          conditions: [
            `装备栏已满（6/6）且当前组件无法原位升级，建议积攒金币完成：${targetItemName}`
          ]
        }
      } else if (currentGold >= nextCompCost) {
        primaryPlan = {
          itemIds: [nextCompId],
          totalCost: nextCompCost,
          remainingGold: currentGold - nextCompCost,
          missingGold: 0,
          reasonCodes: ['CORE_COMPONENT_AFFORDABLE'],
          conditions: [
            opt?.isCombineUpgrade
              ? `合成进阶装备：${nextCompName}（升级费用 ${nextCompCost}g）`
              : `合成 ${targetItemName} 组件：${nextCompName}（花费 ${nextCompCost}g）`
          ]
        }
      } else {
        primaryPlan = {
          itemIds: [nextCompId],
          totalCost: nextCompCost,
          remainingGold: 0,
          missingGold: Math.max(0, nextCompCost - currentGold),
          reasonCodes: ['CORE_COMPONENT_PROGRESSION'],
          conditions: [
            opt?.isCombineUpgrade
              ? `合成进阶装备：${nextCompName}（升级费用 ${nextCompCost}g）`
              : `合成 ${targetItemName} 组件：${nextCompName}（花费 ${nextCompCost}g）`
          ]
        }
      }
    }

    const alternativePlans: ItemPurchasePlan[] = []
    if (
      preferredBoots &&
      !hasTier2Boots &&
      canUpgradeBoots &&
      !inventoryItemIds.includes(preferredBoots.id) &&
      chosenTarget.id !== preferredBoots.id
    ) {
      const bootsDeduction = recipeEngine.calculateNetCost(
        preferredBoots.id,
        playerItems,
        currentGold
      )
      const bootsNetCost = bootsDeduction.netCost
      alternativePlans.push({
        itemIds: [preferredBoots.id],
        totalCost: bootsNetCost,
        remainingGold: Math.max(0, currentGold - bootsNetCost),
        missingGold: Math.max(0, bootsNetCost - currentGold),
        reasonCodes: ['BOOTS_MOBILITY'],
        conditions: [
          hasTier1Boots
            ? `备选：原位升级为 ${bootsDeduction.targetItemName}（${preferredBoots.reason}）`
            : `备选：${bootsDeduction.targetItemName}（${preferredBoots.reason}）`
        ]
      })
    }

    if (canBuyControlWard && chosenTarget.id !== 2055) {
      alternativePlans.push({
        itemIds: [2055], // 控制守卫
        totalCost: 75,
        remainingGold: Math.max(0, currentGold - 75),
        missingGold: Math.max(0, 75 - currentGold),
        reasonCodes: ['VISION_CONTROL'],
        conditions: ['备选：控制守卫（视野控制与隐形反制）']
      })
    }

    // 同一连续可购买阶段使用同一组证据。方案或可购组件变化时先撤销旧证据，
    // 调度器会立即取消尚未播报的旧建议，避免玩家买完后仍听到过期购买提示。
    const planKey = [
      snapshot.sessionId,
      championId,
      mode,
      primaryPlan.itemIds.join(','),
      primaryPlan.totalCost,
      primaryPlan.missingGold === 0 ? 'affordable' : 'saving',
      primaryPlan.reasonCodes.join(',')
    ].join('|')
    if (this._itemGuidancePlanKey !== planKey) {
      this._clearItemGuidance()
      this._itemGuidancePlanKey = planKey
      this._itemGuidanceEvidenceIds = [
        `evi_gold_inv_${snapshot.sessionId}_${now}`,
        `evi_item_guidance_${snapshot.sessionId}_${now}`
      ]
    }

    const [goldEvidenceId, guidanceEvidenceId] = this._itemGuidanceEvidenceIds
    const guidance: ItemPurchaseGuidance = {
      id: `item_guidance_${now}`,
      sessionId: snapshot.sessionId,
      patch,
      championId,
      mode,
      currentGold,
      inventoryItemIds,
      primaryPlan,
      alternativePlans,
      evidenceIds: [goldEvidenceId, guidanceEvidenceId],
      createdAt: now,
      expiresAt: now + 25000,
      ruleVersion: '1.3.0'
    }

    this._latestItemGuidance = guidance

    this.addEvidence({
      id: goldEvidenceId,
      sessionId: snapshot.sessionId,
      temporalScope: 'current',
      source: 'live-client-data',
      kind: 'player-economy-inventory',
      confidence: 1,
      patch,
      clock: { observedAt: now, receivedAt: now, sequence: 1 },
      freshness: { expiresAt: now + 35000, state: 'fresh' },
      payload: {
        championId,
        championName: active.championName,
        currentGold,
        inventoryItemIds
      }
    })

    this.addEvidence({
      id: guidanceEvidenceId,
      sessionId: snapshot.sessionId,
      temporalScope: 'current',
      source: 'item-guidance',
      kind: 'item-purchase-advice',
      confidence: 1,
      patch,
      clock: { observedAt: now, receivedAt: now, sequence: 1 },
      freshness: { expiresAt: guidance.expiresAt, state: 'fresh' },
      payload: guidance
    })
  }

  private _clearItemGuidance(): void {
    const invalidatedIds = this._itemGuidanceEvidenceIds.filter((id) => this._evidences.delete(id))
    this._latestItemGuidance = null
    this._itemGuidancePlanKey = null
    this._itemGuidanceEvidenceIds = []
    if (invalidatedIds.length > 0) {
      this.onEvidenceInvalidated?.(invalidatedIds)
    }
  }

  /**
   * 解析对局中立资源（巨龙 / 峡谷先锋 / 男爵 / 巢虫）即将刷新的准确时间（排除已存活对象）
   */
  public getNextObjectiveSchedule(
    gameTimeSeconds: number | null,
    patch: string | null,
    queueId: number | null
  ): ObjectiveSchedule | null {
    if (gameTimeSeconds === null || patch !== CURRENT_LIVE_COACH_PATCH) return null
    if (![0, 400, 420, 430, 440].includes(queueId ?? -1)) return null

    const events = this._latestLiveGameSnapshot?.events ?? []

    // 1. 巨龙击杀事件与下次刷新
    let lastDragonKillTime: number | null = null
    for (const ev of events) {
      if (
        ev.eventName === 'DragonKill' &&
        !String(ev.payload.DragonType ?? '')
          .toLowerCase()
          .includes('elder')
      ) {
        lastDragonKillTime = Math.max(lastDragonKillTime ?? -Infinity, ev.eventTime)
      }
    }
    const dragonSpawnTime = lastDragonKillTime === null ? 300 : lastDragonKillTime + 300

    // 2. 虚空巢虫（16.17.1 标准峡谷：8:00 单次刷新）
    const grubsSpawnTime = 480

    // 3. 峡谷先锋（16.17.1 标准峡谷：15:00 单次刷新）
    const heraldSpawnTime = 900

    // 4. 纳什男爵（20:00 刷新，击杀后 6 分钟）
    let lastBaronKillTime: number | null = null
    for (const ev of events) {
      if (ev.eventName === 'BaronKill') {
        lastBaronKillTime = Math.max(lastBaronKillTime ?? -Infinity, ev.eventTime)
      }
    }
    const baronSpawnTime = lastBaronKillTime === null ? 1200 : lastBaronKillTime + 360

    // 收集所有在未来的刷新事件
    const upcomingCandidates: Array<{ name: string; spawnTime: number }> = []

    if (gameTimeSeconds < dragonSpawnTime) {
      upcomingCandidates.push({ name: '巨龙', spawnTime: dragonSpawnTime })
    }
    if (gameTimeSeconds < grubsSpawnTime) {
      upcomingCandidates.push({ name: '虚空巢虫', spawnTime: grubsSpawnTime })
    }
    if (gameTimeSeconds >= 860 && gameTimeSeconds < heraldSpawnTime) {
      upcomingCandidates.push({ name: '峡谷先锋', spawnTime: heraldSpawnTime })
    }
    if (gameTimeSeconds < baronSpawnTime) {
      upcomingCandidates.push({ name: '纳什男爵', spawnTime: baronSpawnTime })
    }

    if (upcomingCandidates.length === 0) {
      return null
    }

    // 按未来刷新时间升序排序，返回最近即将刷新的中立资源
    upcomingCandidates.sort((a, b) => a.spawnTime - b.spawnTime)
    const next = upcomingCandidates[0]

    return {
      name: next.name,
      nextSpawnGameTime: next.spawnTime,
      isAlive: false
    }
  }

  public addEvidence(evidence: CoachEvidence): void {
    this._evidences.set(evidence.id, evidence)
    if (this._evidences.size > 120) {
      // 使用证据自己的时钟，保证离线回放的虚拟时间不会被真实系统时间误删。
      this.cleanupExpiredEvidence(evidence.clock.receivedAt)
    }
  }

  public cleanupExpiredEvidence(now: number = Date.now()): void {
    const removedIds = new Set<string>()
    for (const [id, evi] of this._evidences.entries()) {
      if (evi.freshness.expiresAt <= now) {
        this._evidences.delete(id)
        removedIds.add(id)
      }
    }
    if (removedIds.size > 0) {
      for (const [trackId, evidenceId] of this._trackIdToEvidenceId.entries()) {
        if (removedIds.has(evidenceId)) {
          this._trackIdToEvidenceId.delete(trackId)
        }
      }
    }
    for (const [eventId, event] of this._minimapEvents.entries()) {
      if (event.timestamp + 10000 <= now) {
        this._minimapEvents.delete(eventId)
      }
    }
  }

  public getEvidence(id: string, now?: number): CoachEvidence | null {
    const evidence = this._evidences.get(id)
    if (!evidence) return null
    if (now !== undefined && evidence.freshness.expiresAt <= now) return null
    return evidence
  }

  public getMinimapEvidenceId(trackId: string, now: number = Date.now()): string | null {
    const evidenceId = this._trackIdToEvidenceId.get(trackId)
    if (!evidenceId) return null
    const evidence = this._evidences.get(evidenceId)
    if (!evidence || evidence.freshness.expiresAt <= now) return null
    return evidenceId
  }

  public getFogInferences(now: number = Date.now()): FogInference[] {
    return Array.from(this._fogInferences.values()).filter((f) => f.expiresAt > now)
  }

  public getMinimapEvents(now: number = Date.now()): MinimapDerivedEvent[] {
    this.cleanupExpiredEvidence(now)
    return Array.from(this._minimapEvents.values()).filter(
      (event) => event.timestamp <= now && event.timestamp + 10000 > now
    )
  }

  public getItemPurchaseGuidance(now: number = Date.now()): ItemPurchaseGuidance | null {
    if (!this._latestItemGuidance) return null
    if (this._latestItemGuidance.expiresAt <= now) return null
    return this._latestItemGuidance
  }

  public getActiveEvidences(now: number = Date.now()): CoachEvidence[] {
    this.cleanupExpiredEvidence(now)
    return Array.from(this._evidences.values())
  }

  public getGameTimeSeconds(): number | null {
    return this._latestLiveGameSnapshot?.gameTimeSeconds ?? null
  }

  public getMinimapEntities(now: number = Date.now()): MinimapEntityObservation[] {
    return (this._latestMinimapBatch?.entities ?? []).filter(
      (entity) => entity.lifecycle === 'confirmed' && entity.expiresAt > now
    )
  }

  public getPlayers(): NormalizedPlayer[] {
    return this._latestLiveGameSnapshot?.players ?? []
  }

  public getGameEvents(): NormalizedGameEvent[] {
    return this._latestLiveGameSnapshot?.events ?? []
  }

  public getActivePlayerState(): NormalizedActivePlayer | null {
    return this._latestLiveGameSnapshot?.activePlayer ?? null
  }

  public getActivePlayer(): NormalizedPlayer | null {
    return this._latestLiveGameSnapshot
      ? findActivePlayerRecord(this._latestLiveGameSnapshot)
      : null
  }
}
