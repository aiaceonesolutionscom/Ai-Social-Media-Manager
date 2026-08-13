import { getUser, getPackage, updateUser, createTokenTransaction } from '../store.js'
import { clearFeatureCache } from './packagePermissions.js'
import { auditLogger } from './AuditLogger.js'
import { logger } from './logger.js'
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

  const user = await updateUser(phone, {
    packageId: pkg.slug,
    packageStatus: 'active',
    packageStartedAt: new Date().toISOString(),
    packageExpiresAt: expiresAt,
    packageEndedAt: '',
    tokensRemaining: tokens,
  })
  clearFeatureCache(phone)

  await createTokenTransaction({
    phone,
    type: 'grant',
    amount: tokens,
    balanceAfter: tokens,
    description: opts.description || `Package activation — ${pkg.name}`,
    adminId: opts.actor,
  })

  auditLogger.log({
    actor: opts.actor || phone,
    actorType: opts.actor ? 'admin' : 'user',
    action: 'package.activate',
    target: phone,
    details: { package: pkg.slug, tokens, expiresAt },
  })

  logger.info({ phone, package: pkg.slug, tokens, expiresAt }, 'package activated')
  return user
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
