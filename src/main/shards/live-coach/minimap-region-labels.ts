const CHINESE_MINIMAP_REGION_LABELS: Record<string, string> = {
  top_lane: '上路',
  mid_lane: '中路',
  bot_lane: '下路',
  top_river: '上半河道',
  bot_river: '下半河道',
  top_jungle: '上半野区',
  bot_jungle: '下半野区',
  dragon_pit: '小龙坑',
  baron_pit: '纳什男爵坑',
  base_recall: '回城区域',
  mid: '中路',
  mid_river: '中路河道'
}

/** Keeps internal region ids out of Chinese coach copy and SAPI speech. */
export function toChineseMinimapRegionLabel(regionId: string | null | undefined): string {
  if (!regionId) return '某一区域'
  return CHINESE_MINIMAP_REGION_LABELS[regionId] ?? '未知区域'
}
