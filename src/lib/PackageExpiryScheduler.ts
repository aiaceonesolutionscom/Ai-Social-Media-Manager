import { getDb } from '../db.js'
import { users } from '../db/schema.js'
import { and, eq, lt } from 'drizzle-orm'
import { expirePackage } from './packageLifecycle.js'
import { logger } from './logger.js'

const EXPIRY_INTERVAL_MS = 60_000
let interval: NodeJS.Timeout | null = null

/**
 * Periodically marks packages whose billing period has ended as expired.
 * Once expired the user's features are locked until they renew.
 */
async function runExpiryCheck(): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()

  const expiredUsers = await db
    .select({ phone: users.phone })
    .from(users)
    .where(and(eq(users.packageStatus, 'active'), lt(users.packageExpiresAt, now)))

  for (const { phone } of expiredUsers) {
    try {
      await expirePackage(phone)
    } catch (err) {
      logger.error({ phone, error: (err as Error).message }, 'failed to expire package')
    }
  }
}

export function startPackageExpiryScheduler(): void {
  if (interval) return
  interval = setInterval(async () => {
    try {
      await runExpiryCheck()
    } catch (err) {
      logger.error({ err }, 'package expiry scheduler tick failed')
    }
  }, EXPIRY_INTERVAL_MS)
  logger.info('package expiry scheduler started')
}

export function stopPackageExpiryScheduler(): void {
  if (interval) {
    clearInterval(interval)
    interval = null
  }
}
