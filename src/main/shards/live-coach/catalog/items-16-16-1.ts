export interface ItemCatalogEntry {
  id: number
  name: string
  totalCost: number
  baseCost: number
  from: number[]
}

export interface ItemCatalogSnapshot {
  version: string
  items: Record<number, ItemCatalogEntry>
}

export const RiotItemCatalog16_16_1: ItemCatalogSnapshot = {
  version: '16.16.1',
  items: {
    1001: { id: 1001, name: '速度之靴', totalCost: 300, baseCost: 300, from: [] },
    1011: { id: 1011, name: '巨人腰带', totalCost: 900, baseCost: 500, from: [1028] },
    1018: { id: 1018, name: '灵巧披风', totalCost: 600, baseCost: 600, from: [] },
    1027: { id: 1027, name: '蓝水晶', totalCost: 350, baseCost: 350, from: [] },
    1028: { id: 1028, name: '红水晶', totalCost: 400, baseCost: 400, from: [] },
    1029: { id: 1029, name: '布甲', totalCost: 300, baseCost: 300, from: [] },
    1031: { id: 1031, name: '锁子甲', totalCost: 800, baseCost: 500, from: [1029] },
    1033: { id: 1033, name: '抗魔斗篷', totalCost: 400, baseCost: 400, from: [] },
    1036: { id: 1036, name: '长剑', totalCost: 350, baseCost: 350, from: [] },
    1037: { id: 1037, name: '十字镐', totalCost: 875, baseCost: 875, from: [] },
    1038: { id: 1038, name: '暴风大剑', totalCost: 1300, baseCost: 1300, from: [] },
    1042: { id: 1042, name: '短剑', totalCost: 250, baseCost: 250, from: [] },
    1043: { id: 1043, name: '反曲之弓', totalCost: 700, baseCost: 450, from: [1042] },
    1052: { id: 1052, name: '增幅典籍', totalCost: 400, baseCost: 400, from: [] },
    1053: { id: 1053, name: '吸血鬼节杖', totalCost: 900, baseCost: 550, from: [1036] },
    1054: { id: 1054, name: '多兰之盾', totalCost: 450, baseCost: 450, from: [] },
    1055: { id: 1055, name: '多兰之刃', totalCost: 450, baseCost: 450, from: [] },
    1056: { id: 1056, name: '多兰之戒', totalCost: 400, baseCost: 400, from: [] },
    1057: { id: 1057, name: '负极斗篷', totalCost: 850, baseCost: 450, from: [1033] },
    1058: { id: 1058, name: '无用大棒', totalCost: 1200, baseCost: 1200, from: [] },
    1082: { id: 1082, name: '黑暗封印', totalCost: 350, baseCost: 350, from: [] },
    2003: { id: 2003, name: '生命药水', totalCost: 50, baseCost: 50, from: [] },
    2021: { id: 2021, name: '掘道钻头', totalCost: 1150, baseCost: 400, from: [1028, 1036] },
    2055: { id: 2055, name: '控制守卫', totalCost: 75, baseCost: 75, from: [] },
    2504: { id: 2504, name: '败魔', totalCost: 2900, baseCost: 800, from: [3211, 1057] },
    3006: { id: 3006, name: '狂战士胫甲', totalCost: 1100, baseCost: 550, from: [1001, 1042] },
    3009: { id: 3009, name: '轻灵之靴', totalCost: 900, baseCost: 600, from: [1001] },
    3020: { id: 3020, name: '法师之靴', totalCost: 1100, baseCost: 800, from: [1001] },
    3024: { id: 3024, name: '冰川圆盾', totalCost: 900, baseCost: 250, from: [1029, 1027] },
    3031: { id: 3031, name: '无尽之刃', totalCost: 3500, baseCost: 725, from: [1038, 1037, 1018] },
    3035: { id: 3035, name: '最后的轻语', totalCost: 1450, baseCost: 750, from: [1036, 1036] },
    3036: {
      id: 3036,
      name: '多米尼克领主的致意',
      totalCost: 3000,
      baseCost: 950,
      from: [3035, 1018]
    },
    3044: { id: 3044, name: '净蚀', totalCost: 1100, baseCost: 350, from: [1028, 1036] },
    3047: { id: 3047, name: '铁板靴', totalCost: 1200, baseCost: 600, from: [1001, 1029] },
    3051: { id: 3051, name: '缚炉之斧', totalCost: 1200, baseCost: 600, from: [1042, 1036] },
    3053: {
      id: 3053,
      name: '斯特拉克的挑战护手',
      totalCost: 3200,
      baseCost: 775,
      from: [1037, 2021, 1028]
    },
    3067: { id: 3067, name: '燃烧宝石', totalCost: 800, baseCost: 400, from: [1028] },
    3068: { id: 3068, name: '日炎圣盾', totalCost: 2800, baseCost: 700, from: [6660, 1031, 1028] },
    3071: {
      id: 3071,
      name: '黑色切割者',
      totalCost: 3000,
      baseCost: 225,
      from: [3044, 3067, 1037]
    },
    3072: { id: 3072, name: '饮血剑', totalCost: 3400, baseCost: 325, from: [1038, 1037, 1053] },
    3076: { id: 3076, name: '棘刺背心', totalCost: 800, baseCost: 200, from: [1029, 1029] },
    3077: { id: 3077, name: '提亚马特', totalCost: 1200, baseCost: 500, from: [1036, 1036] },
    3078: { id: 3078, name: '三相之力', totalCost: 3333, baseCost: 233, from: [3051, 3133, 3067] },
    3083: { id: 3083, name: '狂徒铠甲', totalCost: 3100, baseCost: 500, from: [1011, 1011, 3801] },
    3086: { id: 3086, name: '狂热', totalCost: 1100, baseCost: 250, from: [1042, 1018] },
    3089: {
      id: 3089,
      name: '灭世者的死亡之帽',
      totalCost: 3600,
      baseCost: 1200,
      from: [1058, 1058]
    },
    3102: { id: 3102, name: '女妖面纱', totalCost: 3000, baseCost: 200, from: [1058, 4632] },
    3110: { id: 3110, name: '冰霜之心', totalCost: 2500, baseCost: 800, from: [1031, 3024] },
    3111: { id: 3111, name: '水银之靴', totalCost: 1250, baseCost: 550, from: [1001, 1033] },
    3113: { id: 3113, name: '以太精魂', totalCost: 900, baseCost: 500, from: [1052] },
    3114: { id: 3114, name: '禁忌雕像', totalCost: 600, baseCost: 600, from: [] },
    3117: { id: 3117, name: '疾行之靴', totalCost: 1000, baseCost: 700, from: [1001] },
    3123: { id: 3123, name: '处刑人的重击', totalCost: 800, baseCost: 450, from: [1036] },
    3133: { id: 3133, name: '考尔菲德的战锤', totalCost: 1100, baseCost: 400, from: [1036, 1036] },
    3134: { id: 3134, name: '锯齿短匕', totalCost: 1000, baseCost: 300, from: [1036, 1036] },
    3135: { id: 3135, name: '虚空之杖', totalCost: 3000, baseCost: 1500, from: [3145, 1052] },
    3142: { id: 3142, name: '幽梦之灵', totalCost: 2800, baseCost: 675, from: [3134, 6690, 1036] },
    3143: { id: 3143, name: '兰顿之兆', totalCost: 2700, baseCost: 1000, from: [1011, 1031] },
    3145: {
      id: 3145,
      name: '海克斯科技发电机',
      totalCost: 1100,
      baseCost: 300,
      from: [1052, 1052]
    },
    3155: { id: 3155, name: '海克斯饮魔刀', totalCost: 1300, baseCost: 550, from: [1036, 1033] },
    3156: { id: 3156, name: '玛莫提乌斯之噬', totalCost: 3100, baseCost: 700, from: [3155, 3133] },
    3157: { id: 3157, name: '中娅沙漏', totalCost: 3250, baseCost: 450, from: [1058, 3191] },
    3158: { id: 3158, name: '明朗之靴', totalCost: 900, baseCost: 600, from: [1001] },
    3191: {
      id: 3191,
      name: '探索者的护臂',
      totalCost: 1600,
      baseCost: 500,
      from: [1052, 1052, 1029]
    },
    3211: { id: 3211, name: '幽魂斗篷', totalCost: 1250, baseCost: 450, from: [1028, 1033] },
    3340: { id: 3340, name: '隐形守卫', totalCost: 0, baseCost: 0, from: [] },
    3363: { id: 3363, name: '远见改造', totalCost: 0, baseCost: 0, from: [] },
    3364: { id: 3364, name: '神谕透镜', totalCost: 0, baseCost: 0, from: [] },
    3504: { id: 3504, name: '炽热香炉', totalCost: 2200, baseCost: 700, from: [3113, 3114] },
    3801: { id: 3801, name: '晶体护腕', totalCost: 800, baseCost: 400, from: [1028] },
    3802: { id: 3802, name: '遗失的章节', totalCost: 1200, baseCost: 450, from: [1052, 1027] },
    3814: { id: 3814, name: '夜之锋刃', totalCost: 3000, baseCost: 850, from: [3134, 2021] },
    3916: { id: 3916, name: '湮灭宝珠', totalCost: 800, baseCost: 400, from: [1052] },
    4632: { id: 4632, name: '翠绿屏障', totalCost: 1600, baseCost: 800, from: [1052, 1033] },
    4642: { id: 4642, name: '班德尔玻璃镜', totalCost: 900, baseCost: 500, from: [1052] },
    4645: { id: 4645, name: '影焰', totalCost: 3200, baseCost: 900, from: [3145, 1058] },
    6617: { id: 6617, name: '月石再生器', totalCost: 2200, baseCost: 500, from: [3067, 4642] },
    6631: {
      id: 6631,
      name: '挺进破坏者',
      totalCost: 3300,
      baseCost: 750,
      from: [3077, 3044, 1042]
    },
    6655: { id: 6655, name: '卢登的伙伴', totalCost: 2750, baseCost: 450, from: [3802, 3145] },
    6660: { id: 6660, name: '斑比的熔渣', totalCost: 900, baseCost: 100, from: [1028, 1028] },
    6672: { id: 6672, name: '海妖杀手', totalCost: 3000, baseCost: 325, from: [6690, 3051, 1043] },
    6690: { id: 6690, name: '剑翎', totalCost: 775, baseCost: 425, from: [1036] }
  }
}
