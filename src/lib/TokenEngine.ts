import { eq, sql } from 'drizzle-orm'
import { getDb } from '../db.js'
import { users, tokenTransactions, posts, adCampaigns } from '../db/schema.js'
import { logger } from './logger.js'
export type TokenAction = 'standard_post' | 'cross_platform' | 'image_regenerate' | 'ad_campaign' | 'voice_transcription'

interface TokenEstimate {
  action: TokenAction
  cost: number
  balanceAfter: number
  canAfford: boolean
}

interface TokenDeductionResult {
  success: boolean
  newBalance: number
  transactionId?: string
  error?: string
  alreadyCharged?: boolean
}

interface TokenRefundResult {
  success: boolean
  newBalance: number
  transactionId?: string
  error?: string
  alreadyRefunded?: boolean
}

interface ChargeOnceResult {
  success: boolean
  newBalance: number
  alreadyCharged?: boolean
  error?: string
}

const DEFAULT_COSTS: Record<TokenAction, number> = {
  standard_post: 1,
  cross_platform: 2,
  image_regenerate: 1,
  ad_campaign: 5,
  voice_transcription: 1,
}

export async function getConfiguredCost(action: TokenAction): Promise<number> {
  try {
    const { getConfig } = await import('../store.js')
    const config = await getConfig(`cost_${action}`)
    if (config) {
      const parsed = Number(config)
      if (!isNaN(parsed) && parsed >= 0) return parsed
    }
  } catch {}
  return DEFAULT_COSTS[action]
}

/**
 * Atomically claims an operation by inserting a ledger row carrying a unique
 * operation_id. Returns false if the claim is already taken (retry/dedup).
 */
