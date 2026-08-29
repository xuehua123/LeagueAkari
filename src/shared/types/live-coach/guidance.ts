import { z } from 'zod'

export type ItemGuidanceMode = 'system' | 'common' | 'adaptive' | 'custom'

export type CustomItemBuilds = Record<string, number[]>

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
  mode: ItemGuidanceMode
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
  lastSeenAt: z.number().min(0),
  predictedRegions: z.array(
    z.object({
      regionId: z.string(),
      probability: z.number().min(0).max(1)
    })
  ),
  candidateRoutes: z.array(
    z.object({
      regionIds: z.array(z.string()),
      probability: z.number().min(0).max(1)
    })
  ),
  arrivalWindow: z
    .object({
      earliestAt: z.number().min(0),
      latestAt: z.number().min(0)
    })
    .refine((w) => w.latestAt >= w.earliestAt, {
      message: 'latestAt must be greater than or equal to earliestAt'
    })
    .nullable(),
  intents: z.array(
    z.object({
      kind: z.enum(['roam', 'recall', 'ambush', 'flank', 'objective', 'lane-swap', 'unknown']),
      probability: z.number().min(0).max(1)
    })
  ),
  confidence: z.number().min(0).max(1),
  createdAt: z.number().min(0),
  expiresAt: z.number().min(0),
  modelVersion: z.string()
})

export const itemPurchasePlanSchema = z.object({
  itemIds: z.array(z.number()),
  totalCost: z.number().min(0),
  remainingGold: z.number().min(0),
  missingGold: z.number().min(0),
  reasonCodes: z.array(z.string()),
  conditions: z.array(z.string())
})

export const itemPurchaseGuidanceSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  patch: z.string(),
  championId: z.number(),
  mode: z.enum(['system', 'common', 'adaptive', 'custom']),
  currentGold: z.number().min(0),
  inventoryItemIds: z.array(z.number()),
  primaryPlan: itemPurchasePlanSchema,
  alternativePlans: z.array(itemPurchasePlanSchema),
  evidenceIds: z.array(z.string()),
  createdAt: z.number().min(0),
  expiresAt: z.number().min(0),
  ruleVersion: z.string()
})
