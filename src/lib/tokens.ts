import { config } from '../config.js'
import { logger } from './logger.js'
import {
  getUser,
  getConfig,
  createTokenTransaction,
  getTransactions,
} from '../store.js'
import { getPool } from '../db.js'
import type { TokenAction } from '../types.js'

const DB_KEY_MAP: Record<TokenAction, string> = {
  standard_post: 'cost_standard_post',
  cross_platform: 'cost_cross_platform',
  image_regenerate: 'cost_image_regenerate',
  ad_campaign: 'cost_ad_campaign',
}

export async function getTokenCost(action: TokenAction): Promise<number> {
  const dbKey = DB_KEY_MAP[action]
  const val = await getConfig(dbKey)
  if (val !== undefined) {
    if (val.toLowerCase() === 'free' || val === '') return 0
    const n = Number(val)
    return isNaN(n) ? 0 : n
  }
  const fallback: Record<TokenAction, number> = {
    standard_post: config.tokenCosts.standardPost,
    cross_platform: config.tokenCosts.crossPlatform,
    image_regenerate: config.tokenCosts.imageRegenerate,
    ad_campaign: config.tokenCosts.adCampaign,
  }
  return fallback[action] || 0
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
  const pool = getPool()
  const now = new Date().toISOString()

  // Atomic read-modify-write: only succeeds if the user has enough tokens
  const result = await pool.query(
    `UPDATE users
     SET tokens_remaining = tokens_remaining - $1,
         tokens_used = tokens_used + $1,
         updated_at = $2
     WHERE phone = $3 AND tokens_remaining >= $1
     RETURNING tokens_remaining`,
    [amount, now, phone],
  )

  if (result.rowCount === 0) {
    logger.warn({ phone, requested: amount }, 'insufficient tokens')
    return false
  }

  const newBalance = result.rows[0].tokens_remaining as number
  await createTokenTransaction({
    phone,
    type: 'deduct',
    amount,
    balanceAfter: newBalance,
    description,
    postId,
  })

  logger.info({ phone, amount, balance: newBalance }, 'tokens deducted')
  return true
}

export async function grantTokens(
  phone: string,
  amount: number,
  adminId: string,
  description: string
): Promise<boolean> {
  if (amount <= 0) return true
  const pool = getPool()
  const now = new Date().toISOString()

  const result = await pool.query(
    `UPDATE users
     SET tokens_remaining = tokens_remaining + $1,
         updated_at = $2
     WHERE phone = $3
     RETURNING tokens_remaining`,
    [amount, now, phone],
  )

  if (result.rowCount === 0) {
    logger.warn({ phone }, 'cannot grant: user not found')
    return false
  }

  const newBalance = result.rows[0].tokens_remaining as number
  await createTokenTransaction({
    phone,
    type: 'grant',
    amount,
    balanceAfter: newBalance,
    description,
    adminId,
  })

  logger.info({ phone, amount, balance: newBalance }, 'tokens granted')
  return true
}

export async function refundTokens(
  phone: string,
  amount: number,
  postId: string,
  description: string
): Promise<boolean> {
  if (amount <= 0) return true
  const pool = getPool()
  const now = new Date().toISOString()

  const result = await pool.query(
    `UPDATE users
     SET tokens_remaining = tokens_remaining + $1,
         updated_at = $2
     WHERE phone = $3
     RETURNING tokens_remaining`,
    [amount, now, phone],
  )

  if (result.rowCount === 0) {
    logger.warn({ phone }, 'cannot refund: user not found')
    return false
  }

  const newBalance = result.rows[0].tokens_remaining as number
  await createTokenTransaction({
    phone,
    type: 'refund',
    amount,
    balanceAfter: newBalance,
    description,
    postId,
  })

  logger.info({ phone, amount, balance: newBalance }, 'tokens refunded')
  return true
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
