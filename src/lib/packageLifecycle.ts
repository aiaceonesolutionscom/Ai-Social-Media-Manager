import { getUser, getPackage, updateUser, createTokenTransaction } from '../store.js'
import { clearFeatureCache } from './packagePermissions.js'
import { auditLogger } from './AuditLogger.js'
import { logger } from './logger.js'
import { getDb } from '../db.js'
import { eq } from 'drizzle-orm'
import { users, tokenTransactions } from '../db/schema.js'
import { randomUUID } from 'node:crypto'
import type { User } from '../types.js'

export type PackageStatus = User['packageStatus']

export function getBillingPeriodMs(period: 'monthly' | 'yearly'): number {
  return period === 'yearly' ? 365 * 24 * 60 * 60 * 1000 : 31 * 24 * 60 * 60 * 1000
}

export function computeExpiry(period: 'monthly' | 'yearly', from: Date = new Date()): string {
  return new Date(from.getTime() + getBillingPeriodMs(period)).toISOString()
}

export function isPackageExpired(user: User): boolean {
  if (!user.packageId || !user.packageExpiresAt) return false
  if (user.packageStatus === 'expired' || user.packageStatus === 'ended') return true
  return new Date(user.packageExpiresAt) < new Date()
}

/**
 * Activates a package for a user. Replaces any prior package entitlement:
 * remaining tokens are set to the new package's included tokens.
 */
export async function activatePackage(phone: string, packageId: string, opts: { tokens?: number; actor?: string; description?: string } = {}): Promise<User> {
  const pkg = await getPackage(packageId)
  if (!pkg) throw new Error('Package not found')

  const tokens = opts.tokens ?? pkg.includedTokens
  const expiresAt = computeExpiry(pkg.billingPeriod || 'monthly')

  const now = new Date().toISOString()

  const updated = await getDb().transaction(async (tx) => {
    const result = await tx
      .update(users)
      .set({
        packageId: pkg.slug,
        packageStatus: 'active',
        packageStartedAt: now,
        packageExpiresAt: expiresAt,
        packageEndedAt: null,
        tokensRemaining: tokens,
        updatedAt: now,
      })
      .where(eq(users.phone, phone))
      .returning()

    if (result.length === 0) throw new Error(`User ${phone} not found`)

    await tx.insert(tokenTransactions).values({
      id: randomUUID(),
      phone,
      type: 'grant',
      amount: tokens,
      balanceAfter: tokens,
      description: opts.description || `Package activation — ${pkg.name}`,
      postId: null,
      adminId: opts.actor || null,
      operationId: null,
      createdAt: now,
    })

    return result[0]
  })

  clearFeatureCache(phone)

  auditLogger.log({
    actor: opts.actor || phone,
    actorType: opts.actor ? 'admin' : 'user',
    action: 'package.activate',
    target: phone,
    details: { package: pkg.slug, tokens, expiresAt },
  })

  logger.info({ phone, package: pkg.slug, tokens, expiresAt }, 'package activated')
  return updated as unknown as User
}

/**
 * Pauses an active package. Tokens and expiry are kept; the scheduler stops
 * running this user's queued jobs until the package is resumed.
 */
export async function pausePackage(phone: string, opts: { actor?: string; reason?: string } = {}): Promise<User> {
  const user = await getUser(phone)
  if (!user) throw new Error('User not found')
  if (user.packageStatus !== 'active') throw new Error('Only an active package can be paused')

  const updated = await updateUser(phone, { packageStatus: 'paused' })
  clearFeatureCache(phone)

  auditLogger.log({
    actor: opts.actor || phone,
    actorType: opts.actor ? 'admin' : 'user',
    action: 'package.pause',
    target: phone,
    details: { package: user.packageId, reason: opts.reason },
  })
  logger.info({ phone, package: user.packageId }, 'package paused')
  return updated
}

/**
 * Resumes a paused package back to active (unless it has since expired/ended).
 */
export async function resumePackage(phone: string, opts: { actor?: string } = {}): Promise<User> {
  const user = await getUser(phone)
  if (!user) throw new Error('User not found')
  if (user.packageStatus !== 'paused') throw new Error('Only a paused package can be resumed')
  if (isPackageExpired(user)) throw new Error('Package has expired and cannot be resumed')

  const updated = await updateUser(phone, { packageStatus: 'active' })
  clearFeatureCache(phone)

  auditLogger.log({
    actor: opts.actor || phone,
    actorType: opts.actor ? 'admin' : 'user',
    action: 'package.resume',
    target: phone,
    details: { package: user.packageId },
  })
  logger.info({ phone, package: user.packageId }, 'package resumed')
  return updated
}

/**
 * Ends a user's current package. Remaining tokens are forfeited.
 */
export async function endPackage(phone: string, opts: { actor?: string; reason?: string } = {}): Promise<User> {
  const user = await getUser(phone)
  if (!user) throw new Error('User not found')

  const forfeited = user.tokensRemaining

  const updated = await updateUser(phone, {
    packageStatus: 'ended',
    packageEndedAt: new Date().toISOString(),
    tokensRemaining: 0,
  })
  clearFeatureCache(phone)

  if (forfeited > 0) {
    await createTokenTransaction({
      phone,
      type: 'revoke',
      amount: forfeited,
      balanceAfter: 0,
      description: `Package ended — ${forfeited} tokens forfeited`,
    })
  }

  auditLogger.log({
    actor: opts.actor || phone,
    actorType: opts.actor ? 'admin' : 'user',
    action: 'package.end',
    target: phone,
    details: { package: user.packageId, forfeitedTokens: forfeited, reason: opts.reason },
  })

  logger.info({ phone, package: user.packageId, forfeited }, 'package ended by user')
  return updated
}

/**
 * Marks an expired package as expired and forfeits remaining tokens.
 */
export async function expirePackage(phone: string, opts: { actor?: string } = {}): Promise<User | null> {
  const user = await getUser(phone)
  if (!user || !user.packageId) return null
  if (user.packageStatus !== 'active') return null

  const forfeited = user.tokensRemaining

  const updated = await updateUser(phone, {
    packageStatus: 'expired',
    tokensRemaining: 0,
  })
  clearFeatureCache(phone)

  if (forfeited > 0) {
    await createTokenTransaction({
      phone,
      type: 'revoke',
      amount: forfeited,
      balanceAfter: 0,
      description: `Package expired — ${forfeited} tokens forfeited`,
    })
  }

  auditLogger.log({
    actor: opts.actor || 'scheduler',
    actorType: 'system',
    action: 'package.expire',
    target: phone,
    details: { package: user.packageId, forfeitedTokens: forfeited, expiredAt: user.packageExpiresAt },
  })

  logger.info({ phone, package: user.packageId, forfeited }, 'package expired')
  return updated
}
