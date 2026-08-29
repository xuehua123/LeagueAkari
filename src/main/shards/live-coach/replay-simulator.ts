import { CoachCue, CoachReplaySession } from '@shared/types/live-coach'

import { CURRENT_LIVE_COACH_PATCH } from './catalog/current'
import { CueSchedulerController } from './cue-scheduler-controller'
import { FactFusionEngine } from './fact-fusion'
import { CoachRuleEngine } from './rule-engine'

export interface ReplaySimulationOptions {
  speed?: number
  simulateSpeech?: boolean
  onCueGenerated?: (cue: CoachCue) => void
}

export interface ReplaySidecarData {
  version: string
  sessionId: string
  gameDurationSeconds: number
  patch: string
  totalCues: number
  timeline: Array<{
    timestampMs: number
    gameTimeFormatted: string
    category: string
    observation: string
    spokenText: string
    options: string[]
    evidenceIds: string[]
  }>
  evidencesSummary: {
    totalEvidences: number
  }
}

export class CoachReplaySimulator {
  private readonly _fusion: FactFusionEngine
  private readonly _ruleEngine: CoachRuleEngine
  private _timer: NodeJS.Timeout | null = null

  constructor(private readonly _scheduler?: CueSchedulerController) {
    this._fusion = new FactFusionEngine()
    this._ruleEngine = new CoachRuleEngine()
  }

  public get fusion(): FactFusionEngine {
    return this._fusion
  }

  public simulateSynchronous(session: CoachReplaySession): { totalCues: number; cues: CoachCue[] } {
    this._fusion.reset()
    this._ruleEngine.reset()
    const allCues: CoachCue[] = []

    for (const frame of session.frames) {
      if (frame.liveData) {
        this._fusion.updateLiveGameSnapshot(frame.liveData, frame.timestamp)
      }
      if (frame.minimap) {
        this._fusion.updateMinimapBatch(frame.minimap, frame.timestamp)
      }

      const cues = this._ruleEngine.evaluate({
        sessionId: session.metadata.sessionId,
        patch: session.metadata.patch,
        queueId: session.metadata.queueId,
        fusion: this._fusion,
        enabledCategories: {
          information: true,
          warning: true,
          opportunity: true,
          system: true,
          review: true
        },
        currentTime: frame.timestamp
      })

      if (cues.length > 0) {
        for (const cue of cues) {
          cue.createdAt = frame.timestamp
          allCues.push(cue)
        }
        if (this._scheduler) {
          this._scheduler.submitCues(cues)
        }
      }
    }

    return {
      totalCues: allCues.length,
      cues: allCues
    }
  }

  public generateSidecar(session: CoachReplaySession, cues: CoachCue[]): ReplaySidecarData {
    return {
      version: '1.0.0',
      sessionId: session.metadata.sessionId,
      gameDurationSeconds: session.metadata.durationSeconds || 1200,
      patch: session.metadata.patch || 'unknown',
      totalCues: cues.length,
      timeline: cues.map((c) => {
        const totalSec = Math.floor((c.createdAt - session.metadata.recordedAt) / 1000)
        const mins = Math.floor(Math.max(0, totalSec) / 60)
        const secs = Math.max(0, totalSec) % 60
        return {
          timestampMs: c.createdAt,
          gameTimeFormatted: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
          category: c.category,
          observation: c.observationText,
          spokenText: c.spokenText,
          options: c.options.map((o) => o.label),
          evidenceIds: c.evidenceIds
        }
      }),
      evidencesSummary: {
        totalEvidences: this._fusion.getActiveEvidences(
          session.frames.length > 0
            ? session.frames[session.frames.length - 1].timestamp
            : session.metadata.recordedAt
        ).length
      }
    }
  }

