import { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { verifySession } from '../lib/userAuth.js'
import { connectAccount, getAccounts, disconnectAccount } from '../store.js'
import { logger } from '../lib/logger.js'
import { sendOtpTemplate, sendText } from '../lib/whatsapp.js'
import { sendWelcomeMessage } from '../lib/welcome.js'
import { generateOtp, storeOtp, verifyOtp, signState, verifyState } from '../lib/otp.js'
import { requireFeature } from '../lib/packagePermissions.js'
import { metaConfig } from '../lib/metaConfig.js'

function getOAuthClientId(): string {
  return metaConfig.getAppId() || config.oauth.facebook.clientId || '';
}

function getOAuthClientSecret(): string {
  return metaConfig.getAppSecret() || config.oauth.facebook.clientSecret || ''
}

function getOAuthCallbackUrl(): string {
  return metaConfig.getDefaultCallbackUri() || config.oauth.facebook.callbackUrl || `${config.publicBaseUrl}/api/social/connect/facebook/callback`;
}

async function requireUser(req: any): Promise<string | null> {
  const headerToken = req.headers['authorization']?.replace('Bearer ', '') || ''
  const queryToken = (req.query as { token?: string })?.token || ''
  const token = headerToken || queryToken
  if (!token) return null
  const session = await verifySession(token)
  return session?.phone || null
}

export async function registerSocialRoutes(server: FastifyInstance): Promise<void> {
  // List connected accounts
  server.get('/api/social/accounts', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    const accounts = await getAccounts(phone)
    return reply.send(accounts.map(a => ({
      id: a.id,
      platform: a.platform,
      accountId: a.accountId,
      accountName: a.accountName,
      status: a.status,
      connectedAt: a.connectedAt,
    })))
  })

  // Disconnect
  server.delete('/api/social/disconnect/:id', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    const { id } = req.params as { id: string }
    const accounts = await getAccounts(phone)
    const account = accounts.find(a => a.id === id)
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    await disconnectAccount(id)
    return reply.send({ success: true })
  })

  // ---- Facebook OAuth ----
  server.get('/api/social/connect/facebook', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      await requireFeature(phone, 'facebook_publishing')
    } catch (err: any) {
      return reply.status(403).send({ error: err.message })
    }

    if (!getOAuthClientId()) {
      if (config.dev.enabled) {
        logger.info({ phone }, 'DEV MODE: Facebook connect simulated (no FB app configured)')
        await connectAccount({
          phone,
          platform: 'facebook',
          accountId: 'dev_fb_page',
          accountName: 'Dev Test Page',
          accessToken: 'dev_token_fb',
        })
        return reply.redirect(`${config.frontendUrl}/connect?connected=dev`)
      }
      return reply.status(503).send({ error: 'Facebook OAuth not configured' })
    }

    const state = await signState(phone)
    const scopes = 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,pages_show_list,ads_management,ads_read'
    const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${getOAuthClientId()}&redirect_uri=${encodeURIComponent(getOAuthCallbackUrl())}&scope=${scopes}&state=${state}`
    return reply.redirect(url)
  })

  server.get('/api/social/connect/facebook/callback', async (req: any, reply: any) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string }
    if (error || !code) return reply.redirect(`${config.frontendUrl}/connect?error=oauth_failed`)

    const phone = await verifyState(state)
    if (!phone) return reply.redirect(`${config.frontendUrl}/connect?error=invalid_state`)

    try {
      // Exchange code for short-lived token
      const tokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?client_id=${getOAuthClientId()}&redirect_uri=${encodeURIComponent(getOAuthCallbackUrl())}&client_secret=${getOAuthClientSecret()}&code=${code}`)
      const tokenData = await tokenRes.json() as any
      if (!tokenData.access_token) throw new Error('Failed to get short-lived token')

      // Exchange for long-lived token
      const longTokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${getOAuthClientId()}&client_secret=${getOAuthClientSecret()}&fb_exchange_token=${tokenData.access_token}`)
      const longTokenData = await longTokenRes.json() as any
      const accessToken = longTokenData.access_token || tokenData.access_token

      // Get user's pages
      const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`)
      const pagesData = await pagesRes.json() as any

      if (pagesData.data && pagesData.data.length > 0) {
        for (const page of pagesData.data) {
          // Connect Facebook page
          await connectAccount({
            phone,
            platform: 'facebook',
            accountId: page.id,
            accountName: page.name,
            accessToken: page.access_token || accessToken,
          })

          // Try to get Instagram Business Account from this page
          try {
            const igRes = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token || accessToken}`)
            const igData = await igRes.json() as any
            if (igData.instagram_business_account) {
              await connectAccount({
                phone,
                platform: 'instagram',
                accountId: igData.instagram_business_account.id,
                accountName: `${page.name} (Instagram)`,
                accessToken: page.access_token || accessToken,
              })
            }
          } catch (igErr) {
            logger.warn({ error: (igErr as Error).message }, 'failed to get Instagram account from page')
          }
        }
      }

      // Connect the user's own Meta Ads account (if the granted token can see one).
      // Falls back to the platform-level META_ADS_ACCOUNT_ID at campaign time if not available.
      try {
        const adAccountsRes = await fetch(`https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_id,account_status&access_token=${accessToken}`)
        const adAccountsData = await adAccountsRes.json() as any
        const active = (adAccountsData.data || []).find((a: any) => a.account_status === 1)
        if (active) {
          await connectAccount({
            phone,
            platform: 'meta_ads',
            accountId: `act_${active.account_id}`,
            accountName: active.name || 'Meta Ads Account',
            accessToken,
          })
          logger.info({ phone, adAccount: active.account_id }, 'connected user Meta Ads account')
        }
      } catch (adErr) {
        logger.warn({ error: (adErr as Error).message }, 'failed to connect user Meta Ads account (non-blocking)')
      }

      return reply.redirect(`${config.frontendUrl}/connect?connected=facebook`)
    } catch (err: any) {
      logger.error({ error: err.message }, 'Facebook OAuth failed')
      return reply.redirect(`${config.frontendUrl}/connect?error=oauth_failed`)
    }
  })

  // ---- Instagram OAuth ----
  server.get('/api/social/connect/instagram', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      await requireFeature(phone, 'instagram_publishing')
    } catch (err: any) {
      return reply.status(403).send({ error: err.message })
    }

    if (!getOAuthClientId()) {
      if (config.dev.enabled) {
        logger.info({ phone }, 'DEV MODE: Instagram connect simulated (no FB app configured)')
        await connectAccount({
          phone,
          platform: 'instagram',
          accountId: 'dev_ig_account',
          accountName: 'Dev Test Instagram',
          accessToken: 'dev_token_ig',
        })
        return reply.redirect(`${config.frontendUrl}/connect?connected=dev`)
      }
      return reply.status(503).send({ error: 'Facebook OAuth not configured (required for Instagram)' })
    }

    // Instagram uses Facebook Login
    const state = await signState(phone)
    const scopes = 'instagram_basic,instagram_content_publish,pages_show_list,pages_manage_posts'
    const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${getOAuthClientId()}&redirect_uri=${encodeURIComponent(getOAuthCallbackUrl())}&scope=${scopes}&state=${state}`
    return reply.redirect(url)
  })

  // ---- WhatsApp OTP ----
  // Step 1: request a verification code sent to the given number via WhatsApp
  server.post('/api/social/connect/whatsapp/send-otp', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      await requireFeature(phone, 'whatsapp_broadcast')
    } catch (err: any) {
      return reply.status(403).send({ error: err.message })
    }

    const { phoneNumber } = req.body as { phoneNumber?: string }
    const normalizedNumber = phoneNumber?.trim() ?? ''
    if (!normalizedNumber || !/^\+?\d{7,15}$/.test(normalizedNumber)) {
      return reply.status(400).send({ error: 'A valid phone number (7-15 digits) is required' })
    }

    if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
      if (config.dev.enabled) {
        const code = generateOtp()
        await storeOtp(phone, normalizedNumber, code)
        logger.info({ phone, devCode: code }, 'DEV MODE: WhatsApp OTP simulated (no WhatsApp configured)')
        return reply.send({ success: true, message: 'Verification code generated (dev mode)', devCode: code })
      }
      return reply.status(503).send({ error: 'WhatsApp Cloud API is not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.' })
    }

    const code = generateOtp()
    await storeOtp(phone, normalizedNumber, code)

    try {
      try {
        await sendOtpTemplate(normalizedNumber, code)
      } catch (templateErr: any) {
        logger.warn({ phone, error: templateErr.message }, 'OTP template failed, falling back to free-form text (requires 24h session)')
        await sendText(normalizedNumber, `Your EchoPost verification code is: ${code}. It expires in 5 minutes.`)
      }
    } catch (err: any) {
      logger.error({ phone, error: err.message }, 'failed to send WhatsApp OTP')
      return reply.status(500).send({ error: `Failed to send verification code: ${err.message}` })
    }

    return reply.send({ success: true, message: 'Verification code sent to your WhatsApp number' })
  })

  // Step 2: verify the code and connect the account
  server.post('/api/social/connect/whatsapp', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      await requireFeature(phone, 'whatsapp_broadcast')
    } catch (err: any) {
      return reply.status(403).send({ error: err.message })
    }

    const { phoneNumber, verificationCode } = req.body as { phoneNumber?: string; verificationCode?: string }
    const normalizedNumber = phoneNumber?.trim() ?? ''

    if (!normalizedNumber) {
      return reply.status(400).send({ error: 'Phone number is required' })
    }
    if (!verificationCode || !/^\d{6}$/.test(verificationCode)) {
      return reply.status(400).send({ error: 'A 6-digit verification code is required' })
    }

    const result = await verifyOtp(phone, normalizedNumber, verificationCode)
    if (!result.valid) {
      return reply.status(400).send({ error: result.reason || 'Verification failed' })
    }

    await connectAccount({
      phone,
      platform: 'whatsapp',
      accountId: normalizedNumber,
      accountName: `WhatsApp (${normalizedNumber})`,
      accessToken: '',
    })

    // Greet the user on their verified number so they know the bot works from it.
    await sendWelcomeMessage(normalizedNumber)

    return reply.send({ success: true, message: 'WhatsApp connected' })
  })
}


