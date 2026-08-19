import { eq } from 'drizzle-orm'
import { getDb } from '../db.js'
import { packages, aiProviderCostVersions } from '../db/schema.js'
import type { AIProviderCategory } from '../types.js'

export interface OperationCostEstimate {
  operation: string
  creditCost: number
  operatorCostCents: number
}

export interface PackageProfitability {
  packageId: string
  packageName: string
  priceCents: number
  includedTokens: number
  revenuePerCreditCents: number
  maxCostPerCreditCents: number
  minPriceCents: number
  suggestedPriceCents: number
  marginPct: number
  status: 'profitable' | 'warning' | 'loss'
  costPerOperation: OperationCostEstimate[]
  missingPricing: string[]
}

interface RateSet {
  inputRate: number
  outputRate: number
  imageRate: number
  audioRate: number
}

export interface CostOverride {
  provider: string
  category: AIProviderCategory
  inputRate: number
  outputRate: number
  imageRate: number
  audioRate: number
}

const LLM_FALLBACKS = ['deepseek', 'mistral'] as const
const IMAGE_FALLBACKS = ['openai', 'gemini'] as const
const STT_FALLBACKS = ['openai-stt', 'groq'] as const

const STANDARD_POST_EST_INPUT = 3000
const STANDARD_POST_EST_OUTPUT = 1500
const MINUTE_PER_AUDIO = 1

/**
 * Evaluates per-package profitability using the ACTIVE pricing versions from
 * ai_provider_cost_versions. If a provider/model has no active pricing version,
 * its cost is treated as 0 BUT is flagged so reports never present a silent,
 * fabricated zero.
 *
 * @param overrideCosts Optional simulated cost changes — used by the margin
 *   guard to preview the effect of a proposed provider cost change BEFORE it
 *   is persisted (Phase 13/14). The override replaces the active version for
 *   the matching provider+category.
 */
