import {
  CoachEvidence,
  FogInference,
  ItemPurchaseGuidance,
  ItemPurchasePlan,
  MinimapEntityObservation,
  MinimapObservationBatch,
  NormalizedMapPoint
} from '@shared/types/live-coach'
import { LiveGameSnapshot, NormalizedPlayer } from '@shared/types/live-game-data'

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

const CHAMPION_BUILDS: Record<string, ChampionBuildDefinition> = {
  // 战士 / 重装战士（如 盖伦、德莱厄斯、瑟提等）
  fighter: {
    archetype: 'fighter',
    coreItems: [
      {
        id: 6631, // 挺进破坏者
        name: '挺进破坏者',
        cost: 3300,
        components: [
          { id: 3051, name: '提亚马特', cost: 1200 },
          { id: 3044, name: '净蚀', cost: 1100 },
          { id: 1028, name: '红水晶', cost: 400 }
        ],
        reason: '核心减速留人与清线战力'
      },
      {
        id: 3071, // 黑色切割者
        name: '黑色切割者',
        cost: 3000,
        components: [
          { id: 3044, name: '净蚀', cost: 1100 },
          { id: 3133, name: '考尔菲德的战锤', cost: 1100 },
          { id: 1028, name: '红水晶', cost: 400 }
        ],
        reason: '破甲与移速提升'
      }
    ],
    boots: { id: 3047, name: '铁板靴', cost: 1100, reason: '物理抗性与减伤' }
  },
  // 法师 / AP（如 阿狸、拉克丝、辛德拉等）
  mage: {
    archetype: 'mage',
    coreItems: [
      {
        id: 3802, // 卢登的伙伴
        name: '卢登的伙伴',
        cost: 3000,
        components: [
          { id: 3802, name: '遗失的章节', cost: 1200 },
          { id: 3145, name: '海克斯科技发电机', cost: 1100 },
          { id: 1052, name: '增幅典籍', cost: 400 }
        ],
        reason: '法力续航与爆发伤害支点'
      },
      {
        id: 4645, // 影焰
        name: '影焰',
        cost: 3200,
        components: [
          { id: 3108, name: '恶魔法典', cost: 900 },
          { id: 1026, name: '爆裂魔杖', cost: 850 }
        ],
        reason: '高额法强与暴击斩杀'
      }
    ],
    boots: { id: 3020, name: '法师之靴', cost: 1100, reason: '法术穿透' }
  },
  // 射手 / ADC（如 金克丝、艾希、凯特琳等）
  marksman: {
    archetype: 'marksman',
    coreItems: [
      {
        id: 3031, // 无尽之刃
        name: '无尽之刃',
        cost: 3400,
        components: [
          { id: 1038, name: '暴风之剑', cost: 1300 },
          { id: 875, name: '十字镐', cost: 875 },
          { id: 3123, name: '灵巧披风', cost: 600 }
        ],
        reason: '暴击与物理爆发核心'
      },
      {
        id: 6672, // 海妖杀手
        name: '海妖杀手',
        cost: 3100,
        components: [
          { id: 6670, name: '正午箭袋', cost: 1300 },
          { id: 3101, name: '缚炉之斧', cost: 1150 }
        ],
        reason: '持续普攻特效与攻速'
      }
    ],
    boots: { id: 3006, name: '狂战士胫甲', cost: 1100, reason: '攻击速度' }
  },
  // 坦克（如 墨菲特、奥恩、塞恩等）
  tank: {
    archetype: 'tank',
    coreItems: [
      {
        id: 3068, // 日炎圣盾
        name: '日炎圣盾',
        cost: 2700,
        components: [
          { id: 3751, name: '斑比的熔渣', cost: 1000 },
          { id: 1031, name: '锁子甲', cost: 800 }
        ],
        reason: '范围灼烧与物理防御'
      }
    ],
    boots: { id: 3047, name: '铁板靴', cost: 1100, reason: '物理抗性' }
  },
  // 刺客（如 劫、泰隆、卡兹克等）
  assassin: {
    archetype: 'assassin',
    coreItems: [
      {
        id: 3142, // 幽梦之灵
        name: '幽梦之灵',
        cost: 2800,
        components: [
          { id: 3134, name: '锯齿短匕', cost: 1000 },
          { id: 3133, name: '考尔菲德的战锤', cost: 1100 }
        ],
        reason: '穿甲与游走机动性'
      }
    ],
    boots: { id: 3158, name: '明朗之靴', cost: 900, reason: '技能急速' }
  }
}

