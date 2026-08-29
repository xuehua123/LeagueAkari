import type { CoachCue, CoachOption, MinimapDerivedEvent } from '@shared/types/live-coach'

import { toChineseMinimapRegionLabel } from './minimap-region-labels'
import type { CoachRule, RuleEvaluationContext } from './rule-engine'

function payloadRecord(event: MinimapDerivedEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {}
}

export class RuleHighPriorityMinimapChange implements CoachRule {
  public readonly id = 'rule_high_priority_minimap_change'
  public readonly version = '1.0.0'
  public readonly category = 'warning' as const
  private readonly _handledEventIds = new Set<string>()

  public reset(): void {
    this._handledEventIds.clear()
  }

  public evaluate(ctx: RuleEvaluationContext): CoachCue | null {
    if (!ctx.enabledCategories[this.category]) return null
    if (ctx.enabledCapabilities && !ctx.enabledCapabilities.has('coach.analyze.minimap-advanced')) {
      return null
    }

    const now = ctx.currentTime ?? Date.now()
    const relevantEvents = ctx.fusion
      .getMinimapEvents(now)
      .filter(
        (event) =>
          !this._handledEventIds.has(event.eventId) &&
          (event.kind === 'enemy-grouping-started' ||
            event.kind === 'enemy-visible-count-increased' ||
            event.kind === 'enemy-approaching-player-region' ||
            event.kind === 'enemy-converging-region' ||
            event.kind === 'visible-pincer-approach-predicted')
      )
    if (relevantEvents.length === 0) return null

    for (const event of relevantEvents) this._handledEventIds.add(event.eventId)
    if (this._handledEventIds.size > 200) {
      const oldestIds = Array.from(this._handledEventIds).slice(0, this._handledEventIds.size - 100)
      for (const id of oldestIds) this._handledEventIds.delete(id)
    }

    const selected =
      relevantEvents.find((event) => event.kind === 'visible-pincer-approach-predicted') ??
      relevantEvents.find((event) => event.kind === 'enemy-approaching-player-region') ??
      relevantEvents.find((event) => event.kind === 'enemy-converging-region') ??
      relevantEvents.find((event) => event.kind === 'enemy-grouping-started') ??
      relevantEvents[relevantEvents.length - 1]
    const payload = payloadRecord(selected)
    const regionId = typeof payload.regionId === 'string' ? payload.regionId : null
    const count = typeof payload.count === 'number' ? payload.count : null
    const currentCount = typeof payload.currentCount === 'number' ? payload.currentCount : null
    const evidenceId = `evi_minimap_event_${selected.eventId}`
    if (!ctx.fusion.getEvidence(evidenceId, now)) return null

    const regionText = toChineseMinimapRegionLabel(regionId)
    const observationText = (() => {
      switch (selected.kind) {
        case 'visible-pincer-approach-predicted':
          return `小地图当前看到 ${count ?? 2} 名敌人从不同方向靠近 ${regionText}，可能形成包夹`
        case 'enemy-approaching-player-region':
          return `小地图当前看到 ${count ?? 2} 名敌人正在靠近你所在的 ${regionText}`
        case 'enemy-converging-region':
          return `小地图当前看到 ${count ?? 2} 名敌人正在向 ${regionText} 汇聚`
        case 'enemy-grouping-started':
          return `小地图刚刚显示 ${count ?? 3} 名当前可见敌人在 ${regionText} 聚集`
        default:
          return `小地图当前可见敌人数量刚刚明显增加至 ${currentCount ?? '多名'}`
      }
    })()
    const options: CoachOption[] = [
      {
        id: 'opt_map_change_watch',
        label: regionId ? `优先关注 ${regionText} 方向` : '优先确认敌人出现方向',
        condition: null,
        evidenceIds: [evidenceId],
        role: 'primary',
        score: 0.92
      },
      {
        id: 'opt_map_change_safe',
        label: '暂时保持安全站位并补充可用视野',
        condition: null,
        evidenceIds: [evidenceId],
        role: 'alternative',
        score: 0.78
      }
    ]

    return {
      id: `cue_map_change_${selected.eventId}`,
      sessionId: ctx.sessionId,
      ruleId: this.id,
      ruleVersion: this.version,
      category: this.category,
      priority:
        selected.kind === 'visible-pincer-approach-predicted'
          ? 84
          : selected.kind === 'enemy-approaching-player-region'
            ? 80
            : selected.kind === 'enemy-grouping-started'
              ? 78
              : 72,
      observationText,
      impactText: '这是当前画面中的直接可见变化，请结合本人位置判断风险',
      options,
      spokenText: `${observationText}，注意地图变化。`,
      evidenceIds: [evidenceId],
      createdAt: now,
      expiresAt: Math.min(selected.timestamp + 10000, now + 6000),
      status: 'pending',
      cancellationReason: null
    }
  }
}
