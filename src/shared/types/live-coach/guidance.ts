import { z } from 'zod'

export interface FogInference {
  id: string
  sessionId: string
  enemyTrackId: string
  basisEvidenceIds: string[]
  lastSeenAt: number
  predictedRegions: Array<{ regionId: string; probability: number }>
  candidateRoutes: Array<{ regionIds: string[]; probability: number }>
  arrivalWindow: { earliestAt: number; latestAt: number } | null
  intents: Array<{
    kind: 'roam' | 'recall' | 'ambush' | 'flank' | 'objective' | 'lane-swap' | 'unknown'
    probability: number
  }>
  confidence: number
  createdAt: number
  expiresAt: number
  modelVersion: string
}

export interface ItemPurchasePlan {
  itemIds: number[]
  totalCost: number
  remainingGold: number
  missingGold: number
  reasonCodes: string[]
  conditions: string[]
}

export interface ItemPurchaseGuidance {
  id: string
  sessionId: string
  patch: string
  championId: number
  currentGold: number
  inventoryItemIds: number[]
  primaryPlan: ItemPurchasePlan
  alternativePlans: ItemPurchasePlan[]
  evidenceIds: string[]
  createdAt: number
  expiresAt: number
  ruleVersion: string
}

export const fogInferenceSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  enemyTrackId: z.string(),
  basisEvidenceIds: z.array(z.string()),
  lastSeenAt: z.number(),
  predictedRegions: z.array(
    z.object({
      regionId: z.string(),
      probability: z.number()
    })
  ),
  candidateRoutes: z.array(
    z.object({
      regionIds: z.array(z.string()),
      probability: z.number()
    })
  ),
  arrivalWindow: z
    .object({
      earliestAt: z.number(),
      latestAt: z.number()
    })
    .nullable(),
  intents: z.array(
    z.object({
      kind: z.enum(['roam', 'recall', 'ambush', 'flank', 'objective', 'lane-swap', 'unknown']),
      probability: z.number()
    })
  ),
  confidence: z.number(),
  createdAt: z.number(),
  expiresAt: z.number(),
  modelVersion: z.string()
})

export const itemPurchasePlanSchema = z.object({
  itemIds: z.array(z.number()),
  totalCost: z.number(),
  remainingGold: z.number(),
  missingGold: z.number(),
  reasonCodes: z.array(z.string()),
  conditions: z.array(z.string())
})

export const itemPurchaseGuidanceSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  patch: z.string(),
  championId: z.number(),
  currentGold: z.number(),
  inventoryItemIds: z.array(z.number()),
  primaryPlan: itemPurchasePlanSchema,
  alternativePlans: z.array(itemPurchasePlanSchema),
  evidenceIds: z.array(z.string()),
  createdAt: z.number(),
  expiresAt: z.number(),
  ruleVersion: z.string()
})