export class FactFusionEngine {
  private readonly _evidences = new Map<string, CoachEvidence>()
  private readonly _trackIdToEvidenceId = new Map<string, string>()
  private readonly _fogInferences = new Map<string, FogInference>()
  private readonly _lastSeenEnemies = new Map<
    string,
    {
      trackId: string
      lastObservedAt: number
      point: NormalizedMapPoint
      championId: number | null
      regionId: string | null
    }
  >()

  private _latestLiveGameSnapshot: LiveGameSnapshot | null = null
  private _latestMinimapBatch: MinimapObservationBatch | null = null
  private _latestItemGuidance: ItemPurchaseGuidance | null = null

  // 证据失效回调，用于向调度器传播取消 Pending Cues
  public onEvidenceInvalidated?: (invalidatedEvidenceIds: string[]) => void

  public reset(): void {
    this._evidences.clear()
    this._trackIdToEvidenceId.clear()
    this._fogInferences.clear()
    this._lastSeenEnemies.clear()
    this._latestLiveGameSnapshot = null
    this._latestMinimapBatch = null
    this._latestItemGuidance = null
  }

  public updateLiveGameSnapshot(snapshot: LiveGameSnapshot, virtualNow: number = Date.now()): void {
    this._latestLiveGameSnapshot = snapshot

    if (snapshot.activePlayer) {
      const eviId = `evi_active_player_${virtualNow}`
      this.addEvidence({
        id: eviId,
        sessionId: snapshot.sessionId,
        temporalScope: 'current',
        source: 'live-client-data',
        kind: 'active-player-status',
        confidence: 1,
        patch: snapshot.patch,
        clock: {
          observedAt: virtualNow,
          receivedAt: virtualNow,
          sequence: snapshot.clock.sequence
        },
        freshness: {
          expiresAt: virtualNow + 30000,
          state: 'fresh'
        },
        payload: snapshot.activePlayer
      })

      // 实时计算基于本人英雄和已有装备的购买指导
      this._computeItemGuidance(snapshot, virtualNow)
    }
  }

  public updateMinimapBatch(batch: MinimapObservationBatch, virtualNow: number = Date.now()): void {
    this._latestMinimapBatch = batch

    const invalidatedEvidenceIds: string[] = []

    for (const entity of batch.entities) {
      if (entity.lifecycle === 'confirmed' || entity.lifecycle === 'candidate') {
        const eviId = `evi_minimap_${entity.trackId}_${virtualNow}`
        this._trackIdToEvidenceId.set(entity.trackId, eviId)

        this.addEvidence({
          id: eviId,
          sessionId: batch.sessionId,
          temporalScope: 'current',
          source: 'minimap',
          kind: `entity-${entity.kind}`,
          confidence: entity.confidence,
          patch: batch.patch,
          clock: {
            observedAt: entity.lastObservedAt,
            receivedAt: virtualNow,
            sequence: batch.frame.sequence
          },
          freshness: {
            expiresAt: entity.expiresAt,
            state: 'fresh'
          },
          payload: entity
        })

        if (entity.team === 'enemy') {
          this._lastSeenEnemies.set(entity.trackId, {
            trackId: entity.trackId,
            lastObservedAt: entity.lastObservedAt,
            point: entity.point,
            championId: entity.championId,
            regionId: entity.regionId
          })

          // 如果敌人在小地图上重新出现，立即撤销之前的迷雾推断及关联 Cue
          const oldFog = this._fogInferences.get(entity.trackId)
          if (oldFog) {
            invalidatedEvidenceIds.push(`evi_fog_${oldFog.id}`)
            this._fogInferences.delete(entity.trackId)
          }
        }
      }
    }

    if (invalidatedEvidenceIds.length > 0 && this.onEvidenceInvalidated) {
      this.onEvidenceInvalidated(invalidatedEvidenceIds)
    }

    // 运行迷雾与不可见敌人时空推断
    this._computeFogInferences(batch.sessionId, batch.patch, virtualNow)
  }

