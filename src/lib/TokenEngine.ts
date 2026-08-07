import { eq, sql } from 'drizzle-orm'
import { getDb } from '../db.js'
import { users, tokenTransactions } from '../db/schema.js'
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
}

interface TokenRefundResult {
  success: boolean
  newBalance: number
  transactionId?: string
  error?: string
}

const DEFAULT_COSTS: Record<TokenAction, number> = {
  standard_post: 1,
  cross_platform: 2,
  image_regenerate: 1,
  ad_campaign: 5,
  voice_transcription: 0,
}

async function getConfiguredCost(action: TokenAction): Promise<number> {
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

  async deduct(action: TokenAction, phone: string, description?: string): Promise<TokenDeductionResult> {
    const cost = await this.getCost(action)
    if (cost <= 0) {
      return { success: true, newBalance: 0 }
    }

    const db = getDb()
    const now = new Date().toISOString()

    try {
      const result = await db
        .update(users)
        .set({
          tokensRemaining: sql`${users.tokensRemaining} - ${cost}`,
          tokensUsed: sql`${users.tokensUsed} + ${cost}`,
          updatedAt: now,
        })
        .where(sql`${users.phone} = ${phone} AND ${users.tokensRemaining} >= ${cost}`)
        .returning({ tokensRemaining: users.tokensRemaining })

      if (result.length === 0) {
        const user = await this.getUserBalance(phone)
        return {
          success: false,
          newBalance: user?.tokensRemaining ?? 0,
          error: 'Insufficient tokens',
        }
      }

      const newBalance = result[0].tokensRemaining

      const txResult = await db
        .insert(tokenTransactions)
        .values({
          id: crypto.randomUUID(),
          phone,
          type: 'deduct',
          amount: -cost,
          balanceAfter: newBalance,
          description: description || `Token deduction: ${action}`,
          createdAt: now,
        })
        .returning({ id: tokenTransactions.id })

      logger.info({ phone, action, cost, newBalance }, 'tokens deducted')

      return {
        success: true,
        newBalance,
        transactionId: txResult[0]?.id,
      }
    } catch (err) {
      logger.error({ err, phone, action }, 'token deduction failed')
      throw err
    }
  }

  async refund(action: TokenAction, phone: string, description?: string): Promise<TokenRefundResult> {
    const cost = await this.getCost(action)
    if (cost <= 0) {
      return { success: true, newBalance: 0 }
    }

    const db = getDb()
    const now = new Date().toISOString()

    try {
      const result = await db
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

      const txResult = await db
        .insert(tokenTransactions)
        .values({
          id: crypto.randomUUID(),
          phone,
          type: 'refund',
          amount: cost,
          balanceAfter: newBalance,
          description: description || `Token refund: ${action}`,
          createdAt: now,
        })
        .returning({ id: tokenTransactions.id })

      logger.info({ phone, action, cost, newBalance }, 'tokens refunded')

      return {
        success: true,
        newBalance,
        transactionId: txResult[0]?.id,
      }
    } catch (err) {
      logger.error({ err, phone, action }, 'token refund failed')
      throw err
    }
  }

  async grant(phone: string, amount: number, adminId?: string, description?: string): Promise<TokenDeductionResult> {
    const db = getDb()
    const now = new Date().toISOString()

    try {
      const result = await db
        .update(users)
        .set({
          tokensRemaining: sql`${users.tokensRemaining} + ${amount}`,
          updatedAt: now,
        })
        .where(eq(users.phone, phone))
        .returning({ tokensRemaining: users.tokensRemaining })

      if (result.length === 0) {
        return { success: false, newBalance: 0, error: 'User not found' }
      }

      const newBalance = result[0].tokensRemaining

      await db.insert(tokenTransactions).values({
        id: crypto.randomUUID(),
        phone,
        type: 'grant',
        amount,
        balanceAfter: newBalance,
        description: description || 'Token grant',
        adminId: adminId || null,
        createdAt: now,
      })

      logger.info({ phone, amount, newBalance, adminId }, 'tokens granted')

      return { success: true, newBalance }
    } catch (err) {
      logger.error({ err, phone, amount }, 'token grant failed')
      throw err
    }
  }

  async executeWithDeduction<T>(
    action: TokenAction,
    phone: string,
    operation: () => Promise<T>,
    description?: string,
  ): Promise<{ success: boolean; result?: T; error?: string; refunded?: boolean }> {
    const estimate = await this.estimate(action, phone)
    if (!estimate.canAfford) {
      return { success: false, error: 'Insufficient tokens' }
    }

    const deduction = await this.deduct(action, phone, description)
    if (!deduction.success) {
      return { success: false, error: deduction.error }
    }

    try {
      const result = await operation()
      return { success: true, result }
    } catch (err) {
      const message = (err as Error).message
      logger.error({ err: message, phone, action }, 'operation failed, refunding tokens')

      const refund = await this.refund(action, phone, `Refund for failed: ${action}`)
      return {
        success: false,
        error: message,
        refunded: refund.success,
      }
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
