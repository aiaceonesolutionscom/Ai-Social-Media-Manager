import { logger } from './logger.js'
import {
  getUser,
  createTokenTransaction,
  getTransactions,
} from '../store.js'
import { getDb } from '../db.js'
import { sql, eq } from 'drizzle-orm'
import { users, tokenTransactions } from '../db/schema.js'
import type { TokenAction } from '../types.js'

export async function getTokenCost(action: TokenAction): Promise<number> {
  const { getConfiguredCost } = await import('./TokenEngine.js')
  return getConfiguredCost(action)
}

export async function getBalance(phone: string): Promise<number> {
  const user = await getUser(phone)
  if (!user) return 0
  return user.tokensRemaining
}

export async function deductTokens(
  phone: string,
  amount: number,
  postId: string,
  description: string
): Promise<boolean> {
  if (amount <= 0) return true
  const db = getDb()
  const now = new Date().toISOString()

  try {
    return await db.transaction(async (tx) => {
      const result = await tx
        .update(users)
        .set({
          tokensRemaining: sql`${users.tokensRemaining} - ${amount}`,
          tokensUsed: sql`${users.tokensUsed} + ${amount}`,
          updatedAt: now,
        })
        .where(sql`${users.phone} = ${phone} AND ${users.tokensRemaining} >= ${amount}`)
        .returning({ tokensRemaining: users.tokensRemaining })

      if (result.length === 0) {
        logger.warn({ phone, requested: amount }, 'insufficient tokens')
        return false
      }

      const newBalance = result[0].tokensRemaining

      await tx.insert(tokenTransactions).values({
        id: crypto.randomUUID(),
        phone,
        type: 'deduct',
        amount,
        balanceAfter: newBalance,
        description,
        postId,
        createdAt: now,
      })

      logger.info({ phone, amount, balance: newBalance }, 'tokens deducted')
      return true
    })
  } catch (err) {
    logger.error({ err, phone, amount }, 'token deduction failed')
    throw err
  }
}

export async function grantTokens(
  phone: string,
  amount: number,
  adminId: string,
  description: string,
  operationId?: string,
): Promise<boolean> {
  if (amount <= 0) return true
  const { tokenEngine } = await import('./TokenEngine.js')
  const result = await tokenEngine.grant(phone, amount, adminId, description, operationId)
  return result.success
}

export async function refundTokens(
  phone: string,
  amount: number,
  postId: string,
  description: string,
  operationId?: string,
): Promise<boolean> {
  if (amount <= 0) return true
  const db = getDb()
  const now = new Date().toISOString()

  try {
    return await db.transaction(async (tx) => {
      const { claimed, id: claimId } = await (async () => {
        const inserted = await tx
          .insert(tokenTransactions)
          .values({
            id: crypto.randomUUID(),
            phone,
            type: 'refund',
            amount,
            balanceAfter: 0,
            description,
            postId,
            operationId: operationId ?? null,
            createdAt: now,
          })
          .onConflictDoNothing({ target: tokenTransactions.operationId })
          .returning({ id: tokenTransactions.id })
        return { claimed: inserted.length > 0, id: inserted[0]?.id ?? null }
      })()

      if (!claimed) {
        logger.info({ phone, amount, operationId }, 'refund already processed, skipping')
        return true
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
        logger.warn({ phone }, 'cannot refund: user not found')
        return false
      }

      const newBalance = result[0].tokensRemaining

      if (claimId) {
        await tx
          .update(tokenTransactions)
          .set({ balanceAfter: newBalance })
          .where(eq(tokenTransactions.id, claimId))
      }

      logger.info({ phone, amount, balance: newBalance }, 'tokens refunded')
      return true
    })
  } catch (err) {
    logger.error({ err, phone, amount }, 'token refund failed')
    throw err
  }
}

export async function getTransactionHistory(phone: string, limit = 50) {
  return getTransactions(phone, limit)
}

export async function getTokenWarnings(phone: string): Promise<string[]> {
  const balance = await getBalance(phone)
  const user = await getUser(phone)
  if (!user) return []

  const warnings: string[] = []
  const totalTokens = user.tokensRemaining + user.tokensUsed
  if (totalTokens === 0) return []

  const percentage = (balance / totalTokens) * 100

  if (balance === 0) {
    warnings.push('🚫 No tokens remaining. Please upgrade your plan or buy more tokens.')
  } else if (percentage <= 10) {
    warnings.push(`⚠️ Very low balance! Only ${balance} tokens left.`)
  } else if (percentage <= 20) {
    warnings.push(`⚠️ Running low on tokens. ${balance} tokens remaining.`)
  }

  return warnings
}

export async function formatBalance(phone: string): Promise<string> {
  const balance = await getBalance(phone)
  const user = await getUser(phone)
  if (!user) return '🪙 Balance: 0 tokens'

  const totalTokens = user.tokensRemaining + user.tokensUsed
  return `🪙 Balance: ${balance}/${totalTokens} tokens`
}

export async function hasEnoughTokens(balance: number, action: TokenAction): Promise<boolean> {
  const cost = await getTokenCost(action)
  return balance >= cost
}
