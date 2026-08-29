import { CURRENT_RIOT_ITEM_CATALOG } from './current'
import type { RiotItemCatalog } from './items-16-17-1'

export interface PurchasableItemOption {
  itemId: number
  name: string
  purchaseCost: number
  missingGold: number
  quantity?: number
  isDirectTarget: boolean
  isCombineUpgrade: boolean
}

export interface ItemDeductionResult {
  targetItemId: number
  targetItemName: string
  totalOriginalCost: number
  deductedCost: number
  netCost: number
  missingGold: number
  consumedItemIds: number[]
  purchasableOptions: PurchasableItemOption[]
  nextPurchasableOption: PurchasableItemOption | null
  isCompleted: boolean
}

export interface RecipeTreeNode {
  itemId: number
  name: string
  totalCost: number
  baseCost: number
  children: RecipeTreeNode[]
  isFulfilled: boolean
  remainingPurchaseCost: number
}

export class RecipeTreeEngine {
  private _catalog: RiotItemCatalog

  constructor(catalog: RiotItemCatalog = CURRENT_RIOT_ITEM_CATALOG) {
    this._catalog = catalog
  }

  public get version(): string {
    return this._catalog.version
  }

  public getItem(itemId: number) {
    return this._catalog.items[itemId] || null
  }

  /**
   * 递归多重集合装备树抵扣与升级费用计算 (Recursive Multiset Item Tree Consumption & Purchase Cost)
   * 1. 递归消费背包物品多重集合；
   * 2. 计算每个树节点的剩余购买/升级花费 (remainingPurchaseCost = baseCost + 未满足子组件成本)；
   * 3. 精准返回可购买组件及其实际所需费用 purchaseCost，杜绝重复推荐已拥有组件或使用全额总价。
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
        purchasableOptions: [],
        nextPurchasableOption: null,
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
        purchasableOptions: [],
        nextPurchasableOption: null,
        isCompleted: true
      }
    }

    const consumedItemIds: number[] = []

    // 3. 递归构建配方树并消费库存
    const buildNode = (id: number): RecipeTreeNode => {
      const def = this.getItem(id)
      const name = def?.name ?? `Item_${id}`
      const totalCost = def?.totalCost ?? 0
      const baseCost = def?.baseCost ?? totalCost

      // A. 若背包中持有该组件，则直接消费该组件
      const availableCount = availableItems.get(id) || 0
      if (availableCount > 0) {
        availableItems.set(id, availableCount - 1)
        consumedItemIds.push(id)
        return {
          itemId: id,
          name,
          totalCost,
          baseCost,
          children: [],
          isFulfilled: true,
          remainingPurchaseCost: 0
        }
      }

      // B. 若为复合装备，递归消费子组件
      if (def && def.from && def.from.length > 0) {
        const children = def.from.map((childId) => buildNode(childId))
        const childrenRemainingCost = children.reduce((sum, c) => sum + c.remainingPurchaseCost, 0)
        const remainingPurchaseCost = baseCost + childrenRemainingCost

        return {
          itemId: id,
          name,
          totalCost,
          baseCost,
          children,
          isFulfilled: false,
          remainingPurchaseCost
        }
      }

      // C. 基础组件未拥有
      return {
        itemId: id,
        name,
        totalCost,
        baseCost,
        children: [],
        isFulfilled: false,
        remainingPurchaseCost: totalCost
      }
    }

    const rootNode = buildNode(targetItemId)
    const netCost = rootNode.remainingPurchaseCost
    const deductedCost = Math.max(0, targetItem.totalCost - netCost)
    const missingGold = Math.max(0, netCost - currentGold)

    // 4. 收集所有未满足节点的购买选项（携带精准 purchaseCost）
    const rawOptions: PurchasableItemOption[] = []

    const collectOptions = (node: RecipeTreeNode) => {
      if (node.isFulfilled) return

      const hasChildren = node.children.length > 0
      const allChildrenFulfilled = hasChildren && node.children.every((c) => c.isFulfilled)

      if (allChildrenFulfilled) {
        // 子组件已全齐，可以合成为该节点（仅需支付 baseCost 合成费）
        rawOptions.push({
          itemId: node.itemId,
          name: node.name,
          purchaseCost: node.remainingPurchaseCost,
          missingGold: Math.max(0, node.remainingPurchaseCost - currentGold),
          isDirectTarget: node.itemId === targetItemId,
          isCombineUpgrade: true
        })
        return
      }

      if (hasChildren) {
        for (const child of node.children) {
          collectOptions(child)
        }
        // 若玩家买得起整件/中间件，也作为备选
        rawOptions.push({
          itemId: node.itemId,
          name: node.name,
          purchaseCost: node.remainingPurchaseCost,
          missingGold: Math.max(0, node.remainingPurchaseCost - currentGold),
          isDirectTarget: node.itemId === targetItemId,
          isCombineUpgrade: false
        })
      } else {
        // 基础散件
        rawOptions.push({
          itemId: node.itemId,
          name: node.name,
          purchaseCost: node.remainingPurchaseCost,
          missingGold: Math.max(0, node.remainingPurchaseCost - currentGold),
          isDirectTarget: node.itemId === targetItemId,
          isCombineUpgrade: false
        })
      }
    }

    collectOptions(rootNode)

    // 去重并按优先级排序
    const optionMap = new Map<number, PurchasableItemOption>()
    for (const opt of rawOptions) {
      const existing = optionMap.get(opt.itemId)
      if (!existing || opt.purchaseCost < existing.purchaseCost) {
        optionMap.set(opt.itemId, opt)
      }
    }

    const purchasableOptions = Array.from(optionMap.values())

    // 排序逻辑：
    // 1. 如果买得起直接目标装备，目标装备排第 1
    // 2. 如果已满足子组件可以合成进阶装备且买得起合成费，进阶装备优先
    // 3. 买得起的散件/组件优先
    // 4. 金币差额最小的组件优先
    purchasableOptions.sort((a, b) => {
      if (a.isDirectTarget && a.purchaseCost <= currentGold) return -1
      if (b.isDirectTarget && b.purchaseCost <= currentGold) return 1
      if (a.isCombineUpgrade && a.purchaseCost <= currentGold && !b.isCombineUpgrade) return -1
      if (b.isCombineUpgrade && b.purchaseCost <= currentGold && !a.isCombineUpgrade) return 1
      const aAffordable = a.purchaseCost <= currentGold
      const bAffordable = b.purchaseCost <= currentGold
      if (aAffordable && !bAffordable) return -1
      if (!aAffordable && bAffordable) return 1
      return a.purchaseCost - b.purchaseCost
    })

    const nextPurchasableOption = purchasableOptions[0] || null

    return {
      targetItemId,
      targetItemName: targetItem.name,
      totalOriginalCost: targetItem.totalCost,
      deductedCost,
      netCost,
      missingGold,
      consumedItemIds,
      purchasableOptions,
      nextPurchasableOption,
      isCompleted: netCost === 0
    }
  }
}
