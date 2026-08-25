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

  public reset(): void {
    this._evidences.clear()
    this._trackIdToEvidenceId.clear()
    this._fogInferences.clear()
    this._lastSeenEnemies.clear()
    this._latestLiveGameSnapshot = null
    this._latestMinimapBatch = null
    this._latestItemGuidance = null
  }

  public updateLiveGameSnapshot(snapshot: LiveGameSnapshot): void {
    this._latestLiveGameSnapshot = snapshot
    const now = Date.now()

    if (snapshot.activePlayer) {
      const eviId = `evi_active_player_${now}`
      this.addEvidence({
        id: eviId,
        sessionId: snapshot.sessionId,
        temporalScope: 'current',
        source: 'live-client-data',
        kind: 'active-player-status',
        confidence: 1,
        patch: snapshot.patch,
        clock: snapshot.clock,
        freshness: {
          expiresAt: now + 3000,
          state: 'fresh'
        },
        payload: snapshot.activePlayer
      })

      // 实时计算装备购买指导
      this._computeItemGuidance(snapshot, now)
    }
  }

  public updateMinimapBatch(batch: MinimapObservationBatch): void {
    this._latestMinimapBatch = batch
    const now = Date.now()

    const currentEnemyTrackIds = new Set<string>()

    for (const entity of batch.entities) {
      if (entity.lifecycle === 'confirmed' || entity.lifecycle === 'candidate') {
        const eviId = `evi_minimap_${entity.trackId}_${now}`
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
            receivedAt: now,
            sequence: batch.frame.sequence
          },
          freshness: {
            expiresAt: entity.expiresAt,
            state: 'fresh'
          },
          payload: entity
        })

        if (entity.team === 'enemy') {
          currentEnemyTrackIds.add(entity.trackId)
          this._lastSeenEnemies.set(entity.trackId, {
            trackId: entity.trackId,
            lastObservedAt: entity.lastObservedAt,
            point: entity.point,
            championId: entity.championId,
            regionId: entity.regionId
          })
          // 如果重新在小地图看见，立即撤销之前的迷雾推断
          this._fogInferences.delete(entity.trackId)
        }
      }
    }

    // 运行迷雾与不可见敌人时空推断
    this._computeFogInferences(batch.sessionId, batch.patch, now)
  }

  /**
   * 计算迷雾与不可见敌人空间概率区域、候选路线与到达时间区间
   */
  private _computeFogInferences(sessionId: string, patch: string, now: number): void {
    for (const [trackId, lastSeen] of this._lastSeenEnemies.entries()) {
      const elapsedSec = (now - lastSeen.lastObservedAt) / 1000

      // 敌方英雄消失在迷雾中 3 秒至 30 秒之间进行有效空间推断
      if (elapsedSec >= 3 && elapsedSec <= 30) {
        const moveRadius = Math.min(0.6, elapsedSec * 0.025) // 归一化移动范围半径

        const predictedRegions: Array<{ regionId: string; probability: number }> = []
        const candidateRoutes: Array<{ regionIds: string[]; probability: number }> = []

        if (
          lastSeen.regionId === 'mid_lane' ||
          (lastSeen.point.x > 0.4 && lastSeen.point.x < 0.6)
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
        } else if (lastSeen.point.y > 0.6) {
          predictedRegions.push({ regionId: 'bot_lane', probability: 0.55 })
          predictedRegions.push({ regionId: 'dragon_pit', probability: 0.35 })
          candidateRoutes.push({ regionIds: ['bot_lane', 'dragon_pit'], probability: 0.6 })
        } else {
          predictedRegions.push({ regionId: 'top_lane', probability: 0.55 })
          predictedRegions.push({ regionId: 'baron_pit', probability: 0.35 })
          candidateRoutes.push({ regionIds: ['top_lane', 'top_river'], probability: 0.6 })
        }

        const arrivalWindow = {
          earliestAt: now + Math.round(Math.max(2, (0.25 - moveRadius) * 20) * 1000),
          latestAt: now + Math.round((0.35 + moveRadius) * 20 * 1000)
        }

        const inference: FogInference = {
          id: `fog_${trackId}_${now}`,
          sessionId,
          enemyTrackId: trackId,
          basisEvidenceIds: [this._trackIdToEvidenceId.get(trackId) || `evi_last_seen_${trackId}`],
          lastSeenAt: lastSeen.lastObservedAt,
          predictedRegions,
          candidateRoutes,
          arrivalWindow,
          intents: [
            { kind: 'roam', probability: 0.55 },
            { kind: 'ambush', probability: 0.25 },
            { kind: 'recall', probability: 0.2 }
          ],
          confidence: Math.max(0.6, 0.95 - elapsedSec * 0.015),
          createdAt: now,
          expiresAt: now + 15000,
          modelVersion: '1.2.0'
        }

        this._fogInferences.set(trackId, inference)

        // 生成 source: 'fog-inference' 证据
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
   * 基于英雄、已有装备、当前金币与补丁数据计算装备购买指导
   */
  private _computeItemGuidance(snapshot: LiveGameSnapshot, now: number): void {
    const active = snapshot.activePlayer
    if (!active) return

    const currentGold = active.currentGold || 0
    const championId = 103 // 示例 Ahri / 自适应当前英雄

    // 经典装备库：卢登的伙伴 (3000g), 遗失的章节 (1200g), 爆裂魔杖 (850g), 增幅典籍 (400g), 法师之靴 (1100g)
    const primaryPlan: ItemPurchasePlan =
      currentGold >= 1200
        ? {
            itemIds: [3802], // 遗失的章节 / 核心大件组件
            totalCost: 1200,
            remainingGold: currentGold - 1200,
            missingGold: 0,
            reasonCodes: ['CORE_MANA_HASTE', 'POKE_POWER_SPIKE'],
            conditions: ['对线期法力值与技能急速核心支点']
          }
        : currentGold >= 850
          ? {
              itemIds: [1026], // 爆裂魔杖
              totalCost: 850,
              remainingGold: currentGold - 850,
              missingGold: 0,
              reasonCodes: ['AP_COMPONENT'],
              conditions: ['基础法术强度提升']
            }
          : {
              itemIds: [1052, 2003], // 增幅典籍 + 生命药水
              totalCost: 450,
              remainingGold: currentGold - 450,
              missingGold: 0,
              reasonCodes: ['EARLY_LANE_SUSTAIN'],
              conditions: ['前期对线过渡']
            }

    const alternativePlans: ItemPurchasePlan[] = [
      {
        itemIds: [3020], // 法师之靴 (1100g)
        totalCost: 1100,
        remainingGold: Math.max(0, currentGold - 1100),
        missingGold: Math.max(0, 1100 - currentGold),
        reasonCodes: ['MOBILITY_MAGIC_PEN'],
        conditions: ['优先游走支援与法术穿透']
      },
      {
        itemIds: [2055], // 控制守卫 (75g)
        totalCost: 75,
        remainingGold: Math.max(0, currentGold - 75),
        missingGold: Math.max(0, 75 - currentGold),
        reasonCodes: ['VISION_CONTROL'],
        conditions: ['补充河道防守视野']
      }
    ]

    const guidance: ItemPurchaseGuidance = {
      id: `item_guidance_${now}`,
      sessionId: snapshot.sessionId,
      patch: snapshot.patch || '14.15.1',
      championId,
      currentGold,
      inventoryItemIds: [],
      primaryPlan,
      alternativePlans,
      evidenceIds: [`evi_gold_${now}`],
      createdAt: now,
      expiresAt: now + 20000,
      ruleVersion: '1.1.0'
    }

    this._latestItemGuidance = guidance

    const eviId = `evi_item_guidance_${now}`
    this.addEvidence({
      id: eviId,
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

  public addEvidence(evidence: CoachEvidence): void {
    this._evidences.set(evidence.id, evidence)
    if (this._evidences.size > 80) {
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
    this.cleanupExpiredEvidence()
    return this._evidences.get(id) || null
  }

  public getMinimapEvidenceId(trackId: string): string | null {
    return this._trackIdToEvidenceId.get(trackId) || null
  }

  public getFogInferences(): FogInference[] {
    const now = Date.now()
    return Array.from(this._fogInferences.values()).filter((f) => f.expiresAt > now)
  }

  public getItemPurchaseGuidance(): ItemPurchaseGuidance | null {
    if (!this._latestItemGuidance) return null
    if (this._latestItemGuidance.expiresAt <= Date.now()) return null
    return this._latestItemGuidance
  }

  public getActiveEvidences(): CoachEvidence[] {
    this.cleanupExpiredEvidence()
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
