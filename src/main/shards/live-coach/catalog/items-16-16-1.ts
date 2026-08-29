/**
 * AUTO-GENERATED FILE FROM RIOT DATA DRAGON 16.16.1
 * Generated At: 2026-08-26T15:16:15.266Z
 * Data Dragon Source SHA-256: 257d2bb4182917d3700a46246444ab058e122c7ba97e10768cc74515790b39d7
 * DO NOT MANUALLY EDIT THIS FILE! Use scripts/generate-item-catalog-16-16-1.mjs instead.
 */

export interface CatalogItemDefinition {
  id: number
  name: string
  totalCost: number
  baseCost: number
  purchasable: boolean
  from: number[]
  into: number[]
  tags: string[]
}

export interface RiotItemCatalog {
  version: '16.16.1'
  sourceSha256: string
  items: Record<number, CatalogItemDefinition>
}

export const RiotItemCatalog16_16_1: RiotItemCatalog = {
  version: '16.16.1',
  sourceSha256: '257d2bb4182917d3700a46246444ab058e122c7ba97e10768cc74515790b39d7',
  items: {
    '1001': {
      id: 1001,
      name: '鞋子',
      totalCost: 300,
      baseCost: 300,
      purchasable: true,
      from: [],
      into: [3005, 3047, 3008, 3006, 3009, 3010, 3020, 3111, 3117, 3158],
      tags: ['Boots']
    },
    '1004': {
      id: 1004,
      name: '仙女护符',
      totalCost: 200,
      baseCost: 200,
      purchasable: true,
      from: [],
      into: [3114, 3012, 4642],
      tags: ['ManaRegen']
    },
    '1006': {
      id: 1006,
      name: '治疗宝珠',
      totalCost: 300,
      baseCost: 300,
      purchasable: true,
      from: [],
      into: [3109, 3211, 323109, 3801],
      tags: ['HealthRegen']
    },
    '1011': {
      id: 1011,
      name: '巨人腰带',
      totalCost: 900,
      baseCost: 500,
      purchasable: true,
      from: [1028],
      into: [4637, 3084, 2525, 3039, 3083, 3116, 3119, 3143, 323119, 3748, 6665, 6609, 6667, 8001],
      tags: ['Health']
    },
    '1018': {
      id: 1018,
      name: '灵巧披风',
      totalCost: 600,
      baseCost: 600,
      purchasable: true,
      from: [],
      into: [123430, 667666, 3031, 3086, 6670, 3033, 3039, 3508, 3095, 3097, 6676],
      tags: ['CriticalStrike']
    },
    '1026': {
      id: 1026,
      name: '爆裂魔杖',
      totalCost: 850,
      baseCost: 850,
      purchasable: true,
      from: [],
      into: [
        2522, 3100, 326621, 4637, 3135, 3165, 3115, 324005, 2510, 3116, 3118, 326657, 6621, 6657
      ],
      tags: ['SpellDamage']
    },
    '1027': {
      id: 1027,
      name: '蓝水晶',
      totalCost: 300,
      baseCost: 300,
      purchasable: true,
      from: [],
      into: [3024, 3802, 3803],
      tags: ['Mana']
    },
    '1028': {
      id: 1028,
      name: '红水晶',
      totalCost: 400,
      baseCost: 400,
      purchasable: true,
      from: [],
      into: [
        3742, 1011, 3068, 2021, 323222, 323075, 326617, 323107, 3012, 3147, 3211, 2502, 322526,
        2526, 3023, 3044, 3053, 3066, 3067, 3075, 3152, 3161, 3801, 3803, 4401, 4635, 6035, 6660,
        6662
      ],
      tags: ['Health']
    },
    '1029': {
      id: 1029,
      name: '布甲',
      totalCost: 300,
      baseCost: 300,
      purchasable: true,
      from: [],
      into: [
        2421, 2420, 1031, 323050, 323190, 2019, 3193, 3047, 3024, 3050, 2524, 3023, 3076, 3082,
        3105, 3190
      ],
      tags: ['Armor']
    },
    '1031': {
      id: 1031,
      name: '锁子甲',
      totalCost: 800,
      baseCost: 500,
      purchasable: true,
      from: [1029],
      into: [3742, 3068, 323002, 3109, 323075, 2502, 3002, 3075, 323109, 6665, 6662],
      tags: ['Armor']
    },
    '1033': {
      id: 1033,
      name: '抗魔斗篷',
      totalCost: 400,
      baseCost: 400,
      purchasable: true,
      from: [],
      into: [
        1057, 3140, 323050, 323190, 3193, 3050, 3001, 3211, 2524, 3155, 3105, 3111, 3190, 4632
      ],
      tags: ['SpellBlock']
    },
    '1036': {
      id: 1036,
      name: '长剑',
      totalCost: 350,
      baseCost: 350,
      purchasable: true,
      from: [],
      into: [
        1053, 4003, 6701, 2015, 2019, 2021, 3077, 6670, 3133, 2517, 323004, 3142, 3004, 2523, 3032,
        3035, 3044, 3051, 3155, 6690, 3123, 3134, 6699, 6671, 6692
      ],
      tags: ['Damage', 'Lane']
    },
    '1037': {
      id: 1037,
      name: '十字镐',
      totalCost: 875,
      baseCost: 875,
      purchasable: true,
      from: [],
      into: [
        667666, 3071, 6333, 3031, 3153, 6701, 2020, 2517, 3087, 6695, 2523, 3053, 3072, 3124, 3181,
        3139, 3161, 6029, 6035, 6673, 6676, 6692
      ],
      tags: ['Damage']
    },
    '1038': {
      id: 1038,
      name: '暴风之剑',
      totalCost: 1300,
      baseCost: 1300,
      purchasable: true,
      from: [],
      into: [3031, 3026, 3032, 3072, 3095, 3097, 4403, 6671],
      tags: ['Damage']
    },
    '1042': {
      id: 1042,
      name: '短剑',
      totalCost: 250,
      baseCost: 250,
      purchasable: true,
      from: [],
      into: [1043, 3086, 2510, 3006, 3046, 3051, 3073, 3131, 3144, 6631, 6675, 6677],
      tags: ['AttackSpeed']
    },
    '1043': {
      id: 1043,
      name: '反曲之弓',
      totalCost: 700,
      baseCost: 450,
      purchasable: true,
      from: [1042],
      into: [3302, 3153, 3115, 6672, 3091, 3124],
      tags: ['AttackSpeed', 'OnHit']
    },
    '1052': {
      id: 1052,
      name: '增幅典籍',
      totalCost: 400,
      baseCost: 400,
      purchasable: true,
      from: [],
      into: [
        3113, 2421, 2420, 3145, 124011, 4637, 3916, 6656, 3147, 3146, 3802, 4005, 2508, 326616,
        3108, 3116, 3124, 4630, 323504, 4628, 4632, 4635, 4642, 4644
      ],
      tags: ['SpellDamage']
    },
    '1053': {
      id: 1053,
      name: '吸血鬼节杖',
      totalCost: 900,
      baseCost: 550,
      purchasable: true,
      from: [1036],
      into: [3153, 3146, 3072, 3074, 3139, 4403],
      tags: ['Damage', 'LifeSteal']
    },
    '1054': {
      id: 1054,
      name: '多兰之盾',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'HealthRegen', 'Lane']
    },
    '1055': {
      id: 1055,
      name: '多兰之刃',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'Damage', 'LifeSteal', 'SpellVamp', 'Lane']
    },
    '1056': {
      id: 1056,
      name: '多兰之戒',
      totalCost: 400,
      baseCost: 400,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'Lane', 'ManaRegen', 'SpellDamage']
    },
    '1057': {
      id: 1057,
      name: '负极斗篷',
      totalCost: 850,
      baseCost: 450,
      purchasable: true,
      from: [1033],
      into: [2504, 8020, 328020, 3091, 6665, 4401],
      tags: ['SpellBlock']
    },
    '1058': {
      id: 1058,
      name: '无用大棒',
      totalCost: 1200,
      baseCost: 1200,
      purchasable: true,
      from: [],
      into: [3157, 4645, 3089, 3102, 3128, 4403],
      tags: ['SpellDamage']
    },
    '1082': {
      id: 1082,
      name: '黑暗封印',
      totalCost: 350,
      baseCost: 350,
      purchasable: true,
      from: [],
      into: [3041],
      tags: ['Health', 'SpellDamage', 'Lane']
    },
    '1083': {
      id: 1083,
      name: '萃取',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Damage', 'OnHit', 'Lane']
    },
    '1086': {
      id: 1086,
      name: '多兰之弓',
      totalCost: 400,
      baseCost: 400,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Damage', 'AttackSpeed', 'SpellVamp', 'Lane']
    },
    '1101': {
      id: 1101,
      name: '焰爪猫幼崽',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Jungle']
    },
    '1102': {
      id: 1102,
      name: '风行狐幼体',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Jungle']
    },
    '1103': {
      id: 1103,
      name: '踏苔蜥幼苗',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Jungle']
    },
    '1105': {
      id: 1105,
      name: '踏苔蜥幼苗',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Jungle']
    },
    '1106': {
      id: 1106,
      name: '风行狐幼体',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Jungle']
    },
    '1107': {
      id: 1107,
      name: '焰爪猫幼崽',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Jungle']
    },
    '1120': {
      id: 1120,
      name: '多兰之盔',
      totalCost: 450,
      baseCost: 450,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'SpellBlock', 'Armor', 'Lane']
    },
    '2003': {
      id: 2003,
      name: '生命药水',
      totalCost: 50,
      baseCost: 50,
      purchasable: true,
      from: [],
      into: [],
      tags: ['HealthRegen', 'Consumable', 'Lane', 'Jungle']
    },
    '2019': {
      id: 2019,
      name: '钢铁印章',
      totalCost: 1100,
      baseCost: 150,
      purchasable: true,
      from: [1029, 1036, 1029],
      into: [6333, 6700, 3026],
      tags: ['Armor', 'Damage']
    },
    '2020': {
      id: 2020,
      name: '残暴之力',
      totalCost: 1337,
      baseCost: 212,
      purchasable: true,
      from: [2022, 1037],
      into: [6698, 2520, 6699, 6696],
      tags: ['Damage', 'CooldownReduction', 'ArmorPenetration']
    },
    '2021': {
      id: 2021,
      name: '掘道钻头',
      totalCost: 1150,
      baseCost: 400,
      purchasable: true,
      from: [1036, 1028],
      into: [2501, 3053, 3073, 3814, 3181, 3161, 3748, 6610],
      tags: ['Health', 'Damage']
    },
    '2022': {
      id: 2022,
      name: '荧尘',
      totalCost: 250,
      baseCost: 250,
      purchasable: true,
      from: [],
      into: [2020, 3024, 3133, 3802, 3057, 3067, 3108, 3158, 4642, 6660],
      tags: ['CooldownReduction']
    },
    '2031': {
      id: 2031,
      name: '复用型药水',
      totalCost: 150,
      baseCost: 150,
      purchasable: true,
      from: [],
      into: [2033],
      tags: ['HealthRegen', 'Consumable', 'Active', 'Lane', 'Jungle']
    },
    '2051': {
      id: 2051,
      name: '守护者号角',
      totalCost: 950,
      baseCost: 950,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'HealthRegen', 'Lane']
    },
    '2055': {
      id: 2055,
      name: '控制守卫',
      totalCost: 75,
      baseCost: 75,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Consumable', 'Lane', 'Stealth', 'Vision']
    },
    '2065': {
      id: 2065,
      name: '舒瑞娅的战歌',
      totalCost: 2200,
      baseCost: 400,
      purchasable: true,
      from: [3113, 4642],
      into: [],
      tags: [
        'SpellDamage',
        'ManaRegen',
        'Active',
        'CooldownReduction',
        'NonbootsMovement',
        'AbilityHaste'
      ]
    },
    '2138': {
      id: 2138,
      name: '钢铁合剂',
      totalCost: 500,
      baseCost: 500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'Consumable', 'NonbootsMovement', 'Tenacity']
    },
    '2139': {
      id: 2139,
      name: '巫术合剂',
      totalCost: 500,
      baseCost: 500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Consumable', 'ManaRegen', 'SpellDamage']
    },
    '2140': {
      id: 2140,
      name: '愤怒合剂',
      totalCost: 500,
      baseCost: 500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Consumable', 'Damage', 'LifeSteal', 'SpellVamp']
    },
    '2141': {
      id: 2141,
      name: '帽子饮品',
      totalCost: 300,
      baseCost: 300,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Damage', 'Consumable']
    },
    '2420': {
      id: 2420,
      name: '探索者的护臂',
      totalCost: 1600,
      baseCost: 500,
      purchasable: true,
      from: [1052, 1029, 1052],
      into: [3157],
      tags: ['Armor', 'SpellDamage', 'Active']
    },
    '2421': {
      id: 2421,
      name: '碎裂的护臂',
      totalCost: 1600,
      baseCost: 500,
      purchasable: true,
      from: [1052, 1029, 1052],
      into: [3157],
      tags: []
    },
    '2501': {
      id: 2501,
      name: '霸王血铠',
      totalCost: 3300,
      baseCost: 1000,
      purchasable: true,
      from: [2021, 2021],
      into: [],
      tags: ['Health', 'Damage']
    },
    '2502': {
      id: 2502,
      name: '无终恨意',
      totalCost: 2800,
      baseCost: 800,
      purchasable: true,
      from: [1031, 3067, 1028],
      into: [],
      tags: ['Health', 'Armor', 'CooldownReduction', 'AbilityHaste']
    },
    '2503': {
      id: 2503,
      name: '黯炎火炬',
      totalCost: 2800,
      baseCost: 700,
      purchasable: true,
      from: [3802, 2508],
      into: [],
      tags: ['SpellDamage', 'Mana', 'CooldownReduction', 'AbilityHaste']
    },
    '2504': {
      id: 2504,
      name: '败魔',
      totalCost: 2900,
      baseCost: 800,
      purchasable: true,
      from: [3211, 1057],
      into: [],
      tags: ['Health', 'SpellBlock', 'HealthRegen']
    },
    '2508': {
      id: 2508,
      name: '命定灰烬',
      totalCost: 900,
      baseCost: 500,
      purchasable: true,
      from: [1052],
      into: [2503, 6653],
      tags: ['SpellDamage']
    },
    '2510': {
      id: 2510,
      name: '黄昏与黎明',
      totalCost: 3100,
      baseCost: 300,
      purchasable: true,
      from: [3057, 1026, 3067, 1042],
      into: [],
      tags: ['Health', 'AttackSpeed', 'SpellDamage', 'OnHit', 'AbilityHaste']
    },
    '2512': {
      id: 2512,
      name: '猎魔人弩箭',
      totalCost: 2650,
      baseCost: 850,
      purchasable: true,
      from: [3086, 3144],
      into: [],
      tags: ['CriticalStrike', 'AttackSpeed', 'NonbootsMovement', 'AbilityHaste']
    },
    '2517': {
      id: 2517,
      name: '无穷饥渴',
      totalCost: 3100,
      baseCost: 825,
      purchasable: true,
      from: [3133, 1037, 1036],
      into: [],
      tags: ['Damage', 'LifeSteal', 'SpellVamp', 'Tenacity', 'AbilityHaste']
    },
    '2520': {
      id: 2520,
      name: '破垒者',
      totalCost: 3000,
      baseCost: 663,
      purchasable: true,
      from: [2020, 3134],
      into: [],
      tags: ['Damage', 'ArmorPenetration', 'AbilityHaste']
    },
    '2522': {
      id: 2522,
      name: '实现器',
      totalCost: 2800,
      baseCost: 750,
      purchasable: true,
      from: [3802, 1026],
      into: [],
      tags: ['SpellDamage', 'Mana', 'AbilityHaste']
    },
    '2523': {
      id: 2523,
      name: '海克斯镜片 C44',
      totalCost: 2800,
      baseCost: 275,
      purchasable: true,
      from: [1037, 6670, 1036],
      into: [],
      tags: ['Damage', 'CriticalStrike']
    },
    '2524': {
      id: 2524,
      name: '班德尔音管',
      totalCost: 2300,
      baseCost: 800,
      purchasable: true,
      from: [3067, 1029, 1033],
      into: [],
      tags: ['Health', 'SpellBlock', 'Armor', 'AttackSpeed', 'NonbootsMovement', 'AbilityHaste']
    },
    '2525': {
      id: 2525,
      name: '原生质护带',
      totalCost: 2600,
      baseCost: 900,
      purchasable: true,
      from: [3067, 1011],
      into: [],
      tags: ['Health', 'NonbootsMovement', 'Tenacity', 'AbilityHaste']
    },
    '2526': {
      id: 2526,
      name: '耳语头环',
      totalCost: 2250,
      baseCost: 850,
      purchasable: true,
      from: [3114, 1028, 3070],
      into: [2530],
      tags: ['Health', 'Mana', 'ManaRegen']
    },
    '3003': {
      id: 3003,
      name: '大天使之杖',
      totalCost: 2900,
      baseCost: 450,
      purchasable: true,
      from: [3070, 3802, 3108],
      into: [],
      tags: ['SpellDamage', 'Mana', 'AbilityHaste']
    },
    '3004': {
      id: 3004,
      name: '魔宗',
      totalCost: 2900,
      baseCost: 1100,
      purchasable: true,
      from: [3070, 3133, 1036],
      into: [],
      tags: ['Damage', 'Mana', 'CooldownReduction', 'OnHit', 'AbilityHaste']
    },
    '3006': {
      id: 3006,
      name: '狂战士胫甲',
      totalCost: 1100,
      baseCost: 300,
      purchasable: true,
      from: [1001, 1042, 1042],
      into: [3172],
      tags: ['AttackSpeed', 'Boots']
    },
    '3008': {
      id: 3008,
      name: '暴食胫甲',
      totalCost: 1000,
      baseCost: 700,
      purchasable: true,
      from: [1001],
      into: [3168],
      tags: ['LifeSteal', 'SpellVamp', 'Boots']
    },
    '3009': {
      id: 3009,
      name: '轻灵之靴',
      totalCost: 1000,
      baseCost: 700,
      purchasable: true,
      from: [1001],
      into: [3170],
      tags: ['Boots']
    },
    '3020': {
      id: 3020,
      name: '法师之靴',
      totalCost: 1100,
      baseCost: 800,
      purchasable: true,
      from: [1001],
      into: [3175],
      tags: ['Boots', 'MagicPenetration']
    },
    '3024': {
      id: 3024,
      name: '冰川圆盾',
      totalCost: 900,
      baseCost: 50,
      purchasable: true,
      from: [1029, 1027, 2022],
      into: [323110, 3110],
      tags: ['Armor', 'Mana', 'CooldownReduction', 'AbilityHaste']
    },
    '3026': {
      id: 3026,
      name: '守护天使',
      totalCost: 3200,
      baseCost: 800,
      purchasable: true,
      from: [2019, 1038],
      into: [],
      tags: ['Armor', 'Damage']
    },
    '3031': {
      id: 3031,
      name: '无尽之刃',
      totalCost: 3500,
      baseCost: 725,
      purchasable: true,
      from: [1038, 1037, 1018],
      into: [],
      tags: ['CriticalStrike', 'Damage']
    },
    '3032': {
      id: 3032,
      name: '育恩塔尔荒野箭',
      totalCost: 3000,
      baseCost: 750,
      purchasable: true,
      from: [1038, 3144, 1036],
      into: [],
      tags: ['Damage', 'CriticalStrike', 'AttackSpeed']
    },
    '3033': {
      id: 3033,
      name: '凡性的提醒',
      totalCost: 3000,
      baseCost: 150,
      purchasable: true,
      from: [3123, 3035, 1018],
      into: [],
      tags: ['Damage', 'CriticalStrike', 'ArmorPenetration']
    },
    '3035': {
      id: 3035,
      name: '最后的轻语',
      totalCost: 1450,
      baseCost: 750,
      purchasable: true,
      from: [1036, 1036],
      into: [3033, 3036, 6694],
      tags: ['ArmorPenetration', 'Damage']
    },
    '3036': {
      id: 3036,
      name: '多米尼克领主的致意',
      totalCost: 3300,
      baseCost: 550,
      purchasable: true,
      from: [3035, 6670],
      into: [],
      tags: ['Damage', 'CriticalStrike', 'ArmorPenetration']
    },
    '3041': {
      id: 3041,
      name: '梅贾的窃魂卷',
      totalCost: 1500,
      baseCost: 1150,
      purchasable: true,
      from: [1082],
      into: [],
      tags: ['Health', 'SpellDamage', 'NonbootsMovement']
    },
    '3044': {
      id: 3044,
      name: '净蚀',
      totalCost: 1100,
      baseCost: 350,
      purchasable: true,
      from: [1028, 1036],
      into: [3071, 3078, 3073, 6630, 6631],
      tags: ['Health', 'Damage', 'NonbootsMovement']
    },
    '3046': {
      id: 3046,
      name: '幻影之舞',
      totalCost: 2650,
      baseCost: 950,
      purchasable: true,
      from: [1042, 3086, 1042],
      into: [],
      tags: ['CriticalStrike', 'AttackSpeed', 'NonbootsMovement']
    },
    '3047': {
      id: 3047,
      name: '铁板靴',
      totalCost: 1200,
      baseCost: 600,
      purchasable: true,
      from: [1001, 1029],
      into: [3174],
      tags: ['Armor', 'Boots']
    },
    '3050': {
      id: 3050,
      name: '基克的聚合',
      totalCost: 2200,
      baseCost: 700,
      purchasable: true,
      from: [3067, 1029, 1033],
      into: [],
      tags: ['Health', 'SpellBlock', 'Armor', 'AbilityHaste']
    },
    '3051': {
      id: 3051,
      name: '缚炉之斧',
      totalCost: 1200,
      baseCost: 250,
      purchasable: true,
      from: [1036, 1042, 1036],
      into: [3078, 3302, 6672],
      tags: ['Damage', 'AttackSpeed']
    },
    '3053': {
      id: 3053,
      name: '斯特拉克的挑战护手',
      totalCost: 3200,
      baseCost: 775,
      purchasable: true,
      from: [1037, 2021, 1028],
      into: [],
      tags: ['Health', 'Damage', 'Tenacity']
    },
    '3057': {
      id: 3057,
      name: '耀光',
      totalCost: 900,
      baseCost: 650,
      purchasable: true,
      from: [2022],
      into: [3078, 3100, 2510, 3508, 6632, 6662],
      tags: ['OnHit', 'AbilityHaste']
    },
    '3065': {
      id: 3065,
      name: '振奋盔甲',
      totalCost: 2700,
      baseCost: 650,
      purchasable: true,
      from: [3211, 3067],
      into: [],
      tags: ['Health', 'SpellBlock', 'HealthRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '3066': {
      id: 3066,
      name: '带翼的月板甲',
      totalCost: 800,
      baseCost: 400,
      purchasable: true,
      from: [1028],
      into: [3742, 323002, 3002, 3181, 4401],
      tags: ['Health', 'NonbootsMovement']
    },
    '3067': {
      id: 3067,
      name: '燃烧宝石',
      totalCost: 800,
      baseCost: 150,
      purchasable: true,
      from: [1028, 2022],
      into: [
        3071, 8020, 323050, 328020, 124011, 323190, 323222, 3165, 6620, 3050, 3109, 6656, 326617,
        323107, 2502, 2510, 2524, 2525, 6617, 3065, 3152, 3119, 326620, 3190, 3222, 323109, 323119,
        4403, 4629, 4644, 6630, 6632, 8001
      ],
      tags: ['Health', 'CooldownReduction', 'AbilityHaste']
    },
    '3068': {
      id: 3068,
      name: '日炎圣盾',
      totalCost: 2800,
      baseCost: 700,
      purchasable: true,
      from: [6660, 1031, 1028],
      into: [],
      tags: ['Health', 'Armor', 'Aura', 'AbilityHaste']
    },
    '3070': {
      id: 3070,
      name: '女神之泪',
      totalCost: 400,
      baseCost: 400,
      purchasable: true,
      from: [],
      into: [3003, 3004, 2526, 3119],
      tags: ['Mana', 'ManaRegen']
    },
    '3071': {
      id: 3071,
      name: '黑色切割者',
      totalCost: 3000,
      baseCost: 225,
      purchasable: true,
      from: [3044, 3067, 1037],
      into: [],
      tags: [
        'Health',
        'Damage',
        'CooldownReduction',
        'OnHit',
        'NonbootsMovement',
        'ArmorPenetration',
        'AbilityHaste'
      ]
    },
    '3072': {
      id: 3072,
      name: '饮血剑',
      totalCost: 3400,
      baseCost: 325,
      purchasable: true,
      from: [1038, 1037, 1053],
      into: [],
      tags: ['Damage', 'LifeSteal']
    },
    '3073': {
      id: 3073,
      name: '海克斯注力刚壁',
      totalCost: 3000,
      baseCost: 500,
      purchasable: true,
      from: [2021, 1042, 3044],
      into: [],
      tags: [
        'Health',
        'Damage',
        'AttackSpeed',
        'CooldownReduction',
        'NonbootsMovement',
        'AbilityHaste'
      ]
    },
    '3074': {
      id: 3074,
      name: '贪欲九头蛇',
      totalCost: 3300,
      baseCost: 150,
      purchasable: true,
      from: [3077, 1053, 3133],
      into: [],
      tags: ['Damage', 'LifeSteal', 'CooldownReduction', 'OnHit', 'AbilityHaste']
    },
    '3075': {
      id: 3075,
      name: '荆棘之甲',
      totalCost: 2450,
      baseCost: 450,
      purchasable: true,
      from: [3076, 1031, 1028],
      into: [],
      tags: ['Health', 'Armor']
    },
    '3076': {
      id: 3076,
      name: '棘刺背心',
      totalCost: 800,
      baseCost: 200,
      purchasable: true,
      from: [1029, 1029],
      into: [323075, 3075],
      tags: ['Armor']
    },
    '3077': {
      id: 3077,
      name: '提亚马特',
      totalCost: 1200,
      baseCost: 500,
      purchasable: true,
      from: [1036, 1036],
      into: [3074, 3748, 6698, 6631],
      tags: ['Damage', 'OnHit']
    },
    '3078': {
      id: 3078,
      name: '三相之力',
      totalCost: 3333,
      baseCost: 133,
      purchasable: true,
      from: [3057, 3044, 3051],
      into: [],
      tags: [
        'Health',
        'Damage',
        'AttackSpeed',
        'CooldownReduction',
        'OnHit',
        'NonbootsMovement',
        'AbilityHaste'
      ]
    },
    '3082': {
      id: 3082,
      name: '守望者铠甲',
      totalCost: 1000,
      baseCost: 400,
      purchasable: true,
      from: [1029, 1029],
      into: [323110, 3110, 3143],
      tags: ['Armor']
    },
    '3083': {
      id: 3083,
      name: '狂徒铠甲',
      totalCost: 3100,
      baseCost: 500,
      purchasable: true,
      from: [1011, 1011, 3801],
      into: [],
      tags: ['Health', 'HealthRegen']
    },
    '3084': {
      id: 3084,
      name: '心之钢',
      totalCost: 3000,
      baseCost: 400,
      purchasable: true,
      from: [1011, 3801, 1011],
      into: [],
      tags: ['Health', 'HealthRegen']
    },
    '3085': {
      id: 3085,
      name: '卢安娜的飓风',
      totalCost: 2650,
      baseCost: 850,
      purchasable: true,
      from: [3086, 3144],
      into: [],
      tags: ['CriticalStrike', 'AttackSpeed', 'OnHit', 'NonbootsMovement']
    },
    '3086': {
      id: 3086,
      name: '狂热',
      totalCost: 1200,
      baseCost: 350,
      purchasable: true,
      from: [1018, 1042],
      into: [2512, 3094, 3046, 3085, 4403, 6671, 6675],
      tags: ['CriticalStrike', 'AttackSpeed', 'NonbootsMovement']
    },
    '3087': {
      id: 3087,
      name: '斯塔缇克电刃',
      totalCost: 3000,
      baseCost: 625,
      purchasable: true,
      from: [3144, 3113, 1037],
      into: [],
      tags: ['Damage', 'AttackSpeed', 'SpellDamage', 'OnHit', 'NonbootsMovement']
    },
    '3089': {
      id: 3089,
      name: '灭世者的死亡之帽',
      totalCost: 3500,
      baseCost: 1100,
      purchasable: true,
      from: [1058, 1058],
      into: [],
      tags: ['SpellDamage']
    },
    '3091': {
      id: 3091,
      name: '智慧末刃',
      totalCost: 2800,
      baseCost: 550,
      purchasable: true,
      from: [1043, 1057, 1043],
      into: [],
      tags: ['SpellBlock', 'AttackSpeed', 'OnHit', 'Tenacity']
    },
    '3094': {
      id: 3094,
      name: '疾射火炮',
      totalCost: 2650,
      baseCost: 850,
      purchasable: true,
      from: [3086, 3144],
      into: [],
      tags: ['CriticalStrike', 'AttackSpeed', 'NonbootsMovement']
    },
    '3097': {
      id: 3097,
      name: '岚切',
      totalCost: 3200,
      baseCost: 700,
      purchasable: true,
      from: [1038, 1018, 3144],
      into: [],
      tags: ['Damage', 'CriticalStrike', 'AttackSpeed', 'NonbootsMovement']
    },
    '3100': {
      id: 3100,
      name: '巫妖之祸',
      totalCost: 2900,
      baseCost: 250,
      purchasable: true,
      from: [3057, 3113, 1026],
      into: [],
      tags: ['SpellDamage', 'OnHit', 'NonbootsMovement', 'AbilityHaste']
    },
    '3102': {
      id: 3102,
      name: '女妖面纱',
      totalCost: 3000,
      baseCost: 200,
      purchasable: true,
      from: [1058, 4632],
      into: [],
      tags: ['SpellBlock', 'SpellDamage']
    },
    '3107': {
      id: 3107,
      name: '救赎',
      totalCost: 2300,
      baseCost: 850,
      purchasable: true,
      from: [3108, 3114],
      into: [],
      tags: ['SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '3108': {
      id: 3108,
      name: '恶魔法典',
      totalCost: 850,
      baseCost: 200,
      purchasable: true,
      from: [1052, 2022],
      into: [
        123430, 4636, 323003, 3115, 3003, 326616, 3107, 3128, 3137, 8010, 6616, 4628, 4629, 4633
      ],
      tags: ['SpellDamage', 'CooldownReduction', 'AbilityHaste']
    },
    '3109': {
      id: 3109,
      name: '骑士之誓',
      totalCost: 2300,
      baseCost: 400,
      purchasable: true,
      from: [3067, 1031, 1006],
      into: [],
      tags: [
        'Health',
        'HealthRegen',
        'Armor',
        'Aura',
        'Active',
        'CooldownReduction',
        'AbilityHaste'
      ]
    },
    '3110': {
      id: 3110,
      name: '冰霜之心',
      totalCost: 2500,
      baseCost: 600,
      purchasable: true,
      from: [3082, 3024],
      into: [],
      tags: ['Armor', 'Mana', 'Aura', 'CooldownReduction', 'AbilityHaste']
    },
    '3111': {
      id: 3111,
      name: '水银之靴',
      totalCost: 1250,
      baseCost: 550,
      purchasable: true,
      from: [1001, 1033],
      into: [3173],
      tags: ['Boots', 'SpellBlock', 'Tenacity']
    },
    '3112': {
      id: 3112,
      name: '守护者法球',
      totalCost: 950,
      baseCost: 950,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'SpellDamage', 'ManaRegen', 'Lane']
    },
    '3113': {
      id: 3113,
      name: '以太精魂',
      totalCost: 900,
      baseCost: 500,
      purchasable: true,
      from: [1052],
      into: [123430, 3100, 2065, 322065, 3087, 323504, 3504, 4629, 4646],
      tags: ['NonbootsMovement', 'SpellDamage']
    },
    '3114': {
      id: 3114,
      name: '禁忌雕像',
      totalCost: 600,
      baseCost: 400,
      purchasable: true,
      from: [1004],
      into: [
        124011, 326621, 223011, 323222, 323107, 322526, 2526, 3011, 326616, 3107, 3222, 323504,
        3504, 6616, 6621
      ],
      tags: ['ManaRegen']
    },
    '3115': {
      id: 3115,
      name: '纳什之牙',
      totalCost: 2900,
      baseCost: 500,
      purchasable: true,
      from: [1043, 1026, 3108],
      into: [],
      tags: ['AttackSpeed', 'SpellDamage', 'OnHit', 'AbilityHaste']
    },
    '3116': {
      id: 3116,
      name: '瑞莱的冰晶节杖',
      totalCost: 2600,
      baseCost: 450,
      purchasable: true,
      from: [1026, 1011, 1052],
      into: [],
      tags: ['Health', 'SpellDamage', 'Slow']
    },
    '3118': {
      id: 3118,
      name: '残疫',
      totalCost: 2700,
      baseCost: 650,
      purchasable: true,
      from: [3802, 1026],
      into: [],
      tags: ['SpellDamage', 'Mana', 'AbilityHaste']
    },
    '3119': {
      id: 3119,
      name: '凛冬之临',
      totalCost: 2400,
      baseCost: 300,
      purchasable: true,
      from: [3070, 1011, 3067],
      into: [],
      tags: ['Health', 'Mana', 'AbilityHaste']
    },
    '3123': {
      id: 3123,
      name: '死刑宣告',
      totalCost: 800,
      baseCost: 450,
      purchasable: true,
      from: [1036],
      into: [3033, 6609],
      tags: ['Damage']
    },
    '3124': {
      id: 3124,
      name: '鬼索的狂暴之刃',
      totalCost: 3000,
      baseCost: 1025,
      purchasable: true,
      from: [1052, 1043, 1037],
      into: [],
      tags: ['Damage', 'AttackSpeed', 'SpellDamage', 'OnHit']
    },
    '3133': {
      id: 3133,
      name: '考尔菲德的战锤',
      totalCost: 1050,
      baseCost: 100,
      purchasable: true,
      from: [1036, 2022, 1036],
      into: [
        6333, 126697, 6697, 4402, 3156, 2517, 323004, 6693, 3004, 3508, 3074, 3179, 6691, 6609,
        6610, 6632, 6692, 6694, 6696
      ],
      tags: ['Damage', 'CooldownReduction', 'AbilityHaste']
    },
    '3134': {
      id: 3134,
      name: '锯齿短匕',
      totalCost: 1000,
      baseCost: 300,
      purchasable: true,
      from: [1036, 1036],
      into: [
        3142, 667666, 126697, 6697, 6701, 6693, 2520, 4004, 6695, 3814, 3131, 3179, 6691, 6676
      ],
      tags: ['Damage', 'ArmorPenetration']
    },
    '3135': {
      id: 3135,
      name: '虚空之杖',
      totalCost: 3000,
      baseCost: 1050,
      purchasable: true,
      from: [4630, 1026],
      into: [],
      tags: ['MagicPenetration', 'SpellDamage']
    },
    '3137': {
      id: 3137,
      name: '蜕生',
      totalCost: 3000,
      baseCost: 200,
      purchasable: true,
      from: [4630, 3108, 3108],
      into: [],
      tags: ['SpellDamage', 'MagicPenetration', 'AbilityHaste']
    },
    '3139': {
      id: 3139,
      name: '水银弯刀',
      totalCost: 3200,
      baseCost: 125,
      purchasable: true,
      from: [3140, 1037, 1053],
      into: [],
      tags: ['SpellBlock', 'Damage', 'LifeSteal', 'Active', 'NonbootsMovement', 'Tenacity']
    },
    '3140': {
      id: 3140,
      name: '水银饰带',
      totalCost: 1300,
      baseCost: 900,
      purchasable: true,
      from: [1033],
      into: [3139, 6035],
      tags: ['Active', 'SpellBlock']
    },
    '3142': {
      id: 3142,
      name: '幽梦之灵',
      totalCost: 2800,
      baseCost: 675,
      purchasable: true,
      from: [3134, 6690, 1036],
      into: [],
      tags: ['Damage', 'Active', 'NonbootsMovement', 'ArmorPenetration']
    },
    '3143': {
      id: 3143,
      name: '兰顿之兆',
      totalCost: 2700,
      baseCost: 800,
      purchasable: true,
      from: [3082, 1011],
      into: [],
      tags: ['Health', 'Armor', 'Active', 'Slow']
    },
    '3144': {
      id: 3144,
      name: '斥候弹弓',
      totalCost: 600,
      baseCost: 100,
      purchasable: true,
      from: [1042, 1042],
      into: [2512, 3094, 3087, 3032, 3085, 3095, 3097],
      tags: ['AttackSpeed']
    },
    '3145': {
      id: 3145,
      name: '海克斯科技发电机',
      totalCost: 1100,
      baseCost: 300,
      purchasable: true,
      from: [1052, 1052],
      into: [4645, 4636, 3146, 6655, 3152, 4646],
      tags: ['SpellDamage']
    },
    '3146': {
      id: 3146,
      name: '海克斯科技枪刃',
      totalCost: 3000,
      baseCost: 600,
      purchasable: true,
      from: [1053, 3145, 1052],
      into: [],
      tags: ['Damage', 'LifeSteal', 'SpellDamage', 'Active', 'SpellVamp']
    },
    '3147': {
      id: 3147,
      name: '幽魂面具',
      totalCost: 1300,
      baseCost: 500,
      purchasable: true,
      from: [1052, 1028],
      into: [8010, 4633, 6653],
      tags: ['Health', 'SpellDamage']
    },
    '3152': {
      id: 3152,
      name: '海克斯科技火箭腰带',
      totalCost: 2650,
      baseCost: 350,
      purchasable: true,
      from: [3145, 3067, 1028],
      into: [],
      tags: [
        'Health',
        'SpellDamage',
        'Active',
        'CooldownReduction',
        'NonbootsMovement',
        'AbilityHaste'
      ]
    },
    '3153': {
      id: 3153,
      name: '破败王者之刃',
      totalCost: 3200,
      baseCost: 725,
      purchasable: true,
      from: [1053, 1043, 1037],
      into: [],
      tags: ['Damage', 'AttackSpeed', 'LifeSteal', 'Slow', 'OnHit']
    },
    '3155': {
      id: 3155,
      name: '海克斯饮魔刀',
      totalCost: 1300,
      baseCost: 200,
      purchasable: true,
      from: [1036, 1033, 1036],
      into: [3156],
      tags: ['Damage', 'SpellBlock']
    },
    '3156': {
      id: 3156,
      name: '玛莫提乌斯之噬',
      totalCost: 3100,
      baseCost: 750,
      purchasable: true,
      from: [3155, 3133],
      into: [],
      tags: ['SpellBlock', 'Damage', 'LifeSteal', 'SpellVamp', 'AbilityHaste']
    },
    '3157': {
      id: 3157,
      name: '中娅沙漏',
      totalCost: 3250,
      baseCost: 450,
      purchasable: true,
      from: [1058, 2420],
      into: [],
      tags: ['Armor', 'SpellDamage', 'Active']
    },
    '3158': {
      id: 3158,
      name: '明朗之靴',
      totalCost: 900,
      baseCost: 350,
      purchasable: true,
      from: [1001, 2022],
      into: [3171],
      tags: ['Boots', 'CooldownReduction']
    },
    '3161': {
      id: 3161,
      name: '朔极之矛',
      totalCost: 3100,
      baseCost: 675,
      purchasable: true,
      from: [1037, 2021, 1028],
      into: [],
      tags: ['Health', 'Damage', 'AbilityHaste']
    },
    '3165': {
      id: 3165,
      name: '莫雷洛秘典',
      totalCost: 2850,
      baseCost: 400,
      purchasable: true,
      from: [3916, 1026, 3067],
      into: [],
      tags: ['Health', 'SpellDamage', 'CooldownReduction', 'AbilityHaste']
    },
    '3168': {
      id: 3168,
      name: '不朽之路',
      totalCost: 1000,
      baseCost: 0,
      purchasable: true,
      from: [3008],
      into: [],
      tags: ['LifeSteal', 'SpellVamp', 'Boots']
    },
    '3170': {
      id: 3170,
      name: '迅速进军',
      totalCost: 1000,
      baseCost: 0,
      purchasable: true,
      from: [3009],
      into: [],
      tags: ['Boots']
    },
    '3171': {
      id: 3171,
      name: '猩红明朗',
      totalCost: 900,
      baseCost: 0,
      purchasable: true,
      from: [3158],
      into: [],
      tags: ['CooldownReduction', 'Boots']
    },
    '3172': {
      id: 3172,
      name: '炮铜胫甲',
      totalCost: 1100,
      baseCost: 0,
      purchasable: true,
      from: [3006],
      into: [],
      tags: ['AttackSpeed', 'LifeSteal', 'NonbootsMovement']
    },
    '3173': {
      id: 3173,
      name: '带链碾碎者',
      totalCost: 1250,
      baseCost: 0,
      purchasable: true,
      from: [3111],
      into: [],
      tags: ['SpellBlock', 'Boots', 'Tenacity', 'MagicResist']
    },
    '3174': {
      id: 3174,
      name: '装甲战靴',
      totalCost: 1200,
      baseCost: 0,
      purchasable: true,
      from: [3047],
      into: [],
      tags: ['Armor', 'Boots']
    },
    '3175': {
      id: 3175,
      name: '灵能使之靴',
      totalCost: 1100,
      baseCost: 0,
      purchasable: true,
      from: [3020],
      into: [],
      tags: ['Boots', 'MagicPenetration']
    },
    '3177': {
      id: 3177,
      name: '守护者之刃',
      totalCost: 950,
      baseCost: 950,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'Damage', 'Lane', 'AbilityHaste']
    },
    '3179': {
      id: 3179,
      name: '黯影阔剑',
      totalCost: 2800,
      baseCost: 750,
      purchasable: true,
      from: [3134, 3133],
      into: [],
      tags: ['Damage', 'Vision', 'CooldownReduction', 'ArmorPenetration', 'AbilityHaste']
    },
    '3181': {
      id: 3181,
      name: '破舰者',
      totalCost: 3000,
      baseCost: 175,
      purchasable: true,
      from: [2021, 3066, 1037],
      into: [],
      tags: ['Health', 'Damage', 'NonbootsMovement']
    },
    '3184': {
      id: 3184,
      name: '守护者战锤',
      totalCost: 950,
      baseCost: 950,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'Damage', 'LifeSteal', 'Lane']
    },
    '3190': {
      id: 3190,
      name: '钢铁烈阳之匣',
      totalCost: 2200,
      baseCost: 700,
      purchasable: true,
      from: [3067, 1029, 1033],
      into: [],
      tags: ['Health', 'SpellBlock', 'Armor', 'Aura', 'Active', 'MagicResist', 'AbilityHaste']
    },
    '3211': {
      id: 3211,
      name: '幽魂斗篷',
      totalCost: 1250,
      baseCost: 150,
      purchasable: true,
      from: [1028, 1033, 1006],
      into: [2504, 3065, 6664],
      tags: ['Health', 'HealthRegen', 'SpellBlock']
    },
    '3222': {
      id: 3222,
      name: '米凯尔的祝福',
      totalCost: 2300,
      baseCost: 900,
      purchasable: true,
      from: [3067, 3114],
      into: [],
      tags: ['Health', 'ManaRegen', 'Active', 'CooldownReduction', 'Tenacity', 'AbilityHaste']
    },
    '3302': {
      id: 3302,
      name: '界弓',
      totalCost: 3000,
      baseCost: 1100,
      purchasable: true,
      from: [3051, 1043],
      into: [],
      tags: ['Damage', 'AttackSpeed', 'OnHit', 'MagicPenetration', 'ArmorPenetration']
    },
    '3330': {
      id: 3330,
      name: '草间人',
      totalCost: 0,
      baseCost: 0,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Active', 'Jungle', 'Lane', 'Trinket', 'Vision']
    },
    '3340': {
      id: 3340,
      name: '侦察守卫',
      totalCost: 0,
      baseCost: 0,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Active', 'Jungle', 'Lane', 'Trinket', 'Vision']
    },
    '3363': {
      id: 3363,
      name: '远见改造',
      totalCost: 0,
      baseCost: 0,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Active', 'Trinket', 'Vision']
    },
    '3364': {
      id: 3364,
      name: '神谕透镜',
      totalCost: 0,
      baseCost: 0,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Active', 'Trinket', 'Vision']
    },
    '3504': {
      id: 3504,
      name: '炽热香炉',
      totalCost: 2200,
      baseCost: 700,
      purchasable: true,
      from: [3113, 3114],
      into: [],
      tags: ['AttackSpeed', 'SpellDamage', 'ManaRegen', 'NonbootsMovement']
    },
    '3508': {
      id: 3508,
      name: '夺萃之镰',
      totalCost: 3050,
      baseCost: 500,
      purchasable: true,
      from: [3057, 3133, 1018],
      into: [],
      tags: ['Damage', 'CriticalStrike', 'ManaRegen', 'CooldownReduction', 'OnHit', 'AbilityHaste']
    },
    '3599': {
      id: 3599,
      name: '卡莉丝塔的黑色长矛',
      totalCost: 0,
      baseCost: 0,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Consumable']
    },
    '3600': {
      id: 3600,
      name: '卡莉丝塔的黑色长矛',
      totalCost: 0,
      baseCost: 0,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Consumable']
    },
    '3742': {
      id: 3742,
      name: '亡者的板甲',
      totalCost: 2900,
      baseCost: 900,
      purchasable: true,
      from: [3066, 1028, 1031],
      into: [],
      tags: ['Health', 'Armor', 'Slow', 'NonbootsMovement']
    },
    '3748': {
      id: 3748,
      name: '巨型九头蛇',
      totalCost: 3300,
      baseCost: 50,
      purchasable: true,
      from: [3077, 2021, 1011],
      into: [],
      tags: ['Health', 'HealthRegen', 'Damage', 'OnHit']
    },
    '3801': {
      id: 3801,
      name: '晶体护腕',
      totalCost: 800,
      baseCost: 100,
      purchasable: true,
      from: [1028, 1006],
      into: [3084, 3083],
      tags: ['Health', 'HealthRegen']
    },
    '3802': {
      id: 3802,
      name: '遗失的章节',
      totalCost: 1200,
      baseCost: 250,
      purchasable: true,
      from: [1052, 1027, 2022],
      into: [2522, 323003, 6656, 3003, 6655, 2503, 3118, 4644],
      tags: ['SpellDamage', 'Mana', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '3803': {
      id: 3803,
      name: '万世催化石',
      totalCost: 1300,
      baseCost: 200,
      purchasable: true,
      from: [1028, 1028, 1027],
      into: [4402, 326657, 6657],
      tags: ['Health', 'HealthRegen', 'Mana', 'ManaRegen']
    },
    '3814': {
      id: 3814,
      name: '夜之锋刃',
      totalCost: 3000,
      baseCost: 850,
      purchasable: true,
      from: [3134, 2021],
      into: [],
      tags: ['Health', 'Damage', 'ArmorPenetration']
    },
    '3865': {
      id: 3865,
      name: '云游图鉴',
      totalCost: 400,
      baseCost: 400,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'ManaRegen', 'Vision', 'GoldPer', 'Lane']
    },
    '3867': {
      id: 3867,
      name: '异世珍藏',
      totalCost: 400,
      baseCost: 400,
      purchasable: false,
      from: [],
      into: [3869, 3870, 3871, 3876, 3877],
      tags: ['SpellDamage', 'ManaRegen', 'Vision', 'GoldPer', 'Lane']
    },
    '3869': {
      id: 3869,
      name: '星界据守',
      totalCost: 400,
      baseCost: 0,
      purchasable: true,
      from: [3867],
      into: [],
      tags: ['Health', 'HealthRegen', 'ManaRegen', 'Vision', 'GoldPer', 'Lane']
    },
    '3870': {
      id: 3870,
      name: '圆梦使者',
      totalCost: 400,
      baseCost: 0,
      purchasable: true,
      from: [3867],
      into: [],
      tags: ['Health', 'HealthRegen', 'ManaRegen', 'Vision', 'GoldPer', 'Lane']
    },
    '3871': {
      id: 3871,
      name: '扎兹沙克的溃口',
      totalCost: 400,
      baseCost: 0,
      purchasable: true,
      from: [3867],
      into: [],
      tags: ['Health', 'HealthRegen', 'ManaRegen', 'Vision', 'GoldPer', 'Lane']
    },
    '3876': {
      id: 3876,
      name: '摩天雪橇',
      totalCost: 400,
      baseCost: 0,
      purchasable: true,
      from: [3867],
      into: [],
      tags: ['Health', 'HealthRegen', 'ManaRegen', 'Vision', 'GoldPer', 'Lane']
    },
    '3877': {
      id: 3877,
      name: '血鸣',
      totalCost: 400,
      baseCost: 0,
      purchasable: true,
      from: [3867],
      into: [],
      tags: ['Health', 'HealthRegen', 'ManaRegen', 'Vision', 'GoldPer', 'Lane']
    },
    '3916': {
      id: 3916,
      name: '湮灭宝珠',
      totalCost: 800,
      baseCost: 400,
      purchasable: true,
      from: [1052],
      into: [223011, 3165, 3011],
      tags: ['SpellDamage']
    },
    '4005': {
      id: 4005,
      name: '帝国指令',
      totalCost: 2400,
      baseCost: 700,
      purchasable: true,
      from: [1052, 4642, 1052],
      into: [],
      tags: ['SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '4401': {
      id: 4401,
      name: '自然之力',
      totalCost: 2800,
      baseCost: 750,
      purchasable: true,
      from: [1057, 1028, 3066],
      into: [],
      tags: ['Health', 'SpellBlock', 'NonbootsMovement']
    },
    '4628': {
      id: 4628,
      name: '视界专注',
      totalCost: 2700,
      baseCost: 600,
      purchasable: true,
      from: [3108, 3108, 1052],
      into: [],
      tags: ['SpellDamage', 'AbilityHaste']
    },
    '4629': {
      id: 4629,
      name: '星界驱驰',
      totalCost: 3000,
      baseCost: 450,
      purchasable: true,
      from: [3067, 3113, 3108],
      into: [],
      tags: ['Health', 'SpellDamage', 'NonbootsMovement', 'AbilityHaste']
    },
    '4630': {
      id: 4630,
      name: '枯萎珠宝',
      totalCost: 1100,
      baseCost: 700,
      purchasable: true,
      from: [1052],
      into: [3135, 3137],
      tags: ['MagicPenetration', 'SpellDamage']
    },
    '4632': {
      id: 4632,
      name: '翠绿屏障',
      totalCost: 1600,
      baseCost: 400,
      purchasable: true,
      from: [1052, 1033, 1052],
      into: [3102],
      tags: ['SpellBlock', 'SpellDamage']
    },
    '4633': {
      id: 4633,
      name: '裂隙制造者',
      totalCost: 3100,
      baseCost: 950,
      purchasable: true,
      from: [3147, 3108],
      into: [],
      tags: ['Health', 'SpellDamage', 'CooldownReduction', 'SpellVamp']
    },
    '4642': {
      id: 4642,
      name: '班德尔玻璃镜',
      totalCost: 900,
      baseCost: 50,
      purchasable: true,
      from: [1004, 1052, 2022],
      into: [2065, 322065, 6620, 326617, 324005, 4005, 6617, 326620],
      tags: ['SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '4645': {
      id: 4645,
      name: '影焰',
      totalCost: 3200,
      baseCost: 900,
      purchasable: true,
      from: [3145, 1058],
      into: [],
      tags: ['SpellDamage', 'MagicPenetration']
    },
    '4646': {
      id: 4646,
      name: '风暴狂涌',
      totalCost: 2800,
      baseCost: 800,
      purchasable: true,
      from: [3145, 3113],
      into: [],
      tags: ['SpellDamage', 'GoldPer', 'NonbootsMovement', 'MagicPenetration']
    },
    '6333': {
      id: 6333,
      name: '死亡之舞',
      totalCost: 3300,
      baseCost: 275,
      purchasable: true,
      from: [2019, 1037, 3133],
      into: [],
      tags: ['Armor', 'Damage', 'AbilityHaste']
    },
    '6609': {
      id: 6609,
      name: '炼金朋克链锯剑',
      totalCost: 3000,
      baseCost: 250,
      purchasable: true,
      from: [3123, 1011, 3133],
      into: [],
      tags: ['Health', 'Damage', 'CooldownReduction', 'AbilityHaste']
    },
    '6610': {
      id: 6610,
      name: '焚天',
      totalCost: 3100,
      baseCost: 900,
      purchasable: true,
      from: [2021, 3133],
      into: [],
      tags: ['Health', 'Damage', 'CooldownReduction', 'AbilityHaste']
    },
    '6616': {
      id: 6616,
      name: '流水法杖',
      totalCost: 2250,
      baseCost: 800,
      purchasable: true,
      from: [3108, 3114],
      into: [],
      tags: ['SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '6617': {
      id: 6617,
      name: '月石再生器',
      totalCost: 2200,
      baseCost: 500,
      purchasable: true,
      from: [3067, 4642],
      into: [],
      tags: ['Health', 'SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '6620': {
      id: 6620,
      name: '海力亚的回响',
      totalCost: 2200,
      baseCost: 500,
      purchasable: true,
      from: [3067, 4642],
      into: [],
      tags: ['Health', 'SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '6621': {
      id: 6621,
      name: '黎明核心',
      totalCost: 2500,
      baseCost: 450,
      purchasable: true,
      from: [1026, 3114, 3114],
      into: [],
      tags: ['SpellDamage', 'ManaRegen']
    },
    '6631': {
      id: 6631,
      name: '挺进破坏者',
      totalCost: 3300,
      baseCost: 750,
      purchasable: true,
      from: [3077, 3044, 1042],
      into: [],
      tags: ['Health', 'Damage', 'AttackSpeed', 'Slow']
    },
    '6653': {
      id: 6653,
      name: '兰德里的折磨',
      totalCost: 3000,
      baseCost: 800,
      purchasable: true,
      from: [3147, 2508],
      into: [],
      tags: ['Health', 'SpellDamage']
    },
    '6655': {
      id: 6655,
      name: '卢登的回声',
      totalCost: 2750,
      baseCost: 450,
      purchasable: true,
      from: [3802, 3145],
      into: [],
      tags: ['SpellDamage', 'Mana', 'CooldownReduction', 'AbilityHaste']
    },
    '6657': {
      id: 6657,
      name: '时光之杖',
      totalCost: 2600,
      baseCost: 450,
      purchasable: true,
      from: [1026, 3803],
      into: [],
      tags: ['Health', 'HealthRegen', 'SpellDamage', 'Mana', 'ManaRegen']
    },
    '6660': {
      id: 6660,
      name: '斑比的熔渣',
      totalCost: 900,
      baseCost: 250,
      purchasable: true,
      from: [1028, 2022],
      into: [3068, 6664],
      tags: ['Health', 'AbilityHaste']
    },
    '6662': {
      id: 6662,
      name: '冰脉护手',
      totalCost: 2900,
      baseCost: 800,
      purchasable: true,
      from: [3057, 1028, 1031],
      into: [],
      tags: ['Health', 'Armor', 'CooldownReduction', 'Slow', 'OnHit', 'AbilityHaste']
    },
    '6664': {
      id: 6664,
      name: '璀璨回响',
      totalCost: 2800,
      baseCost: 650,
      purchasable: true,
      from: [6660, 3211],
      into: [],
      tags: ['Health', 'SpellBlock', 'HealthRegen', 'Aura', 'MagicResist', 'AbilityHaste']
    },
    '6665': {
      id: 6665,
      name: '千变者贾修',
      totalCost: 3200,
      baseCost: 650,
      purchasable: true,
      from: [1011, 1031, 1057],
      into: [],
      tags: ['Health', 'SpellBlock', 'Armor', 'MagicResist']
    },
    '6670': {
      id: 6670,
      name: '正午箭袋',
      totalCost: 1300,
      baseCost: 350,
      purchasable: true,
      from: [1036, 1018],
      into: [2523, 3036, 6673],
      tags: ['Damage', 'CriticalStrike']
    },
    '6672': {
      id: 6672,
      name: '海妖杀手',
      totalCost: 3000,
      baseCost: 325,
      purchasable: true,
      from: [6690, 3051, 1043],
      into: [],
      tags: ['Damage', 'AttackSpeed', 'OnHit', 'NonbootsMovement']
    },
    '6673': {
      id: 6673,
      name: '不朽盾弓',
      totalCost: 3000,
      baseCost: 825,
      purchasable: true,
      from: [1037, 6670],
      into: [],
      tags: ['Damage', 'CriticalStrike']
    },
    '6675': {
      id: 6675,
      name: '纳沃利烁刃',
      totalCost: 2650,
      baseCost: 950,
      purchasable: true,
      from: [1042, 3086, 1042],
      into: [],
      tags: ['CriticalStrike', 'AttackSpeed', 'NonbootsMovement']
    },
    '6676': {
      id: 6676,
      name: '收集者',
      totalCost: 3000,
      baseCost: 525,
      purchasable: true,
      from: [1037, 3134, 1018],
      into: [],
      tags: ['Damage', 'CriticalStrike', 'ArmorPenetration']
    },
    '6690': {
      id: 6690,
      name: '剑翎',
      totalCost: 775,
      baseCost: 425,
      purchasable: true,
      from: [1036],
      into: [4003, 6700, 6672, 3142],
      tags: ['Damage', 'NonbootsMovement']
    },
    '6692': {
      id: 6692,
      name: '星蚀',
      totalCost: 2900,
      baseCost: 625,
      purchasable: true,
      from: [3133, 1037, 1036],
      into: [],
      tags: ['Damage', 'CooldownReduction', 'AbilityHaste']
    },
    '6694': {
      id: 6694,
      name: '赛瑞尔达的怨恨',
      totalCost: 3000,
      baseCost: 500,
      purchasable: true,
      from: [3133, 3035],
      into: [],
      tags: ['Damage', 'CooldownReduction', 'ArmorPenetration', 'AbilityHaste']
    },
    '6695': {
      id: 6695,
      name: '巨蛇之牙',
      totalCost: 2500,
      baseCost: 625,
      purchasable: true,
      from: [3134, 1037],
      into: [],
      tags: ['Damage', 'ArmorPenetration']
    },
    '6696': {
      id: 6696,
      name: '公理圆弧',
      totalCost: 2750,
      baseCost: 363,
      purchasable: true,
      from: [2020, 3133],
      into: [],
      tags: ['Damage', 'ArmorPenetration', 'AbilityHaste']
    },
    '6697': {
      id: 6697,
      name: '狂妄',
      totalCost: 2800,
      baseCost: 750,
      purchasable: true,
      from: [3134, 3133],
      into: [],
      tags: ['Damage', 'Active', 'CooldownReduction', 'ArmorPenetration', 'AbilityHaste']
    },
    '6698': {
      id: 6698,
      name: '亵渎九头蛇',
      totalCost: 2850,
      baseCost: 313,
      purchasable: true,
      from: [3077, 2020],
      into: [],
      tags: ['Damage', 'Active', 'CooldownReduction', 'ArmorPenetration', 'AbilityHaste']
    },
    '6699': {
      id: 6699,
      name: '电震涡流剑',
      totalCost: 3000,
      baseCost: 963,
      purchasable: true,
      from: [2020, 1036, 1036],
      into: [],
      tags: ['Damage', 'Active', 'CooldownReduction', 'ArmorPenetration', 'AbilityHaste']
    },
    '8010': {
      id: 8010,
      name: '放血者的诅咒',
      totalCost: 2900,
      baseCost: 750,
      purchasable: true,
      from: [3147, 3108],
      into: [],
      tags: ['Health', 'SpellDamage', 'CooldownReduction', 'MagicPenetration']
    },
    '8020': {
      id: 8020,
      name: '深渊面具',
      totalCost: 2650,
      baseCost: 1000,
      purchasable: true,
      from: [3067, 1057],
      into: [],
      tags: ['Health', 'SpellBlock', 'CooldownReduction', 'MagicResist', 'AbilityHaste']
    },
    '322065': {
      id: 322065,
      name: '舒瑞娅的战歌',
      totalCost: 2600,
      baseCost: 800,
      purchasable: true,
      from: [3113, 4642],
      into: [],
      tags: [
        'SpellDamage',
        'ManaRegen',
        'Active',
        'CooldownReduction',
        'NonbootsMovement',
        'AbilityHaste'
      ]
    },
    '322526': {
      id: 322526,
      name: '耳语头环',
      totalCost: 2250,
      baseCost: 850,
      purchasable: true,
      from: [3114, 1028, 323070],
      into: [322530],
      tags: ['Health', 'Mana', 'ManaRegen']
    },
    '323003': {
      id: 323003,
      name: '大天使之杖',
      totalCost: 2900,
      baseCost: 450,
      purchasable: true,
      from: [323070, 3802, 3108],
      into: [],
      tags: ['SpellDamage', 'Mana', 'AbilityHaste']
    },
    '323004': {
      id: 323004,
      name: '魔宗',
      totalCost: 2900,
      baseCost: 1100,
      purchasable: true,
      from: [323070, 3133, 1036],
      into: [],
      tags: ['Damage', 'Mana', 'CooldownReduction', 'OnHit', 'AbilityHaste']
    },
    '323050': {
      id: 323050,
      name: '基克的聚合',
      totalCost: 2300,
      baseCost: 800,
      purchasable: true,
      from: [1029, 3067, 1033],
      into: [],
      tags: ['Health', 'SpellBlock', 'Armor', 'AbilityHaste']
    },
    '323070': {
      id: 323070,
      name: '女神之泪',
      totalCost: 400,
      baseCost: 400,
      purchasable: true,
      from: [],
      into: [3003, 3004, 323003, 323004, 322526, 323119],
      tags: ['Mana', 'ManaRegen']
    },
    '323075': {
      id: 323075,
      name: '荆棘之甲',
      totalCost: 2650,
      baseCost: 650,
      purchasable: true,
      from: [3076, 1031, 1028],
      into: [],
      tags: ['Health', 'Armor']
    },
    '323107': {
      id: 323107,
      name: '救赎',
      totalCost: 2800,
      baseCost: 1000,
      purchasable: true,
      from: [3067, 1028, 3114],
      into: [],
      tags: ['SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '323109': {
      id: 323109,
      name: '骑士之誓',
      totalCost: 2900,
      baseCost: 1000,
      purchasable: true,
      from: [3067, 1031, 1006],
      into: [],
      tags: [
        'Health',
        'HealthRegen',
        'Armor',
        'Aura',
        'Active',
        'CooldownReduction',
        'AbilityHaste'
      ]
    },
    '323110': {
      id: 323110,
      name: '冰霜之心',
      totalCost: 2700,
      baseCost: 800,
      purchasable: true,
      from: [3082, 3024],
      into: [],
      tags: ['Armor', 'Mana', 'Aura', 'CooldownReduction', 'AbilityHaste']
    },
    '323119': {
      id: 323119,
      name: '凛冬之临',
      totalCost: 2400,
      baseCost: 300,
      purchasable: true,
      from: [323070, 1011, 3067],
      into: [],
      tags: ['Health', 'Mana', 'AbilityHaste']
    },
    '323190': {
      id: 323190,
      name: '钢铁烈阳之匣',
      totalCost: 2600,
      baseCost: 1100,
      purchasable: true,
      from: [3067, 1029, 1033],
      into: [],
      tags: ['Health', 'SpellBlock', 'Armor', 'Aura', 'Active', 'MagicResist', 'AbilityHaste']
    },
    '323222': {
      id: 323222,
      name: '米凯尔的祝福',
      totalCost: 2800,
      baseCost: 1000,
      purchasable: true,
      from: [3067, 1028, 3114],
      into: [],
      tags: ['Health', 'ManaRegen', 'Active', 'CooldownReduction', 'Tenacity', 'AbilityHaste']
    },
    '323504': {
      id: 323504,
      name: '炽热香炉',
      totalCost: 2600,
      baseCost: 700,
      purchasable: true,
      from: [3113, 1052, 3114],
      into: [],
      tags: ['AttackSpeed', 'SpellDamage', 'ManaRegen', 'NonbootsMovement']
    },
    '324005': {
      id: 324005,
      name: '帝国指令',
      totalCost: 2400,
      baseCost: 650,
      purchasable: true,
      from: [1026, 4642],
      into: [],
      tags: ['SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '326616': {
      id: 326616,
      name: '流水法杖',
      totalCost: 2600,
      baseCost: 750,
      purchasable: true,
      from: [3108, 1052, 3114],
      into: [],
      tags: ['SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '326617': {
      id: 326617,
      name: '月石再生器',
      totalCost: 2900,
      baseCost: 800,
      purchasable: true,
      from: [3067, 1028, 4642],
      into: [],
      tags: ['Health', 'SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '326620': {
      id: 326620,
      name: '海力亚的回响',
      totalCost: 2600,
      baseCost: 900,
      purchasable: true,
      from: [3067, 4642],
      into: [],
      tags: ['Health', 'SpellDamage', 'ManaRegen', 'CooldownReduction', 'AbilityHaste']
    },
    '326621': {
      id: 326621,
      name: '黎明核心',
      totalCost: 2900,
      baseCost: 850,
      purchasable: true,
      from: [1026, 3114, 3114],
      into: [],
      tags: ['SpellDamage', 'ManaRegen']
    },
    '326657': {
      id: 326657,
      name: '时光之杖',
      totalCost: 2600,
      baseCost: 450,
      purchasable: true,
      from: [1026, 3803],
      into: [],
      tags: ['Health', 'HealthRegen', 'SpellDamage', 'Mana', 'ManaRegen']
    },
    '328020': {
      id: 328020,
      name: '深渊面具',
      totalCost: 2850,
      baseCost: 1200,
      purchasable: true,
      from: [3067, 1057],
      into: [],
      tags: ['Health', 'SpellBlock', 'CooldownReduction', 'MagicResist', 'AbilityHaste']
    },
    '663039': {
      id: 663039,
      name: '阿塔玛的清算',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'CriticalStrike', 'Lane']
    },
    '663056': {
      id: 663056,
      name: '魔王之冕',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: [
        'Health',
        'Armor',
        'Damage',
        'AttackSpeed',
        'SpellDamage',
        'MagicResist',
        'AbilityHaste'
      ]
    },
    '663058': {
      id: 663058,
      name: '熔石之盾',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'Armor']
    },
    '663059': {
      id: 663059,
      name: '星夜斗篷',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'SpellBlock']
    },
    '663060': {
      id: 663060,
      name: '神圣之剑',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Damage', 'CriticalStrike', 'SpellDamage']
    },
    '663064': {
      id: 663064,
      name: '维迦的飞升护符',
      totalCost: 900,
      baseCost: 900,
      purchasable: true,
      from: [],
      into: [],
      tags: []
    },
    '663146': {
      id: 663146,
      name: '海克斯科技枪刃',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Damage', 'LifeSteal', 'SpellDamage', 'Active', 'SpellVamp']
    },
    '663172': {
      id: 663172,
      name: '灵风',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['AttackSpeed', 'CooldownReduction', 'OnHit', 'NonbootsMovement', 'Tenacity']
    },
    '663193': {
      id: 663193,
      name: '石像鬼石板甲',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['SpellBlock', 'Armor', 'Active', 'CooldownReduction', 'AbilityHaste']
    },
    '664011': {
      id: 664011,
      name: '花晓之剑',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'SpellDamage', 'CooldownReduction', 'OnHit', 'AbilityHaste']
    },
    '664644': {
      id: 664644,
      name: '破碎王后之冕',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Health', 'SpellDamage', 'Mana', 'AbilityHaste']
    },
    '667101': {
      id: 667101,
      name: '投机者之刃',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Damage', 'NonbootsMovement', 'MagicPenetration', 'ArmorPenetration', 'AbilityHaste']
    },
    '667109': {
      id: 667109,
      name: '残忍',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Armor', 'SpellDamage', 'MagicResist']
    },
    '667112': {
      id: 667112,
      name: '食肉斧剑',
      totalCost: 2500,
      baseCost: 2500,
      purchasable: true,
      from: [],
      into: [],
      tags: ['Damage', 'SpellDamage', 'MagicPenetration', 'ArmorPenetration']
    },
    '667666': {
      id: 667666,
      name: '收集者',
      totalCost: 3000,
      baseCost: 525,
      purchasable: true,
      from: [1037, 3134, 1018],
      into: [],
      tags: ['Damage', 'CriticalStrike', 'ArmorPenetration']
    }
  }
}
