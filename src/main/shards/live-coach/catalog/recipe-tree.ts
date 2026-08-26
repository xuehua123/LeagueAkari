import { ItemCatalogSnapshot, RiotItemCatalog16_16_1 } from './items-16-16-1'

export interface ItemDeductionResult {
  targetItemId: number
  targetItemName: string
  totalOriginalCost: number
  deductedCost: number
  netCost: number
  missingGold: number
  consumedItemIds: number[]
  nextPurchasableItemIds: number[]
  isCompleted: boolean
}

export class RecipeTreeEngine {
  private _catalog: ItemCatalogSnapshot

  constructor(catalog: ItemCatalogSnapshot = RiotItemCatalog16_16_1) {
    this._catalog = catalog
  }

  public get version(): string {
    return this._catalog.version
  }

  public getItem(itemId: number) {
    return this._catalog.items[itemId] || null
  }

  /**
   * 递归多重集合装备树抵扣计算 (Recursive Multiset Item Tree Consumption)
   * 完美支持：
   * 1. 任意深度下级组件（如长剑 1036、红水晶 1028 抵扣挺进破坏者/黑切/玛莫提乌斯）
   * 2. 重复组件多重集合（如狂徒铠甲持有多条巨人腰带 1011）
   * 3. 贪心优先抵扣最高层级组件，未拥有时递归抵扣子组件
   */
  public calculateNetCost(
    targetItemId: number,
    inventoryItems: Array<{ itemID: number; count?: number }>,
    currentGold: number
  ): ItemDeductionResult {
    const targetItem = this.getItem(targetItemId)
    if (!targetItem) {
      return {
        targetItemId,
        targetItemName: `Item_${targetItemId}`,
        totalOriginalCost: 0,
        deductedCost: 0,
        netCost: 0,
        missingGold: 0,
        consumedItemIds: [],
        nextPurchasableItemIds: [],
        isCompleted: false
      }
    }

    // 1. 构建背包物品多重集合 (Multiset)
    const availableItems = new Map<number, number>()
    for (const item of inventoryItems) {
      const count = item.count || 1
      availableItems.set(item.itemID, (availableItems.get(item.itemID) || 0) + count)
    }

    // 2. 如果玩家已拥有该成装本身
    if ((availableItems.get(targetItemId) || 0) > 0) {
      return {
        targetItemId,
        targetItemName: targetItem.name,
        totalOriginalCost: targetItem.totalCost,
        deductedCost: targetItem.totalCost,
        netCost: 0,
        missingGold: 0,
        consumedItemIds: [targetItemId],
        nextPurchasableItemIds: [],
        isCompleted: true
      }
    }

    const consumedItemIds: number[] = []
    let totalDeductedCost = 0
    const unfulfilledComponents: number[] = []

    // 3. 递归消费配方树节点
    const consumeNode = (itemId: number): boolean => {
      const currentAvailable = availableItems.get(itemId) || 0
      if (currentAvailable > 0) {
        availableItems.set(itemId, currentAvailable - 1)
        consumedItemIds.push(itemId)
        const def = this.getItem(itemId)
        totalDeductedCost += def ? def.totalCost : 0
        return true
      }

      const itemDef = this.getItem(itemId)
      if (!itemDef || !itemDef.from || itemDef.from.length === 0) {
        return false
      }

      // 玩家没有该合成件，尝试递归消费其子组件
      let anyChildConsumed = false
      for (const childId of itemDef.from) {
        if (consumeNode(childId)) {
          anyChildConsumed = true
        }
      }
      return anyChildConsumed
    }

    // 针对目标装备的直接合成路线进行消费
    if (targetItem.from && targetItem.from.length > 0) {
      for (const compId of targetItem.from) {
        const compDef = this.getItem(compId)
        const compCount = availableItems.get(compId) || 0
        if (compCount > 0) {
          availableItems.set(compId, compCount - 1)
          consumedItemIds.push(compId)
          totalDeductedCost += compDef ? compDef.totalCost : 0
        } else {
          // 尝试子组件消费
          if (compDef && compDef.from && compDef.from.length > 0) {
            for (const childId of compDef.from) {
              consumeNode(childId)
            }
          }
          unfulfilledComponents.push(compId)
        }
      }
    }

    const netCost = Math.max(0, targetItem.totalCost - totalDeductedCost)
    const missingGold = Math.max(0, netCost - currentGold)

    // 计算下一步推荐购买的组件（优先推荐买得起的未拥有组件）
    const nextPurchasableItemIds: number[] = []
    for (const compId of unfulfilledComponents) {
      const compDef = this.getItem(compId)
      if (compDef) {
        // 如果买得起该直接组件
        if (currentGold >= compDef.totalCost) {
          nextPurchasableItemIds.push(compId)
        } else if (compDef.from && compDef.from.length > 0) {
          // 推荐买得起的子组件
          for (const subId of compDef.from) {
            const subDef = this.getItem(subId)
            if (subDef && currentGold >= subDef.totalCost) {
              nextPurchasableItemIds.push(subId)
            }
          }
        } else {
          nextPurchasableItemIds.push(compId)
        }
      }
    }

    if (nextPurchasableItemIds.length === 0 && unfulfilledComponents.length > 0) {
      nextPurchasableItemIds.push(unfulfilledComponents[0])
    }

    return {
      targetItemId,
      targetItemName: targetItem.name,
      totalOriginalCost: targetItem.totalCost,
      deductedCost: totalDeductedCost,
      netCost,
      missingGold,
      consumedItemIds,
      nextPurchasableItemIds: Array.from(new Set(nextPurchasableItemIds)),
      isCompleted: netCost === 0
    }
  }
}