async function withClaim(
  tx: any,
  opId: string | null,
  phone: string,
  type: string,
  amount: number,
  balanceAfter: number,
  description: string,
  extra?: { postId?: string | null; adminId?: string | null },
): Promise<{ claimed: boolean; id: string | null }> {
  const result = await tx
    .insert(tokenTransactions)
    .values({
      id: crypto.randomUUID(),
      phone,
      type,
      amount,
      balanceAfter,
      description,
      postId: extra?.postId ?? null,
      adminId: extra?.adminId ?? null,
      operationId: opId ?? null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing({ target: tokenTransactions.operationId })
    .returning({ id: tokenTransactions.id })
  return { claimed: result.length > 0, id: result[0]?.id ?? null }
}

export class TokenEngine {
  async estimate(action: TokenAction, phone: string): Promise<TokenEstimate> {
    const cost = await this.getCost(action)
    const user = await this.getUserBalance(phone)
    return {
      action,
      cost,
      balanceAfter: (user?.tokensRemaining ?? 0) - cost,
      canAfford: (user?.tokensRemaining ?? 0) >= cost,
    }
  }

  async deduct(action: TokenAction, phone: string, description?: string, operationId?: string): Promise<TokenDeductionResult> {
    const cost = await this.getCost(action)
    if (cost <= 0) {
      return { success: true, newBalance: 0 }
    }

    const db = getDb()
    const now = new Date().toISOString()

    try {
      return await db.transaction(async (tx) => {
        // Claim FIRST so concurrent retries can never double-charge.
        const { claimed, id: claimId } = await withClaim(tx, operationId ?? null, phone, 'deduct', -cost, 0, description || `Token deduction: ${action}`)
        if (!claimed) {
          const user = await tx
            .select({ tokensRemaining: users.tokensRemaining })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          return { success: true, newBalance: user[0]?.tokensRemaining ?? 0, alreadyCharged: true }
        }

        const result = await tx
          .update(users)
          .set({
            tokensRemaining: sql`${users.tokensRemaining} - ${cost}`,
            tokensUsed: sql`${users.tokensUsed} + ${cost}`,
            updatedAt: now,
          })
          .where(sql`${users.phone} = ${phone} AND ${users.tokensRemaining} >= ${cost}`)
          .returning({ tokensRemaining: users.tokensRemaining })

        if (result.length === 0) {
          await tx.delete(tokenTransactions).where(eq(tokenTransactions.id, claimId!))
          const user = await tx
            .select({ tokensRemaining: users.tokensRemaining })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          return {
            success: false,
            newBalance: user[0]?.tokensRemaining ?? 0,
            error: 'Insufficient tokens',
          }
        }

        const newBalance = result[0].tokensRemaining

        if (claimId) {
          await tx
            .update(tokenTransactions)
            .set({ balanceAfter: newBalance })
            .where(eq(tokenTransactions.id, claimId))
        }

        logger.info({ phone, action, cost, newBalance }, 'tokens deducted')

        return {
          success: true,
          newBalance,
          transactionId: claimId ?? undefined,
        }
      })
    } catch (err) {
      logger.error({ err, phone, action }, 'token deduction failed')
      throw err
    }
  }

  async refund(action: TokenAction, phone: string, description?: string, operationId?: string): Promise<TokenRefundResult> {
    const cost = await this.getCost(action)
    if (cost <= 0) {
      return { success: true, newBalance: 0 }
    }

    const db = getDb()
    const now = new Date().toISOString()

    try {
      return await db.transaction(async (tx) => {
        const { claimed, id: claimId } = await withClaim(tx, operationId ?? null, phone, 'refund', cost, 0, description || `Token refund: ${action}`)
        if (!claimed) {
          const user = await tx
            .select({ tokensRemaining: users.tokensRemaining })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          return { success: true, newBalance: user[0]?.tokensRemaining ?? 0, alreadyRefunded: true }
        }

        const result = await tx
          .update(users)
          .set({
            tokensRemaining: sql`${users.tokensRemaining} + ${cost}`,
            tokensUsed: sql`${users.tokensUsed} - ${cost}`,
            updatedAt: now,
          })
          .where(eq(users.phone, phone))
          .returning({ tokensRemaining: users.tokensRemaining })

        if (result.length === 0) {
          return { success: false, newBalance: 0, error: 'User not found' }
        }

        const newBalance = result[0].tokensRemaining

        if (claimId) {
          await tx
            .update(tokenTransactions)
            .set({ balanceAfter: newBalance })
            .where(eq(tokenTransactions.id, claimId))
        }

        logger.info({ phone, action, cost, newBalance }, 'tokens refunded')

        return {
          success: true,
          newBalance,
          transactionId: claimId ?? undefined,
        }
      })
    } catch (err) {
      logger.error({ err, phone, action }, 'token refund failed')
      throw err
    }
  }

  async grant(phone: string, amount: number, adminId?: string, description?: string, operationId?: string): Promise<TokenDeductionResult> {
    const db = getDb()
    const now = new Date().toISOString()

    try {
      return await db.transaction(async (tx) => {
        // Claim FIRST so concurrent retries can never double-grant.
        const { claimed, id: claimId } = await withClaim(tx, operationId ?? null, phone, 'grant', amount, 0, description || 'Token grant', { adminId: adminId || null })
        if (!claimed) {
          const user = await tx
            .select({ tokensRemaining: users.tokensRemaining })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          return { success: true, newBalance: user[0]?.tokensRemaining ?? 0, alreadyCharged: true }
        }

        const result = await tx
          .update(users)
          .set({
            tokensRemaining: sql`${users.tokensRemaining} + ${amount}`,
            updatedAt: now,
          })
          .where(eq(users.phone, phone))
          .returning({ tokensRemaining: users.tokensRemaining })

        if (result.length === 0) {
          await tx.delete(tokenTransactions).where(eq(tokenTransactions.id, claimId!))
          return { success: false, newBalance: 0, error: 'User not found' }
        }

        const newBalance = result[0].tokensRemaining

        if (claimId) {
          await tx
            .update(tokenTransactions)
            .set({ balanceAfter: newBalance })
            .where(eq(tokenTransactions.id, claimId))
        }

        logger.info({ phone, amount, newBalance, adminId }, 'tokens granted')

        return { success: true, newBalance, transactionId: claimId ?? undefined }
      })
    } catch (err) {
      logger.error({ err, phone, amount }, 'token grant failed')
      throw err
    }
  }

  /**
   * Atomically charges exactly one voice_transcription credit, keyed by a unique
   * operationId (e.g. the audio id) so retries never double-charge.
   */
  async chargeVoiceOnce(operationId: string, phone: string, description?: string): Promise<ChargeOnceResult> {
    const cost = await this.getCost('voice_transcription')
    if (cost <= 0) {
      return { success: true, newBalance: 0 }
    }

    const db = getDb()
    const now = new Date().toISOString()

    try {
      return await db.transaction(async (tx) => {
        // Claim FIRST so concurrent retries can never double-charge.
        const { claimed, id: claimId } = await withClaim(tx, operationId, phone, 'deduct', -cost, 0, description || 'Voice transcription')
        if (!claimed) {
          const user = await tx
            .select({ tokensRemaining: users.tokensRemaining })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          return { success: true, newBalance: user[0]?.tokensRemaining ?? 0, alreadyCharged: true }
        }

        const result = await tx
          .update(users)
          .set({
            tokensRemaining: sql`${users.tokensRemaining} - ${cost}`,
            tokensUsed: sql`${users.tokensUsed} + ${cost}`,
            updatedAt: now,
          })
          .where(sql`${users.phone} = ${phone} AND ${users.tokensRemaining} >= ${cost}`)
          .returning({ tokensRemaining: users.tokensRemaining })

        if (result.length === 0) {
          await tx.delete(tokenTransactions).where(eq(tokenTransactions.id, claimId!))
          const user = await tx
            .select({ tokensRemaining: users.tokensRemaining })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          return { success: false, newBalance: user[0]?.tokensRemaining ?? 0, error: 'Insufficient tokens' }
        }

        const newBalance = result[0].tokensRemaining

        if (claimId) {
          await tx
            .update(tokenTransactions)
            .set({ balanceAfter: newBalance })
            .where(eq(tokenTransactions.id, claimId))
        }

        logger.info({ phone, action: 'voice_transcription', cost, newBalance }, 'voice transcription charged once')

        return { success: true, newBalance, transactionId: claimId ?? undefined }
      })
    } catch (err) {
      logger.error({ err, phone }, 'voice transcription charge failed')
      throw err
    }
  }

  /**
   * Refunds exactly one voice_transcription credit for an operationId that was
   * charged via chargeVoiceOnce. Idempotent — a second call is a no-op.
   */
  async refundVoiceOnce(operationId: string, phone: string, description?: string): Promise<TokenRefundResult> {
    const cost = await this.getCost('voice_transcription')
    if (cost <= 0) {
      return { success: true, newBalance: 0 }
    }

    const db = getDb()
    const now = new Date().toISOString()

    try {
      return await db.transaction(async (tx) => {
        const { claimed, id: claimId } = await withClaim(tx, `${operationId}:refund`, phone, 'refund', cost, 0, description || 'Voice transcription refund')
        if (!claimed) {
          const user = await tx
            .select({ tokensRemaining: users.tokensRemaining })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          return { success: true, newBalance: user[0]?.tokensRemaining ?? 0, alreadyRefunded: true }
        }

        const charged = await tx
          .select({ id: tokenTransactions.id })
          .from(tokenTransactions)
          .where(eq(tokenTransactions.operationId, operationId))
          .limit(1)

        if (charged.length === 0) {
          await tx.delete(tokenTransactions).where(eq(tokenTransactions.id, claimId!))
          const user = await tx
            .select({ tokensRemaining: users.tokensRemaining })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          return { success: true, newBalance: user[0]?.tokensRemaining ?? 0, alreadyRefunded: true }
        }

        const result = await tx
          .update(users)
          .set({
            tokensRemaining: sql`${users.tokensRemaining} + ${cost}`,
            tokensUsed: sql`${users.tokensUsed} - ${cost}`,
            updatedAt: now,
          })
          .where(eq(users.phone, phone))
          .returning({ tokensRemaining: users.tokensRemaining })

        if (result.length === 0) {
          return { success: false, newBalance: 0, error: 'User not found' }
        }

        const newBalance = result[0].tokensRemaining

        if (claimId) {
          await tx
            .update(tokenTransactions)
            .set({ balanceAfter: newBalance })
            .where(eq(tokenTransactions.id, claimId))
        }

        logger.info({ phone, action: 'voice_transcription', cost, newBalance }, 'voice transcription refunded')

        return { success: true, newBalance, transactionId: claimId ?? undefined }
      })
    } catch (err) {
      logger.error({ err, phone }, 'voice transcription refund failed')
      throw err
    }
  }

  async refundPost(postId: string, phone: string, description?: string): Promise<TokenRefundResult> {
    const db = getDb()
    const now = new Date().toISOString()

    try {
      return await db.transaction(async (tx) => {
        // Atomic claim: only ONE concurrent refund can win this UPDATE. The row
        // becomes locked for this transaction and refunded_at is set first, so a
        // retry or a racing refund sees the claim already taken (0 rows returned).
        // tokensCharged is NOT modified here, so RETURNING gives the original cost.
        const claimed = await tx
          .update(posts)
          .set({ refundedAt: now, updatedAt: now })
          .where(sql`${posts.id} = ${postId} AND ${posts.refundedAt} IS NULL AND ${posts.tokensCharged} > 0`)
          .returning({ cost: posts.tokensCharged })

        if (claimed.length === 0) {
          const user = await tx
            .select({ tokensRemaining: users.tokensRemaining })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          return { success: true, newBalance: user[0]?.tokensRemaining ?? 0 }
        }

        const cost = claimed[0].cost

        const userResult = await tx
          .update(users)
          .set({
            tokensRemaining: sql`${users.tokensRemaining} + ${cost}`,
            tokensUsed: sql`${users.tokensUsed} - ${cost}`,
            updatedAt: now,
          })
          .where(eq(users.phone, phone))
          .returning({ tokensRemaining: users.tokensRemaining })

        if (userResult.length === 0) {
          return { success: false, newBalance: 0, error: 'User not found' }
        }

        const newBalance = userResult[0].tokensRemaining

        await tx.insert(tokenTransactions).values({
          id: crypto.randomUUID(),
          phone,
          type: 'refund',
          amount: cost,
          balanceAfter: newBalance,
          description: description || `Refund for post: ${postId}`,
          postId,
          createdAt: now,
        })

        await tx
          .update(posts)
          .set({ tokensCharged: 0, tokensChargedAction: null, updatedAt: now })
          .where(eq(posts.id, postId))

        logger.info({ phone, postId, cost, newBalance }, 'post refund completed')

        return {
          success: true,
          newBalance,
        }
      })
    } catch (err) {
      logger.error({ err, postId, phone }, 'post refund failed')
      throw err
    }
  }

  async chargePostOnce(postId: string, phone: string, action: TokenAction, description?: string): Promise<ChargeOnceResult> {
    const cost = await this.getCost(action)
    if (cost <= 0) {
      return { success: true, newBalance: 0 }
    }

    const db = getDb()
    const now = new Date().toISOString()

    try {
      return await db.transaction(async (tx) => {
        const postClaim = await tx
          .update(posts)
          .set({ tokensCharged: cost, tokensChargedAction: action, refundedAt: null, updatedAt: now })
          .where(sql`${posts.id} = ${postId} AND ${posts.tokensCharged} = 0`)
          .returning({ id: posts.id })

        if (postClaim.length === 0) {
          const existing = await tx
            .select({ tc: posts.tokensCharged })
            .from(posts)
            .where(eq(posts.id, postId))
            .limit(1)
          if (existing.length > 0 && existing[0].tc && existing[0].tc > 0) {
            const user = await tx
              .select({ tokensRemaining: users.tokensRemaining })
              .from(users)
              .where(eq(users.phone, phone))
              .limit(1)
            return { success: true, newBalance: user[0]?.tokensRemaining ?? 0, alreadyCharged: true }
          }
          return { success: false, newBalance: 0, error: 'Post not found' }
        }

        const userResult = await tx
          .update(users)
          .set({
            tokensRemaining: sql`${users.tokensRemaining} - ${cost}`,
            tokensUsed: sql`${users.tokensUsed} + ${cost}`,
            updatedAt: now,
          })
          .where(sql`${users.phone} = ${phone} AND ${users.tokensRemaining} >= ${cost}`)
          .returning({ tokensRemaining: users.tokensRemaining })

        if (userResult.length === 0) {
          await tx
            .update(posts)
            .set({ tokensCharged: 0, tokensChargedAction: null, updatedAt: now })
            .where(eq(posts.id, postId))
          return { success: false, newBalance: 0, error: 'Insufficient tokens' }
        }

        const newBalance = userResult[0].tokensRemaining

        await tx.insert(tokenTransactions).values({
          id: crypto.randomUUID(),
          phone,
          type: 'deduct',
          amount: -cost,
          balanceAfter: newBalance,
          description: description || `Post generation: ${postId}`,
          postId,
          createdAt: now,
        })

        logger.info({ phone, postId, action, cost, newBalance }, 'post charged once')

        return { success: true, newBalance }
      })
    } catch (err) {
      logger.error({ err, postId, phone, action }, 'chargePostOnce failed')
      throw err
    }
  }

  async chargeAdOnce(campaignId: string, phone: string, cost: number, description?: string): Promise<ChargeOnceResult> {
    if (cost <= 0) {
      return { success: true, newBalance: 0 }
    }

    const db = getDb()
    const now = new Date().toISOString()

    try {
      return await db.transaction(async (tx) => {
        const claim = await tx
          .update(adCampaigns)
          .set({ chargedTokens: cost, chargedAt: now, updatedAt: now })
          .where(sql`${adCampaigns.id} = ${campaignId} AND ${adCampaigns.chargedTokens} = 0`)
          .returning({ id: adCampaigns.id })

        if (claim.length === 0) {
          const existing = await tx
            .select({ ct: adCampaigns.chargedTokens })
            .from(adCampaigns)
            .where(eq(adCampaigns.id, campaignId))
            .limit(1)
          if (existing.length > 0 && existing[0].ct && existing[0].ct > 0) {
            const user = await tx
              .select({ tokensRemaining: users.tokensRemaining })
              .from(users)
              .where(eq(users.phone, phone))
              .limit(1)
            return { success: true, newBalance: user[0]?.tokensRemaining ?? 0, alreadyCharged: true }
          }
          return { success: false, newBalance: 0, error: 'Campaign not found' }
        }

        const userResult = await tx
          .update(users)
          .set({
            tokensRemaining: sql`${users.tokensRemaining} - ${cost}`,
            tokensUsed: sql`${users.tokensUsed} + ${cost}`,
            updatedAt: now,
          })
          .where(sql`${users.phone} = ${phone} AND ${users.tokensRemaining} >= ${cost}`)
          .returning({ tokensRemaining: users.tokensRemaining })

        if (userResult.length === 0) {
          await tx
            .update(adCampaigns)
            .set({ chargedTokens: 0, chargedAt: null, updatedAt: now })
            .where(eq(adCampaigns.id, campaignId))
          return { success: false, newBalance: 0, error: 'Insufficient tokens' }
        }

        const newBalance = userResult[0].tokensRemaining

        await tx.insert(tokenTransactions).values({
          id: crypto.randomUUID(),
          phone,
          type: 'deduct',
          amount: -cost,
          balanceAfter: newBalance,
          description: description || `Ad campaign: ${campaignId}`,
          createdAt: now,
        })

        logger.info({ phone, campaignId, cost, newBalance }, 'ad campaign charged once')

        return { success: true, newBalance }
      })
    } catch (err) {
      logger.error({ err, campaignId, phone }, 'chargeAdOnce failed')
      throw err
    }
  }

  private async getCost(action: TokenAction): Promise<number> {
    return getConfiguredCost(action)
  }

  private async getUserBalance(phone: string): Promise<{ tokensRemaining: number; tokensUsed: number } | undefined> {
    const db = getDb()
    const result = await db
      .select({ tokensRemaining: users.tokensRemaining, tokensUsed: users.tokensUsed })
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1)
    return result[0]
  }
}

export const tokenEngine = new TokenEngine()
