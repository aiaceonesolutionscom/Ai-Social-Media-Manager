import { FastifyInstance } from 'fastify'
import { getMetaConfig, setMetaConfig, getAllMetaConfig, deleteMetaConfig } from '../../store.js'
import { metaConfig } from '../../lib/metaConfig.js'
import { fetchWithRetry } from '../../lib/http.js'
import { guard } from './middleware.js'

export async function registerAdminMetaSettingsRoutes(server: FastifyInstance): Promise<void> {

  // ---- Get all Meta config (grouped by category) ----

  server.get('/api/admin/meta-settings', guard('meta.view'), async (_req: any, reply: any) => {
    try {
      const config = await getAllMetaConfig()

      // Mask sensitive values
      const safe: Record<string, Record<string, { value: string; masked: boolean; updatedAt?: string }>> = {}
      for (const [category, entries] of Object.entries(config)) {
        safe[category] = {}
        for (const [key, value] of Object.entries(entries)) {
          const isSensitive = category === 'general' && (key === 'app_secret')
            || category === 'webhook' && (key === 'verify_token' || key === 'webhook_secret')
            || category === 'whatsapp' && key === 'access_token'
            || category === 'oauth' && (key === 'client_secret')

          safe[category][key] = {
            value: isSensitive && value ? `${value.slice(0, 8)}••••••••` : value,
            masked: isSensitive,
          }
        }
      }

      return reply.send({
        config: safe,
        status: metaConfig.getStatus(),
      })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  // ---- Get config by category ----

  server.get('/api/admin/meta-settings/:category', guard('meta.view'), async (req: any, reply: any) => {
    const { category } = req.params as { category: string }
    try {
      const config = await getMetaConfig(category)
      const safe = config.map((entry) => ({
        ...entry,
        value: entry.isSensitive && entry.value ? `${entry.value.slice(0, 8)}••••••••` : entry.value,
      }))
      return reply.send({ category, entries: safe })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  // ---- Update Meta config ----

  server.put('/api/admin/meta-settings', guard('meta.update'), async (req: any, reply: any) => {
    const { category, key, value, isSensitive } = req.body as {
      category: string
      key: string
      value: string
      isSensitive?: boolean
    }

    if (!category || !key) {
      return reply.status(400).send({ error: 'category and key are required' })
    }

    try {
      await setMetaConfig(category, key, value, isSensitive || false)
      await metaConfig.reload()
      return reply.send({ success: true, category, key })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  // ---- Delete config entry ----

  server.delete('/api/admin/meta-settings/:category/:key', guard('meta.update'), async (req: any, reply: any) => {
    const { category, key } = req.params as { category: string; key: string }
    try {
      await deleteMetaConfig(decodeURIComponent(category), decodeURIComponent(key))
      await metaConfig.reload()
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  // ---- Test all Meta connections ----

  server.post('/api/admin/meta-settings/test', guard('meta.update'), async (_req: any, reply: any) => {
    const results: Record<string, { ok: boolean; message: string; latencyMs: number }> = {}
    const start = Date.now()

    // Test App ID + Secret
    const appId = metaConfig.getAppId()
    const appSecret = metaConfig.getAppSecret()
    if (!appId || !appSecret) {
      results.app = { ok: false, message: 'Meta App ID or Secret not configured', latencyMs: 0 }
    } else {
      try {
        const res = await fetchWithRetry(
          `https://graph.facebook.com/${metaConfig.getGraphApiVersion()}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`
        )
        if (res.ok) {
          results.app = { ok: true, message: 'Meta App credentials valid', latencyMs: Date.now() - start }
        } else {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          results.app = { ok: false, message: `App error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start }
        }
      } catch (err) {
        results.app = { ok: false, message: `App test failed: ${(err as Error).message}`, latencyMs: Date.now() - start }
      }
    }

    // Test WhatsApp
    const waToken = metaConfig.getWhatsAppToken()
    const waPhoneId = metaConfig.getWhatsAppPhoneId()
    if (!waToken || !waPhoneId) {
      results.whatsapp = { ok: false, message: 'WhatsApp token or phone ID not configured', latencyMs: 0 }
    } else {
      try {
        const res = await fetchWithRetry(
          `https://graph.facebook.com/${metaConfig.getGraphApiVersion()}/${waPhoneId}?access_token=${waToken}`
        )
        if (res.ok) {
          results.whatsapp = { ok: true, message: 'WhatsApp connection successful', latencyMs: Date.now() - start }
        } else {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          results.whatsapp = { ok: false, message: `WhatsApp error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start }
        }
      } catch (err) {
        results.whatsapp = { ok: false, message: `WhatsApp test failed: ${(err as Error).message}`, latencyMs: Date.now() - start }
      }
    }

    // Test Facebook (if app is configured)
    if (appId && appSecret) {
      try {
        const res = await fetchWithRetry(
          `https://graph.facebook.com/${metaConfig.getGraphApiVersion()}/me?access_token=${appId}|${appSecret}`
        )
        if (res.ok) {
          results.facebook = { ok: true, message: 'Facebook Graph API accessible', latencyMs: Date.now() - start }
        } else {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          results.facebook = { ok: false, message: `Facebook error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start }
        }
      } catch (err) {
        results.facebook = { ok: false, message: `Facebook test failed: ${(err as Error).message}`, latencyMs: Date.now() - start }
      }
    } else {
      results.facebook = { ok: false, message: 'App not configured', latencyMs: 0 }
    }

    // Test Instagram (requires user token, but we can check API version)
    results.instagram = { ok: true, message: `API version ${metaConfig.getInstagramApiVersion()} configured`, latencyMs: 0 }

    // Test Meta Ads (requires token)
    results.meta_ads = { ok: true, message: `API version ${metaConfig.getMetaAdsApiVersion()} configured`, latencyMs: 0 }

    return reply.send({ results })
  })

  // ---- Test specific integration ----

  server.post('/api/admin/meta-settings/test/:integration', guard('meta.update'), async (req: any, reply: any) => {
    const { integration } = req.params as { integration: string }
    const start = Date.now()

    try {
      switch (integration) {
        case 'app': {
          const appId = metaConfig.getAppId()
          const appSecret = metaConfig.getAppSecret()
          if (!appId || !appSecret) {
            return reply.send({ ok: false, message: 'Meta App ID or Secret not configured', latencyMs: 0 })
          }
          const res = await fetchWithRetry(
            `https://graph.facebook.com/${metaConfig.getGraphApiVersion()}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`
          )
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
            return reply.send({ ok: false, message: `Error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start })
          }
          const data = (await res.json()) as { access_token?: string }
          return reply.send({ ok: true, message: `App valid. Token type: ${data.access_token ? 'received' : 'unknown'}`, latencyMs: Date.now() - start })
        }

        case 'whatsapp': {
          const token = metaConfig.getWhatsAppToken()
          const phoneId = metaConfig.getWhatsAppPhoneId()
          if (!token || !phoneId) {
            return reply.send({ ok: false, message: 'WhatsApp token or phone ID not configured', latencyMs: 0 })
          }
          const res = await fetchWithRetry(
            `https://graph.facebook.com/${metaConfig.getGraphApiVersion()}/${phoneId}?access_token=${token}`
          )
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
            return reply.send({ ok: false, message: `Error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start })
          }
          return reply.send({ ok: true, message: 'WhatsApp connection successful', latencyMs: Date.now() - start })
        }

        case 'facebook': {
          const appId = metaConfig.getAppId()
          const appSecret = metaConfig.getAppSecret()
          if (!appId || !appSecret) {
            return reply.send({ ok: false, message: 'App ID or Secret not configured', latencyMs: 0 })
          }
          const res = await fetchWithRetry(
            `https://graph.facebook.com/${metaConfig.getGraphApiVersion()}/me?access_token=${appId}|${appSecret}`
          )
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
            return reply.send({ ok: false, message: `Error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start })
          }
          return reply.send({ ok: true, message: 'Facebook Graph API accessible', latencyMs: Date.now() - start })
        }

        case 'webhook': {
          const verifyToken = metaConfig.getVerifyToken()
          const webhookSecret = metaConfig.getWebhookSecret()
          if (!verifyToken || !webhookSecret) {
            return reply.send({ ok: false, message: 'Webhook verify token or secret not configured', latencyMs: 0 })
          }
          return reply.send({ ok: true, message: `Webhook configured (verify token: ${verifyToken.slice(0, 4)}...)`, latencyMs: Date.now() - start })
        }

        case 'oauth': {
          const redirectUri = metaConfig.getOAuthRedirectUri()
          const callbackUri = metaConfig.getDefaultCallbackUri()
          if (!redirectUri) {
            return reply.send({ ok: false, message: 'OAuth redirect URI not configured', latencyMs: 0 })
          }
          return reply.send({ ok: true, message: `OAuth configured. Callback: ${callbackUri || 'default'}`, latencyMs: Date.now() - start })
        }

        default:
          return reply.status(400).send({ error: `Unknown integration: ${integration}` })
      }
    } catch (err) {
      return reply.send({ ok: false, message: `Test failed: ${(err as Error).message}`, latencyMs: Date.now() - start })
    }
  })
}