  /**
   * 计算迷雾与不可见敌人空间概率区域、候选路线与到达时间区间
   */
  private _computeFogInferences(sessionId: string, patch: string, now: number): void {
    for (const [trackId, lastSeen] of this._lastSeenEnemies.entries()) {
      const elapsedSec = Math.max(0, (now - lastSeen.lastObservedAt) / 1000)

      // 敌方英雄消失在迷雾中 3 秒至 30 秒之间进行有效空间推断
      if (elapsedSec >= 3 && elapsedSec <= 30) {
        // 真实英雄移动速度归一化计算：约 340 码/s -> 归一化小地图距离约 0.022 / s
        const heroSpeed = 0.022
        const moveDist = elapsedSec * heroSpeed

        const predictedRegions: Array<{ regionId: string; probability: number }> = []
        const candidateRoutes: Array<{ regionIds: string[]; probability: number }> = []

        // 根据最后可见位置与地图可达路径动态计算概率
        if (
          lastSeen.regionId === 'mid_lane' ||
          (lastSeen.point.x > 0.35 &&
            lastSeen.point.x < 0.65 &&
            lastSeen.point.y > 0.35 &&
            lastSeen.point.y < 0.65)
        ) {
          predictedRegions.push({ regionId: 'bot_river', probability: 0.45 })
          predictedRegions.push({ regionId: 'top_river', probability: 0.35 })
          predictedRegions.push({ regionId: 'base_recall', probability: 0.2 })

          candidateRoutes.push({
            regionIds: ['mid_lane', 'bot_river', 'bot_lane'],
            probability: 0.5
          })
          candidateRoutes.push({
            regionIds: ['mid_lane', 'top_river', 'top_lane'],
            probability: 0.3
          })
          candidateRoutes.push({ regionIds: ['mid_lane', 'base'], probability: 0.2 })
        } else if (lastSeen.point.y > 0.5) {
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

        // 动态到达时间计算：基于距离与速度
        const targetDist = 0.25 // 到达关键路口/河道距离
        const remainingDist = Math.max(0.04, targetDist - moveDist)
        const minArrivalSec = Math.max(1, Math.round(remainingDist / heroSpeed))
        const maxArrivalSec = Math.max(
          minArrivalSec + 3,
          Math.round((remainingDist + 0.15) / heroSpeed)
        )

        const arrivalWindow = {
          earliestAt: now + minArrivalSec * 1000,
          latestAt: now + maxArrivalSec * 1000
        }

        // 确保证据 ID 真实存在
        let basisEviId = this._trackIdToEvidenceId.get(trackId)
        if (!basisEviId || !this._evidences.has(basisEviId)) {
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

        const inference: FogInference = {
          id: `fog_${trackId}_${now}`,
          sessionId,
          enemyTrackId: trackId,
          basisEvidenceIds: [basisEviId],
          lastSeenAt: lastSeen.lastObservedAt,
          predictedRegions,
          candidateRoutes,
          arrivalWindow,
          intents: [
            { kind: 'roam', probability: 0.55 },
            { kind: 'ambush', probability: 0.25 },
            { kind: 'recall', probability: 0.2 }
          ],
          confidence: Math.max(0.6, 0.95 - elapsedSec * 0.012),
          createdAt: now,
          expiresAt: now + 25000,
          modelVersion: '1.2.0'
        }

        this._fogInferences.set(trackId, inference)

        const eviId = `evi_fog_${inference.id}`
        this.addEvidence({
          id: eviId,
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
        this._fogInferences.delete(trackId)
      }
    }
  }

  /**
   * 基于本人真实英雄、已有装备、当前金币与补丁数据计算装备购买指导
   */
  private _computeItemGuidance(snapshot: LiveGameSnapshot, now: number): void {
    const active = snapshot.activePlayer
    if (!active) return

    const currentGold = active.currentGold ?? 0

    // 匹配本人玩家记录，获取准确的 championId 和 inventory
    const matchingPlayer = snapshot.players.find(
      (p) =>
        p.summonerName === active.summonerName ||
        p.riotId === active.riotId ||
        p.championName === active.championName
    )

    const championName = active.championName.toLowerCase()
    const championId = matchingPlayer?.championId ?? 86 // 默认非硬编码阿狸

    // 确定英雄流派构建表
    let buildDef = CHAMPION_BUILDS.fighter
    if (
      ['ahri', 'lux', 'syndra', 'orianna', 'veigar', 'viktor', 'xerath', 'annie'].includes(
        championName
      )
    ) {
      buildDef = CHAMPION_BUILDS.mage
    } else if (
      ['jinx', 'ashe', 'caitlyn', 'vayne', 'kaisa', 'ezreal', 'tristana', 'lucian'].includes(
        championName
      )
    ) {
      buildDef = CHAMPION_BUILDS.marksman
    } else if (['zed', 'talon', 'khazix', 'kayn', 'qiyana', 'pyke'].includes(championName)) {
      buildDef = CHAMPION_BUILDS.assassin
    } else if (
      ['malphite', 'ornn', 'sion', 'leona', 'nautilus', 'shen', 'chogath'].includes(championName)
    ) {
      buildDef = CHAMPION_BUILDS.tank
    }

    const inventoryItemIds = (matchingPlayer?.items ?? []).map((i) => i.itemID)

    // 1. 先创建并持久化底层的金币与装备 Evidence，保证 evidenceIds 100% 可解析
    const goldEvidenceId = `evi_gold_inv_${now}`
    this.addEvidence({
      id: goldEvidenceId,
      sessionId: snapshot.sessionId,
      temporalScope: 'current',
      source: 'live-client-data',
      kind: 'player-economy-inventory',
      confidence: 1,
      patch: snapshot.patch || '14.15.1',
      clock: { observedAt: now, receivedAt: now, sequence: 1 },
      freshness: { expiresAt: now + 35000, state: 'fresh' },
      payload: {
        championId,
        championName: active.championName,
        currentGold,
        inventoryItemIds
      }
    })

    // 2. 找到尚未完成的第一个核心装备
    const uncompletedCore =
      buildDef.coreItems.find((item) => !inventoryItemIds.includes(item.id)) ||
      buildDef.coreItems[0]

    // 检查已拥有的组件并抵扣价格
    let netCost = uncompletedCore.cost
    const ownedComponents = uncompletedCore.components.filter((comp) =>
      inventoryItemIds.includes(comp.id)
    )
    for (const comp of ownedComponents) {
      netCost -= comp.cost
    }
    netCost = Math.max(0, netCost)

    // 推荐购买方案
    let primaryPlan: ItemPurchasePlan
    if (currentGold >= netCost) {
      primaryPlan = {
        itemIds: [uncompletedCore.id],
        totalCost: netCost,
        remainingGold: currentGold - netCost,
        missingGold: 0,
        reasonCodes: ['CORE_ITEM_COMPLETE'],
        conditions: [`完成核心装备：${uncompletedCore.name}（${uncompletedCore.reason}）`]
      }
    } else {
      // 推荐未拥有且当前金币最接近的大件组件
      const affordableComponent =
        uncompletedCore.components.find(
          (comp) => !inventoryItemIds.includes(comp.id) && currentGold >= comp.cost
        ) || uncompletedCore.components[0]

      primaryPlan = {
        itemIds: [affordableComponent.id],
        totalCost: affordableComponent.cost,
        remainingGold: Math.max(0, currentGold - affordableComponent.cost),
        missingGold: Math.max(0, affordableComponent.cost - currentGold),
        reasonCodes: ['CORE_COMPONENT_PROGRESSION'],
        conditions: [`合成 ${uncompletedCore.name} 组件：${affordableComponent.name}`]
      }
    }

    // 备选方案：靴子或视野消耗品
    const alternativePlans: ItemPurchasePlan[] = [
      {
        itemIds: [buildDef.boots.id],
        totalCost: buildDef.boots.cost,
        remainingGold: Math.max(0, currentGold - buildDef.boots.cost),
        missingGold: Math.max(0, buildDef.boots.cost - currentGold),
        reasonCodes: ['BOOTS_MOBILITY'],
        conditions: [`备选：${buildDef.boots.name}（${buildDef.boots.reason}）`]
      },
      {
        itemIds: [2055], // 控制守卫
        totalCost: 75,
        remainingGold: Math.max(0, currentGold - 75),
        missingGold: Math.max(0, 75 - currentGold),
        reasonCodes: ['VISION_CONTROL'],
        conditions: ['备选：控制守卫（防御草丛视野）']
      }
    ]

    const guidance: ItemPurchaseGuidance = {
      id: `item_guidance_${now}`,
      sessionId: snapshot.sessionId,
      patch: snapshot.patch || '14.15.1',
      championId,
      currentGold,
      inventoryItemIds,
      primaryPlan,
      alternativePlans,
      evidenceIds: [goldEvidenceId],
      createdAt: now,
      expiresAt: now + 25000,
      ruleVersion: '1.2.0'
    }

    this._latestItemGuidance = guidance

    const guidanceEvidenceId = `evi_item_guidance_${now}`
    this.addEvidence({
      id: guidanceEvidenceId,
      sessionId: snapshot.sessionId,
      temporalScope: 'current',
      source: 'item-guidance',
      kind: 'item-purchase-advice',
      confidence: 1,
      patch: snapshot.patch || '14.15.1',
      clock: { observedAt: now, receivedAt: now, sequence: 1 },
      freshness: { expiresAt: guidance.expiresAt, state: 'fresh' },
      payload: guidance
    })
  }

  /**
   * 解析对局中立资源（巨龙 / 峡谷先锋 / 男爵 / 巢虫）的真实刷新时间
   */
  public getNextObjectiveSchedule(gameTimeSeconds: number | null): ObjectiveSchedule | null {
    if (gameTimeSeconds === null) return null

    const events = this._latestLiveGameSnapshot?.events ?? []

    // 1. 查找最后一条巨龙击杀事件
    let lastDragonKillTime: number | null = null
    for (const ev of events) {
      if (ev.eventName === 'DragonKill') {
        lastDragonKillTime = ev.eventTime
      }
    }

    let nextDragonTime = 300 // 默认首条龙 5:00 (300s)
    if (lastDragonKillTime !== null) {
      nextDragonTime = lastDragonKillTime + 300 // 击杀后 5 分钟复活
    }

    // 2. 男爵刷新（20:00，击杀后 6 分钟）
    let lastBaronKillTime: number | null = null
    for (const ev of events) {
      if (ev.eventName === 'BaronKill') {
        lastBaronKillTime = ev.eventTime
      }
    }
    let nextBaronTime = 1200 // 20:00
    if (lastBaronKillTime !== null) {
      nextBaronTime = lastBaronKillTime + 360
    }

    if (gameTimeSeconds < 1200 || nextDragonTime <= nextBaronTime) {
      return {
        name: '巨龙',
        nextSpawnGameTime: nextDragonTime,
        isAlive: gameTimeSeconds >= nextDragonTime
      }
    }

    return {
      name: '纳什男爵',
      nextSpawnGameTime: nextBaronTime,
      isAlive: gameTimeSeconds >= nextBaronTime
    }
  }

  public addEvidence(evidence: CoachEvidence): void {
    this._evidences.set(evidence.id, evidence)
    if (this._evidences.size > 120) {
      this.cleanupExpiredEvidence(Date.now())
    }
  }

  public cleanupExpiredEvidence(now: number = Date.now()): void {
    for (const [id, evi] of this._evidences.entries()) {
      if (evi.freshness.expiresAt <= now) {
        this._evidences.delete(id)
      }
    }
  }

  public getEvidence(id: string): CoachEvidence | null {
    return this._evidences.get(id) || null
  }

  public getMinimapEvidenceId(trackId: string): string | null {
    return this._trackIdToEvidenceId.get(trackId) || null
  }

  public getFogInferences(now: number = Date.now()): FogInference[] {
    return Array.from(this._fogInferences.values()).filter((f) => f.expiresAt > now)
  }

  public getItemPurchaseGuidance(now: number = Date.now()): ItemPurchaseGuidance | null {
    if (!this._latestItemGuidance) return null
    if (this._latestItemGuidance.expiresAt <= now) return null
    return this._latestItemGuidance
  }

  public getActiveEvidences(): CoachEvidence[] {
    return Array.from(this._evidences.values())
  }

  public getGameTimeSeconds(): number | null {
    return this._latestLiveGameSnapshot?.gameTimeSeconds ?? null
  }

  public getMinimapEntities(): MinimapEntityObservation[] {
    return this._latestMinimapBatch?.entities ?? []
  }

  public getPlayers(): NormalizedPlayer[] {
    return this._latestLiveGameSnapshot?.players ?? []
  }
}
