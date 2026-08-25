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
          { id: 1042, name: '短剑', cost: 250 }
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
  mage: {
    archetype: 'mage',
    coreItems: [
      {
        id: 6655, // 卢登的伙伴 (Riot Data Dragon 6655)
        name: '卢登的伙伴',
        cost: 2900,
        components: [
          { id: 3802, name: '遗失的章节', cost: 1200 }, // 遗失的章节标准 ID: 3802
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
          { id: 1026, name: '爆裂魔杖', cost: 850 },
          { id: 1052, name: '增幅典籍', cost: 400 }
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
        id: 3031, // 无尽之刃
        name: '无尽之刃',
        cost: 3400,
        components: [
          { id: 1038, name: '暴风之剑', cost: 1300 },
          { id: 1037, name: '十字镐', cost: 875 },
          { id: 1018, name: '灵巧披风', cost: 600 } // 灵巧披风标准 ID: 1018
        ],
        reason: '核心高额暴击伤害提升'
      },
      {
        id: 6672, // 海妖杀手
        name: '海妖杀手',
        cost: 3100,
        components: [
          { id: 1037, name: '十字镐', cost: 875 },
          { id: 3086, name: '狂热', cost: 1100 },
          { id: 1042, name: '短剑', cost: 250 }
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
        id: 3068, // 日炎圣盾
        name: '日炎圣盾',
        cost: 2700,
        components: [
          { id: 3751, name: '斑比的熔渣', cost: 900 },
          { id: 1031, name: '锁子甲', cost: 800 },
          { id: 1028, name: '红水晶', cost: 400 }
        ],
        reason: '持续魔法伤害与坦度'
      },
      {
        id: 3083, // 狂徒铠甲
        name: '狂徒铠甲',
        cost: 3100,
        components: [
          { id: 3801, name: '晶体护臂', cost: 800 },
          { id: 3067, name: '燃烧宝石', cost: 800 },
          { id: 1011, name: '巨人腰带', cost: 900 } // 巨人腰带标准 ID: 1011
        ],
        reason: '脱战高额生命恢复'
      }
    ],
    boots: { id: 3111, name: '水银之靴', cost: 1100, reason: '韧性与魔抗' }
  },
  assassin: {
    archetype: 'assassin',
    coreItems: [
      {
        id: 3142, // 幽梦之灵
        name: '幽梦之灵',
        cost: 2700,
        components: [
          { id: 3134, name: '锯齿短匕', cost: 1000 },
          { id: 3133, name: '考尔菲德的战锤', cost: 1100 }
        ],
        reason: '爆发穿甲与高额游走移速'
      },
      {
        id: 3814, // 夜之锋刃
        name: '夜之锋刃',
        cost: 2800,
        components: [
          { id: 3134, name: '锯齿短匕', cost: 1000 },
          { id: 1011, name: '巨人腰带', cost: 900 }, // 巨人腰带标准 ID: 1011
          { id: 1036, name: '长剑', cost: 350 }
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
        id: 3504, // 炽热香炉
        name: '炽热香炉',
        cost: 2300,
        components: [
          { id: 3113, name: '以太精魂', cost: 850 },
          { id: 3114, name: '禁忌雕像', cost: 800 },
          { id: 1052, name: '增幅典籍', cost: 400 }
        ],
        reason: '护盾强度与友方攻速增益'
      },
      {
        id: 6617, // 月石再生器
        name: '月石再生器',
        cost: 2200,
        components: [
          { id: 3108, name: '恶魔法典', cost: 900 },
          { id: 3067, name: '燃烧宝石', cost: 800 }
        ],
        reason: '连锁治疗与护盾扩散'
      }
    ],
    boots: { id: 3158, name: '明朗之靴', cost: 900, reason: '技能与召唤师技能急速' }
  }
}

// 英雄流派分类库（包含 Smolder 斯莫德及全部英雄分类）
const CHAMPION_ROLES_MAP: Record<
  string,
  'fighter' | 'mage' | 'marksman' | 'tank' | 'assassin' | 'support'
> = {
  smolder: 'marksman',
  jinx: 'marksman',
  ashe: 'marksman',
  caitlyn: 'marksman',
  vayne: 'marksman',
  kaisa: 'marksman',
  ezreal: 'marksman',
  tristana: 'marksman',
  lucian: 'marksman',
  jhin: 'marksman',
  varus: 'marksman',
  samira: 'marksman',
  draven: 'marksman',
  aphelios: 'marksman',
  zeri: 'marksman',
  kogmaw: 'marksman',
  missfortune: 'marksman',
  sivir: 'marksman',
  twitch: 'marksman',
  xayah: 'marksman',
  nilah: 'marksman',
  kalista: 'marksman',
  akshan: 'marksman',
  ahri: 'mage',
  lux: 'mage',
  syndra: 'mage',
  orianna: 'mage',
  veigar: 'mage',
  viktor: 'mage',
  xerath: 'mage',
  annie: 'mage',
  anivia: 'mage',
  aurelionsol: 'mage',
  azir: 'mage',
  brand: 'mage',
  cassiopeia: 'mage',
  hwei: 'mage',
  karma: 'mage',
  karthus: 'mage',
  leblanc: 'mage',
  lissandra: 'mage',
  malzahar: 'mage',
  neeko: 'mage',
  ryze: 'mage',
  swain: 'mage',
  taliyah: 'mage',
  twistedfate: 'mage',
  velkoz: 'mage',
  vex: 'mage',
  vladimir: 'mage',
  ziggs: 'mage',
  zoe: 'mage',
  garen: 'fighter',
  darius: 'fighter',
  sett: 'fighter',
  renekton: 'fighter',
  aatrox: 'fighter',
  camille: 'fighter',
  fiora: 'fighter',
  irelia: 'fighter',
  jax: 'fighter',
  kled: 'fighter',
  mordekaiser: 'fighter',
  olaf: 'fighter',
  pantheon: 'fighter',
  riven: 'fighter',
  warwick: 'fighter',
  wukong: 'fighter',
  xinzhao: 'fighter',
  yone: 'fighter',
  yasuo: 'fighter',
  briar: 'fighter',
  ambessa: 'fighter',
  malphite: 'tank',
  ornn: 'tank',
  sion: 'tank',
  leona: 'tank',
  nautilus: 'tank',
  shen: 'tank',
  chogath: 'tank',
  alistar: 'tank',
  amumu: 'tank',
  braum: 'tank',
  ksante: 'tank',
  maokai: 'tank',
  poppy: 'tank',
  rammus: 'tank',
  rell: 'tank',
  sejuani: 'tank',
  tahmkench: 'tank',
  taric: 'tank',
  zac: 'tank',
  zed: 'assassin',
  talon: 'assassin',
  khazix: 'assassin',
  kayn: 'assassin',
  qiyana: 'assassin',
  pyke: 'assassin',
  akali: 'assassin',
  diana: 'assassin',
  ekko: 'assassin',
  evelynn: 'assassin',
  fizz: 'assassin',
  kassadin: 'assassin',
  katarina: 'assassin',
  naafiri: 'assassin',
  nocturne: 'assassin',
  rengar: 'assassin',
  shaco: 'assassin',
  lulu: 'support',
  nami: 'support',
  janna: 'support',
  sona: 'support',
  soraka: 'support',
  yuumi: 'support',
  milio: 'support',
  rakan: 'support',
  bard: 'support',
  senna: 'support',
  zilean: 'support'
}

export class FactFusionEngine {
  private readonly _evidences = new Map<string, CoachEvidence>()
  private readonly _fogInferences = new Map<string, FogInference>()
  private _latestLiveGameSnapshot: LiveGameSnapshot | null = null
  private _latestMinimapBatch: MinimapObservationBatch | null = null
  private _latestItemGuidance: ItemPurchaseGuidance | null = null
  private readonly _trackIdToEvidenceId = new Map<string, string>()

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
    this._latestLiveGameSnapshot = null
    this._latestMinimapBatch = null
    this._latestItemGuidance = null
    this._trackIdToEvidenceId.clear()
    this._lastSeenEnemies.clear()
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
        patch: snapshot.patch || '14.15.1',
        clock: { observedAt: now, receivedAt: now, sequence: 1 },
        freshness: { expiresAt: now + 35000, state: 'fresh' },
        payload: snapshot.activePlayer
      })
    }

    // 2. 运行动态装备流派与组件抵扣计算
    this._computeItemGuidance(snapshot, now)
  }

  public updateMinimapBatch(batch: MinimapObservationBatch, virtualNow?: number): void {
    this._latestMinimapBatch = batch
    const now = virtualNow ?? Date.now()
    const invalidatedEvidenceIds: string[] = []

    if (batch.health === 'healthy') {
      for (const entity of batch.entities) {
        // 关键修复：忽略 invalidated 轨迹，只有 candidate 或 confirmed 状态才视为当前可见实体！
        if (entity.lifecycle === 'invalidated') {
          continue
        }

        const evidenceId = `evi_minimap_${entity.trackId}_${now}`
        this._trackIdToEvidenceId.set(entity.trackId, evidenceId)

        this.addEvidence({
          id: evidenceId,
          sessionId: batch.sessionId,
          temporalScope: 'current',
          source: 'minimap',
          kind: entity.kind === 'enemy' ? 'enemy-seen' : 'neutral-seen',
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
    }

    if (invalidatedEvidenceIds.length > 0 && this.onEvidenceInvalidated) {
      this.onEvidenceInvalidated(invalidatedEvidenceIds)
    }

    // 运行迷雾时空推断
    this._computeFogInferences(batch.sessionId, batch.patch, now)
  }

  /**
   * 计算迷雾与不可见敌人时空推断（考虑速度向量、死亡英雄 ID 抑制、地图图结构与阵营）
   */
  private _computeFogInferences(sessionId: string, patch: string, now: number): void {
    // 检查是否有玩家已死亡（死亡玩家不参与迷雾游走推断）
    const deadChampionIds = new Set<number>()
    const deadTrackIds = new Set<string>()

    if (this._latestLiveGameSnapshot) {
      for (const p of this._latestLiveGameSnapshot.players) {
        if (p.isDead || (p.respawnTimer && p.respawnTimer > 0)) {
          if (p.championId) deadChampionIds.add(p.championId)
          deadTrackIds.add(p.summonerName.toLowerCase())
          deadTrackIds.add(`enemy_${p.championName.toLowerCase()}`)
          if (p.championId) deadTrackIds.add(`enemy_${p.championId}`)
        }
      }
    }

    for (const [trackId, lastSeen] of this._lastSeenEnemies.entries()) {
      // 关键修复：通过 lastSeen.championId 与 deadChampionIds 精准匹配抑制死亡敌方英雄！
      if (
        (lastSeen.championId && deadChampionIds.has(lastSeen.championId)) ||
        deadTrackIds.has(trackId.toLowerCase())
      ) {
        this._fogInferences.delete(trackId)
        continue
      }

      const elapsedSec = Math.max(0, (now - lastSeen.lastObservedAt) / 1000)

      // 敌方英雄消失在迷雾中 3 秒至 30 秒之间进行空间推断
      if (elapsedSec >= 3 && elapsedSec <= 30) {
        // 计算运动方向向量
        let vy = 0
        if (lastSeen.prevPoint && lastSeen.prevObservedAt) {
          const dt = Math.max(0.1, (lastSeen.lastObservedAt - lastSeen.prevObservedAt) / 1000)
          vy = (lastSeen.point.y - lastSeen.prevPoint.y) / dt
        }

        // 英雄移动速度：归一化速度约 0.022 / s (340 码/s)
        const heroSpeed = 0.022
        const moveDist = elapsedSec * heroSpeed

        const predictedRegions: Array<{ regionId: string; probability: number }> = []
        const candidateRoutes: Array<{ regionIds: string[]; probability: number }> = []

        // 根据位置与运动向量推断（静止时对称分布，消除单向偏好退化）
        const isMoving = Math.abs(vy) > 0.005
        const isHeadingBot = isMoving && vy > 0.005
        const isHeadingTop = isMoving && vy < -0.005

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

        const fogEviId = `evi_fog_${trackId}_${now}`
        const inference: FogInference = {
          id: `${trackId}_${now}`,
          sessionId,
          enemyTrackId: trackId,
          basisEvidenceIds: [basisEviId],
          lastSeenAt: lastSeen.lastObservedAt,
          predictedRegions,
          candidateRoutes,
          arrivalWindow,
          intents: [{ kind: 'roam', probability: predictedRegions[0].probability }],
          confidence: Math.max(0.65, Math.min(0.95, 1 - elapsedSec / 35)),
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
        this._fogInferences.delete(trackId)
      }
    }
  }

  /**
   * 基于本人真实英雄、已有装备、当前金币与流派数据计算装备购买指导
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

    const championNameClean = (active.championName || '').toLowerCase().replace(/[^a-z]/g, '')
    const championId = matchingPlayer?.championId ?? (active as any).championId ?? null

    // 关键修复：当本人英雄无法确认 (championId === null 或非正数) 时，不生成非法 Guidance！
    if (championId === null || typeof championId !== 'number' || championId <= 0) {
      this._latestItemGuidance = null
      return
    }

    // 确定英雄流派
    let role = CHAMPION_ROLES_MAP[championNameClean]
    if (!role && matchingPlayer?.position) {
      const pos = matchingPlayer.position.toUpperCase()
      if (pos === 'TOP' || pos === 'JUNGLE') role = 'fighter'
      else if (pos === 'MIDDLE') role = 'mage'
      else if (pos === 'BOTTOM') role = 'marksman'
      else if (pos === 'UTILITY') role = 'support'
    }
    if (!role) {
      role = 'fighter'
    }

    const buildDef = CHAMPION_BUILDS[role] || CHAMPION_BUILDS.fighter
    const inventoryItemIds = (matchingPlayer?.items ?? []).map((i) => i.itemID)

    // 1. 创建并持久化金币与装备 Evidence
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

    // 2. 找到尚未完成的第一个核心大件
    const uncompletedCore =
      buildDef.coreItems.find((item) => !inventoryItemIds.includes(item.id)) ||
      buildDef.coreItems[0]

    // 检查已拥有的组件并抵扣总花费
    let netCost = uncompletedCore.cost
    const ownedComponents = uncompletedCore.components.filter((comp) =>
      inventoryItemIds.includes(comp.id)
    )
    for (const comp of ownedComponents) {
      netCost -= comp.cost
    }
    netCost = Math.max(0, netCost)

    // 3. 构建购买方案
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
      // 检查是否有玩家买得起的未拥有组件
      const affordableUnownedComp = uncompletedCore.components.find(
        (comp) => !inventoryItemIds.includes(comp.id) && currentGold >= comp.cost
      )

      if (affordableUnownedComp) {
        primaryPlan = {
          itemIds: [affordableUnownedComp.id],
          totalCost: affordableUnownedComp.cost,
          remainingGold: currentGold - affordableUnownedComp.cost,
          missingGold: 0,
          reasonCodes: ['CORE_COMPONENT_AFFORDABLE'],
          conditions: [`合成 ${uncompletedCore.name} 组件：${affordableUnownedComp.name}`]
        }
      } else {
        const nextComp =
          uncompletedCore.components.find((comp) => !inventoryItemIds.includes(comp.id)) ||
          uncompletedCore.components[0]
        primaryPlan = {
          itemIds: [nextComp.id],
          totalCost: nextComp.cost,
          remainingGold: 0,
          missingGold: Math.max(0, nextComp.cost - currentGold),
          reasonCodes: ['CORE_COMPONENT_PROGRESSION'],
          conditions: [`合成 ${uncompletedCore.name} 组件：${nextComp.name}`]
        }
      }
    }

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
   * 解析对局中立资源（巨龙 / 峡谷先锋 / 男爵 / 巢虫）即将刷新的准确时间（排除已存活对象）
   */
  public getNextObjectiveSchedule(gameTimeSeconds: number | null): ObjectiveSchedule | null {
    if (gameTimeSeconds === null) return null

    const events = this._latestLiveGameSnapshot?.events ?? []

    // 1. 巨龙击杀事件与下次刷新
    let lastDragonKillTime: number | null = null
    for (const ev of events) {
      if (ev.eventName === 'DragonKill') {
        lastDragonKillTime = ev.eventTime
      }
    }
    const dragonSpawnTime = lastDragonKillTime === null ? 300 : lastDragonKillTime + 300

    // 2. 虚空巢虫（6:00 刷新，14:00 绝版）
    const grubsSpawnTime = 360

    // 3. 峡谷先锋（14:00 刷新，19:55 绝版）
    const heraldSpawnTime = 840

    // 4. 纳什男爵（20:00 刷新，击杀后 6 分钟）
    let lastBaronKillTime: number | null = null
    for (const ev of events) {
      if (ev.eventName === 'BaronKill') {
        lastBaronKillTime = ev.eventTime
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
    if (gameTimeSeconds >= 800 && gameTimeSeconds < heraldSpawnTime) {
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

  public getActivePlayer(): NormalizedPlayer | null {
    if (!this._latestLiveGameSnapshot?.activePlayer) return null
    const active = this._latestLiveGameSnapshot.activePlayer
    return (
      this._latestLiveGameSnapshot.players.find(
        (p) =>
          p.summonerName === active.summonerName ||
          p.riotId === active.riotId ||
          p.championName === active.championName
      ) || null
    )
  }
}
