import { config } from '../config.js'
import { fetchWithRetry } from './http.js'
import { logger } from './logger.js'
import { metaConfig } from './metaConfig.js'
import { getAccountByPlatform, updateSocialAccount } from '../store.js'
import { sendText } from './whatsapp.js'

interface TokenRefreshResult {
  ok: boolean
  message: string
  newExpiresAt?: string
}

async function exchangeTokenForLongLived(appId: string, appSecret: string, shortLivedToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const res = await fetchWithRetry(
      `https://graph.facebook.com/${metaConfig.getGraphApiVersion()}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`
    )
    const data = await res.json() as { access_token?: string; expires_in?: number }
    if (res.ok && data.access_token) {
      return { access_token: data.access_token, expires_in: data.expires_in || 5184000 }
    }
    logger.warn({ error: JSON.stringify(data) }, 'Token exchange failed')
    return null
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Token exchange error')
    return null
  }
}

async function refreshUserToken(phone: string, platform: 'instagram' | 'facebook' | 'meta_ads'): Promise<TokenRefreshResult> {
  const account = await getAccountByPlatform(phone, platform)
  if (!account) {
    return { ok: false, message: `No ${platform} account found for user` }
  }
  if (!account.refreshToken) {
    return { ok: false, message: `No refresh token stored for ${platform} account` }
  }

  const appId = metaConfig.getAppId()
  const appSecret = metaConfig.getAppSecret()
  if (!appId || !appSecret) {
    return { ok: false, message: 'Meta App ID or Secret not configured' }
  }

  const result = await exchangeTokenForLongLived(appId, appSecret, account.refreshToken)
  if (!result) {
    return { ok: false, message: 'Failed to exchange token' }
  }

  const newExpiresAt = new Date(Date.now() + result.expires_in * 1000).toISOString()

  await updateSocialAccount(account.id, {
    accessToken: result.access_token,
    refreshToken: result.access_token,
    tokenExpiresAt: newExpiresAt,
    status: 'active',
  })

  logger.info({ phone, platform, expiresAt: newExpiresAt }, 'Token refreshed successfully')
  return { ok: true, message: 'Token refreshed', newExpiresAt }
}

async function checkAndWarnExpiringTokens(): Promise<void> {
  const warningDays = metaConfig.getTokenRefreshWarningDays()
  const warningMs = warningDays * 24 * 60 * 60 * 1000
  const now = Date.now()
  const threshold = now + warningMs

  const { getDb } = await import('../db.js')
  const { socialAccounts } = await import('../db/schema.js')
  const { lt, eq, and, isNotNull } = await import('drizzle-orm')

  const expiringAccounts = await getDb().select().from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.status, 'active'),
        isNotNull(socialAccounts.tokenExpiresAt),
        lt(socialAccounts.tokenExpiresAt, new Date(threshold).toISOString())
      )
    )

  for (const account of expiringAccounts) {
    if (!account.tokenExpiresAt) continue
    const expiresAt = new Date(account.tokenExpiresAt).getTime()
    const daysLeft = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000))

    if (daysLeft <= warningDays && daysLeft > 0) {
      await sendText(account.phone, `⚠️ Your ${account.platform} connection will expire in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Please reconnect in Settings to continue posting.`).catch(() => {})
      logger.info({ phone: account.phone, platform: account.platform, daysLeft }, 'token expires soon — warned via WhatsApp')
    } else if (expiresAt <= now) {
      await getDb().update(socialAccounts).set({ status: 'expired' }).where(eq(socialAccounts.id, account.id))
      await sendText(account.phone, `❌ Your ${account.platform} connection has expired. Please reconnect in Settings to continue posting.`).catch(() => {})
      logger.info({ phone: account.phone, platform: account.platform }, 'token expired — status set to expired, warned via WhatsApp')
    }
  }
}

async function autoRefreshExpiringTokens(): Promise<void> {
  if (!metaConfig.getTokenAutoRefreshEnabled()) {
    return
  }

  const now = Date.now()
  const { getDb } = await import('../db.js')
  const { socialAccounts } = await import('../db/schema.js')
  const { lt, eq, and, isNotNull } = await import('drizzle-orm')

  const expiringAccounts = await getDb().select().from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.status, 'active'),
        eq(socialAccounts.platform, 'facebook'),
        isNotNull(socialAccounts.tokenExpiresAt),
        lt(socialAccounts.tokenExpiresAt, new Date(now + 24 * 60 * 60 * 1000).toISOString())
      )
    )

  for (const account of expiringAccounts) {
    if (account.refreshToken) {
      const result = await refreshUserToken(account.phone, 'facebook')
      if (!result.ok) {
        logger.warn({ phone: account.phone, error: result.message }, 'Auto token refresh failed')
      }
    }
  }

  const expiringIGAccounts = await getDb().select().from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.status, 'active'),
        eq(socialAccounts.platform, 'instagram'),
        isNotNull(socialAccounts.tokenExpiresAt),
        lt(socialAccounts.tokenExpiresAt, new Date(now + 24 * 60 * 60 * 1000).toISOString())
      )
    )

  for (const account of expiringIGAccounts) {
    if (account.refreshToken) {
      const result = await refreshUserToken(account.phone, 'instagram')
      if (!result.ok) {
        logger.warn({ phone: account.phone, error: result.message }, 'Auto token refresh failed')
      }
    }
  }

  const expiringAdsAccounts = await getDb().select().from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.status, 'active'),
        eq(socialAccounts.platform, 'meta_ads'),
        isNotNull(socialAccounts.tokenExpiresAt),
        lt(socialAccounts.tokenExpiresAt, new Date(now + 24 * 60 * 60 * 1000).toISOString())
      )
    )

  for (const account of expiringAdsAccounts) {
    if (account.refreshToken) {
      const result = await refreshUserToken(account.phone, 'meta_ads')
      if (!result.ok) {
        logger.warn({ phone: account.phone, error: result.message }, 'Auto token refresh failed')
      }
    }
  }
}

export async function runTokenRefreshJob(): Promise<void> {
  logger.info('Starting token refresh job')
  try {
    await checkAndWarnExpiringTokens()
    await autoRefreshExpiringTokens()
    logger.info('Token refresh job completed')
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Token refresh job failed')
  }
}

export async function startTokenRefreshScheduler(): Promise<void> {
  const intervalHours = metaConfig.getTokenRefreshIntervalHours()
  const intervalMs = intervalHours * 60 * 60 * 1000

  setInterval(async () => {
    await runTokenRefreshJob()
  }, intervalMs)

  logger.info({ intervalHours }, 'Token refresh scheduler started')
}

export { refreshUserToken, TokenRefreshResult }