  public generateMarkdownReport(sidecar: ReplaySidecarData): string {
    let md = `# 对局 AI 教练战术复盘报告\n\n`
    md += `- **对局 ID**: \`${sidecar.sessionId}\`\n`
    md += `- **游戏版本**: \`${sidecar.patch}\`\n`
    md += `- **战术提示触发总数**: **${sidecar.totalCues}** 条\n\n`
    md += `## 战术关键时刻时间轴\n\n`

    if (sidecar.timeline.length === 0) {
      md += `*本局未检测到异常战术事件*\n`
    } else {
      for (const item of sidecar.timeline) {
        md += `### [${item.gameTimeFormatted}] ${item.category.toUpperCase()}: ${item.observation}\n`
        md += `- **语音播报**: *"${item.spokenText}"*\n`
        md += `- **决策选项建议**: ${item.options.join(' / ')}\n`
        md += `- **关联证据 ID**: \`${item.evidenceIds.join(', ') || 'none'}\`\n\n`
      }
    }

    return md
  }

  public createSampleReplaySession(): CoachReplaySession {
    const now = Date.now()
    const recordedAt = now - 900000 // 15 mins ago

    return {
      metadata: {
        sessionId: `replay_sample_${now}`,
        mapId: 11,
        queueId: 420,
        patch: CURRENT_LIVE_COACH_PATCH,
        recordedAt,
        durationSeconds: 900
      },
      frames: [
        // Frame 1: 4:30 Dragon Spawn Warning & Item Guidance
        {
          timestamp: recordedAt + 270000,
          liveData: {
            sessionId: `replay_sample_${now}`,
            patch: CURRENT_LIVE_COACH_PATCH,
            gameTimeSeconds: 270,
            clock: {
              observedAt: recordedAt + 270000,
              receivedAt: recordedAt + 270000,
              sequence: 1
            },
            activePlayer: {
              summonerName: 'TestPlayer',
              riotId: 'Test#CN',
              riotIdGameName: 'Test',
              riotIdTagLine: 'CN',
              championName: 'Garen', // 真实英雄：盖伦
              level: 6,
              currentGold: 1300,
              team: 'ORDER',
              abilities: {}
            },
            players: [
              {
                summonerName: 'TestPlayer',
                riotId: 'Test#CN',
                riotIdGameName: 'Test',
                riotIdTagLine: 'CN',
                championName: 'Garen',
                championId: 86,
                team: 'ORDER',
                position: 'TOP',
                level: 6,
                isDead: false,
                respawnTimer: 0,
                isBot: false,
                kills: 1,
                deaths: 0,
                assists: 0,
                creepScore: 42,
                wardScore: 3,
                items: [
                  {
                    canUse: true,
                    consumable: false,
                    count: 1,
                    displayName: '多兰之盾',
                    itemID: 1054,
                    price: 450,
                    slot: 0
                  }
                ],
                summonerSpells: {}
              }
            ],
            events: [],
            sourceHealth: []
          }
        },
        // Frame 2: 7:15 Minimap Observation (Enemy Mid Last Seen)
        {
          timestamp: recordedAt + 435000,
          minimap: {
            sessionId: `replay_sample_${now}`,
            patch: CURRENT_LIVE_COACH_PATCH,
            calibrationVersion: '1.0.0',
            modelVersions: {},
            frame: {
              observedAt: recordedAt + 435000,
              receivedAt: recordedAt + 435000,
              sequence: 2,
              ageMs: 15
            },
            health: 'healthy',
            entities: [
              {
                trackId: 'enemy_mid_zed',
                kind: 'enemy',
                team: 'enemy',
                championId: 238, // Zed
                point: { x: 0.5, y: 0.5 },
                regionId: 'mid_lane',
                confidence: 0.95,
                lifecycle: 'confirmed',
                firstObservedAt: recordedAt + 435000,
                lastObservedAt: recordedAt + 435000,
                expiresAt: recordedAt + 440000
              }
            ],
            events: []
          }
        },
        // Frame 3: 7:25 Fog Inference Triggered (Enemy Mid Disappeared for 10s -> Roaming to Bot River)
        {
          timestamp: recordedAt + 445000,
          liveData: {
            sessionId: `replay_sample_${now}`,
            patch: CURRENT_LIVE_COACH_PATCH,
            gameTimeSeconds: 445,
            clock: {
              observedAt: recordedAt + 445000,
              receivedAt: recordedAt + 445000,
              sequence: 3
            },
            activePlayer: {
              summonerName: 'TestPlayer',
              riotId: 'Test#CN',
              riotIdGameName: 'Test',
              riotIdTagLine: 'CN',
              championName: 'Garen',
              level: 7,
              currentGold: 300,
              team: 'ORDER',
              abilities: {}
            },
            players: [],
            events: [],
            sourceHealth: []
          },
          minimap: {
            sessionId: `replay_sample_${now}`,
            patch: CURRENT_LIVE_COACH_PATCH,
            calibrationVersion: '1.0.0',
            modelVersions: {},
            frame: {
              observedAt: recordedAt + 445000,
              receivedAt: recordedAt + 445000,
              sequence: 4,
              ageMs: 15
            },
            health: 'healthy',
            entities: [], // Zed in fog
            events: []
          }
        },
        // Frame 4: 13:40 Turret Plating Fall Warning
        {
          timestamp: recordedAt + 820000,
          liveData: {
            sessionId: `replay_sample_${now}`,
            patch: CURRENT_LIVE_COACH_PATCH,
            gameTimeSeconds: 820,
            clock: {
              observedAt: recordedAt + 820000,
              receivedAt: recordedAt + 820000,
              sequence: 5
            },
            activePlayer: {
              summonerName: 'TestPlayer',
              riotId: 'Test#CN',
              riotIdGameName: 'Test',
              riotIdTagLine: 'CN',
              championName: 'Garen',
              level: 10,
              currentGold: 450,
              team: 'ORDER',
              abilities: {}
            },
            players: [],
            events: [],
            sourceHealth: []
          }
        },
        // Frame 5: 14:10 Enemy Grouping in Mid Lane (3 enemies clustered)
        {
          timestamp: recordedAt + 850000,
          liveData: {
            sessionId: `replay_sample_${now}`,
            patch: CURRENT_LIVE_COACH_PATCH,
            gameTimeSeconds: 850,
            clock: {
              observedAt: recordedAt + 850000,
              receivedAt: recordedAt + 850000,
              sequence: 6
            },
            activePlayer: {
              summonerName: 'TestPlayer',
              riotId: 'Test#CN',
              riotIdGameName: 'Test',
              riotIdTagLine: 'CN',
              championName: 'Garen',
              level: 11,
              currentGold: 400,
              team: 'ORDER',
              abilities: {}
            },
            players: [],
            events: [],
            sourceHealth: []
          },
          minimap: {
            sessionId: `replay_sample_${now}`,
            patch: CURRENT_LIVE_COACH_PATCH,
            calibrationVersion: '1.0.0',
            modelVersions: {},
            frame: {
              observedAt: recordedAt + 850000,
              receivedAt: recordedAt + 850000,
              sequence: 7,
              ageMs: 15
            },
            health: 'healthy',
            entities: [
              {
                trackId: 'enemy_mid_1',
                kind: 'enemy',
                team: 'enemy',
                championId: 103,
                point: { x: 0.5, y: 0.5 },
                regionId: 'mid',
                confidence: 0.95,
                lifecycle: 'confirmed',
                firstObservedAt: recordedAt + 850000,
                lastObservedAt: recordedAt + 850000,
                expiresAt: recordedAt + 855000
              },
              {
                trackId: 'enemy_jungle_2',
                kind: 'enemy',
                team: 'enemy',
                championId: 64,
                point: { x: 0.52, y: 0.48 },
                regionId: 'mid_river',
                confidence: 0.93,
                lifecycle: 'confirmed',
                firstObservedAt: recordedAt + 850000,
                lastObservedAt: recordedAt + 850000,
                expiresAt: recordedAt + 855000
              },
              {
                trackId: 'enemy_support_3',
                kind: 'enemy',
                team: 'enemy',
                championId: 412,
                point: { x: 0.49, y: 0.53 },
                regionId: 'mid',
                confidence: 0.96,
                lifecycle: 'confirmed',
                firstObservedAt: recordedAt + 850000,
                lastObservedAt: recordedAt + 850000,
                expiresAt: recordedAt + 855000
              }
            ],
            events: []
          }
        }
      ]
    }
  }

  public stop(): void {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    this._fusion.reset()
  }
}
