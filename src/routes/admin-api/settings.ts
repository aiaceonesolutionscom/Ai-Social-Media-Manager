import { FastifyInstance } from 'fastify'
import { getAllConfig, setConfig } from '../../store.js'
import { fetchWithRetry } from '../../lib/http.js'
import { guard } from './middleware.js'

const ALLOWED_SETTING_KEYS = new Set<string>([
  'instagram_token',
  'instagram_user_id',
  'facebook_app_id',
  'facebook_app_secret',
  'facebook_page_id',
  'whatsapp_token',
  'whatsapp_phone_id',
  'openai_key',
  'groq_key',
  'llm_model',
  'stripe_secret',
  'stripe_webhook_url',
  'cost_standard_post',
  'cost_cross_platform',
  'cost_image_regenerate',
  'cost_ad_campaign',
  'cost_voice_transcription',
  'cost_caption_editing',
  'payment_method_stripe',
  'payment_method_local',
  'payment_local_auto',
  'payment_local_pkr_rate',
  'payment_local_details',
  'checkout_tax_percent',
  'checkout_mdr_percent',
  'gateway_enabled',
  'gateway_sandbox',
  'gateway_api_base',
  'gateway_api_key',
  'gateway_webhook_secret',
])

export async function registerAdminSettingsRoutes(server: FastifyInstance): Promise<void> {

  server.get('/api/admin/settings', guard('settings.view'), async (req: any, reply: any) => {
    const config = await getAllConfig()
    const safeConfig: Record<string, string> = {}
    for (const [key, value] of Object.entries(config)) {
      if (key === 'admin_sessions' || key.startsWith('wa_otp') || key.includes('secret') || key.includes('password') || key.includes('token')) {
        safeConfig[key] = value ? '••••••••' : ''
      } else {
        safeConfig[key] = value
      }
    }
    return reply.send({ settings: safeConfig })
  })

  server.put('/api/admin/settings', guard('settings.update'), async (req: any, reply: any) => {
    const settings = req.body as Record<string, string | number>

    if (!settings || typeof settings !== 'object') {
      return reply.status(400).send({ error: 'Invalid settings payload' })
    }

    let updated = 0
    for (const [key, value] of Object.entries(settings)) {
      if (!ALLOWED_SETTING_KEYS.has(key)) {
        return reply.status(400).send({ error: `Setting "${key}" is not allowed` })
      }
      await setConfig(key, String(value))
      updated++
    }

    return reply.send({ success: true, updated })
  })

  server.get('/api/admin/settings/api-keys', guard('settings.view'), async (req: any, reply: any) => {
    const config = await getAllConfig()
    return reply.send({
      whatsapp: {
        connected: !!(config.whatsapp_token || process.env.WHATSAPP_TOKEN),
      },
      instagram: {
        connected: !!(config.instagram_token || process.env.INSTAGRAM_ACCESS_TOKEN),
      },
      facebook: {
        connected: !!(config.facebook_app_id && config.facebook_page_id || process.env.FACEBOOK_ACCESS_TOKEN),
      },
      openai: {
        connected: !!(config.openai_key || process.env.OPENAI_API_KEY),
      },
      groq: {
        connected: !!(config.groq_key || process.env.GROQ_API_KEY),
      },
      stripe: {
        connected: !!(config.stripe_secret || process.env.STRIPE_SECRET_KEY),
      },
    })
  })

  // ---- Test Connection Endpoints ----

  server.post('/api/admin/settings/test/:integration', guard('settings.update'), async (req: any, reply: any) => {
    const { integration } = req.params as { integration: string }
    const config = await getAllConfig()
    const start = Date.now()

    try {
      switch (integration) {
        case 'instagram': {
          const token = config.instagram_token || process.env.INSTAGRAM_ACCESS_TOKEN
          const userId = config.instagram_user_id || process.env.INSTAGRAM_IG_USER_ID
          if (!token || !userId) {
            return reply.send({ ok: false, message: 'Missing Instagram access token or user ID', latencyMs: 0 })
          }
          const res = await fetchWithRetry(`https://graph.facebook.com/v21.0/${userId}?access_token=${token}&fields=id,username`)
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
            return reply.send({ ok: false, message: `Instagram API error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start })
          }
          const data = (await res.json()) as { username?: string; id?: string }
          return reply.send({ ok: true, message: `Connected as @${data.username || userId}`, latencyMs: Date.now() - start })
        }

        case 'facebook': {
          const appId = config.facebook_app_id || process.env.FACEBOOK_APP_ID
          const appSecret = config.facebook_app_secret || process.env.FACEBOOK_APP_SECRET
          const pageId = config.facebook_page_id || process.env.FACEBOOK_PAGE_ID
          if (!appId || !pageId) {
            return reply.send({ ok: false, message: 'Missing Facebook app ID or page ID', latencyMs: 0 })
          }
          const token = `${appId}|${appSecret}`
          const res = await fetchWithRetry(`https://graph.facebook.com/v21.0/${pageId}?access_token=${token}&fields=id,name`)
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
            return reply.send({ ok: false, message: `Facebook API error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start })
          }
          const data = (await res.json()) as { name?: string; id?: string }
          return reply.send({ ok: true, message: `Connected to page: ${data.name || pageId}`, latencyMs: Date.now() - start })
        }

        case 'whatsapp': {
          const token = config.whatsapp_token || process.env.WHATSAPP_TOKEN
          const phoneId = config.whatsapp_phone_id || process.env.WHATSAPP_PHONE_NUMBER_ID
          if (!token || !phoneId) {
            return reply.send({ ok: false, message: 'Missing WhatsApp access token or phone number ID', latencyMs: 0 })
          }
          const res = await fetchWithRetry(`https://graph.facebook.com/v21.0/${phoneId}?access_token=${token}`)
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
            return reply.send({ ok: false, message: `WhatsApp API error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start })
          }
          return reply.send({ ok: true, message: 'WhatsApp connection successful', latencyMs: Date.now() - start })
        }

        case 'stripe': {
          const secret = config.stripe_secret || process.env.STRIPE_SECRET_KEY
          if (!secret) {
            return reply.send({ ok: false, message: 'Missing Stripe secret key', latencyMs: 0 })
          }
          const res = await fetchWithRetry('https://api.stripe.com/v1/balance', {
            headers: { Authorization: `Bearer ${secret}` },
          })
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
            return reply.send({ ok: false, message: `Stripe error: ${body.error?.message || res.statusText}`, latencyMs: Date.now() - start })
          }
          return reply.send({ ok: true, message: 'Stripe connection successful', latencyMs: Date.now() - start })
        }

        default:
          return reply.status(400).send({ error: `Unknown integration: ${integration}` })
      }
    } catch (err) {
      return reply.send({ ok: false, message: `Connection failed: ${(err as Error).message}`, latencyMs: Date.now() - start })
    }
  })
}