export async function evaluatePackageProfitability(overrideCosts?: CostOverride[]): Promise<PackageProfitability[]> {
  const db = getDb()
  const pkgs = await db.select().from(packages).orderBy(packages.sortOrder)
  const versions = await db
    .select()
    .from(aiProviderCostVersions)
    .where(eq(aiProviderCostVersions.active, true))

  const costMap = new Map<string, RateSet>()
  for (const v of versions) {
    costMap.set(`${v.provider}:${v.category}`, {
      inputRate: v.inputRate,
      outputRate: v.outputRate,
      imageRate: v.imageRate,
      audioRate: v.audioRate,
    })
  }
  for (const o of overrideCosts || []) {
    costMap.set(`${o.provider}:${o.category}`, {
      inputRate: o.inputRate,
      outputRate: o.outputRate,
      imageRate: o.imageRate,
      audioRate: o.audioRate,
    })
  }

  function pickRate(providerKey: string, fallbacks: readonly string[], category: string): RateSet | undefined {
    for (const p of [providerKey, ...fallbacks]) {
      const set = costMap.get(`${p}:${category}`)
      if (set) return set
    }
    return undefined
  }

  const results: PackageProfitability[] = []

  for (const pkg of pkgs) {
    const includedTokens = pkg.includedTokens || 0
    const priceCents = pkg.priceCents || 0
    const revenuePerCredit = includedTokens > 0 ? priceCents / includedTokens : 0

    let maxCostPerCredit = 0
    const costPerOperation: OperationCostEstimate[] = []
    const missingPricing: string[] = []

    const llmCost = pickRate('deepseek', LLM_FALLBACKS, 'llm')
    const imageCost = pickRate('openai', IMAGE_FALLBACKS, 'image')
    const sttCost = pickRate('openai-stt', STT_FALLBACKS, 'stt')

    if (!llmCost) missingPricing.push('llm')
    if (!imageCost) missingPricing.push('image')
    if (!sttCost) missingPricing.push('stt')

    if (llmCost && imageCost) {
      const estLlmCents = Math.ceil((STANDARD_POST_EST_INPUT * llmCost.inputRate + STANDARD_POST_EST_OUTPUT * llmCost.outputRate) / 1_000_000)
      const estImageCents = imageCost.imageRate
      const estTotal = estLlmCents + estImageCents
      costPerOperation.push({ operation: 'standard_post', creditCost: 1, operatorCostCents: estTotal })
      maxCostPerCredit = Math.max(maxCostPerCredit, estTotal)
    }

    if (imageCost) {
      costPerOperation.push({ operation: 'image_regenerate', creditCost: 1, operatorCostCents: imageCost.imageRate })
      maxCostPerCredit = Math.max(maxCostPerCredit, imageCost.imageRate)
    }

    if (llmCost && imageCost) {
      const estLlmCents = Math.ceil((STANDARD_POST_EST_INPUT * llmCost.inputRate + STANDARD_POST_EST_OUTPUT * llmCost.outputRate) / 1_000_000)
      const estTotal = (estLlmCents + imageCost.imageRate) * 2
      const perCredit = estTotal / 2
      costPerOperation.push({ operation: 'cross_platform', creditCost: 2, operatorCostCents: estTotal })
      maxCostPerCredit = Math.max(maxCostPerCredit, perCredit)
    }

    if (llmCost && imageCost) {
      const estLlmCents = Math.ceil((STANDARD_POST_EST_INPUT * llmCost.inputRate + STANDARD_POST_EST_OUTPUT * llmCost.outputRate) / 1_000_000)
      const estTotal = (estLlmCents + imageCost.imageRate) * 5
      const perCredit = estTotal / 5
      costPerOperation.push({ operation: 'ad_campaign', creditCost: 5, operatorCostCents: estTotal })
      maxCostPerCredit = Math.max(maxCostPerCredit, perCredit)
    }

    if (sttCost) {
      const estAudioCents = sttCost.audioRate * MINUTE_PER_AUDIO
      costPerOperation.push({ operation: 'voice_transcription', creditCost: 1, operatorCostCents: estAudioCents })
      maxCostPerCredit = Math.max(maxCostPerCredit, estAudioCents)
    }

    const minPriceCents = includedTokens * maxCostPerCredit
    const suggestedPriceCents = Math.ceil(minPriceCents * 3)
    const marginPct = revenuePerCredit > 0 ? ((revenuePerCredit - maxCostPerCredit) / revenuePerCredit) * 100 : 0

    let status: 'profitable' | 'warning' | 'loss' = 'profitable'
    if (revenuePerCredit < maxCostPerCredit) {
      status = 'loss'
    } else if (marginPct < 30) {
      status = 'warning'
    } else if (missingPricing.length > 0) {
      // Cost is unknown for some provider/model — never report a fake 100% margin.
      status = 'warning'
    }

    results.push({
      packageId: pkg.id,
      packageName: pkg.name,
      priceCents,
      includedTokens,
      revenuePerCreditCents: revenuePerCredit,
      maxCostPerCreditCents: maxCostPerCredit,
      minPriceCents,
      suggestedPriceCents,
      marginPct,
      status,
      costPerOperation,
      missingPricing,
    })
  }

  return results
}

/**
 * Margin guard for admin cost/provider changes. Returns:
 *   - BLOCK when any package would run at a loss (< 0% margin) under the
 *     proposed change (applies to both new and existing packages),
 *   - WARNING when the lowest margin is 0–30%,
 *   - PROFITABLE when every package is ≥ 30% margin.
 */
export async function checkProposedMargin(overrideCosts: CostOverride[]): Promise<{ result: 'BLOCK' | 'WARNING' | 'PROFITABLE'; packages: PackageProfitability[]; lossPackages: string[]; lowMarginPackages: string[] }> {
  const evaluated = await evaluatePackageProfitability(overrideCosts)
  const lossPackages = evaluated.filter((p) => p.status === 'loss').map((p) => p.packageName)
  const lowMarginPackages = evaluated.filter((p) => p.status === 'warning').map((p) => p.packageName)
  if (lossPackages.length > 0) {
    return { result: 'BLOCK', packages: evaluated, lossPackages, lowMarginPackages }
  }
  if (lowMarginPackages.length > 0) {
    return { result: 'WARNING', packages: evaluated, lossPackages, lowMarginPackages }
  }
  return { result: 'PROFITABLE', packages: evaluated, lossPackages, lowMarginPackages }
}
