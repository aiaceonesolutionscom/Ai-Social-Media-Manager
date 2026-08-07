import { FastifyInstance } from 'fastify'
import { getAllConfig, setConfig } from '../../store.js'

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
])

export async function registerAdminSettingsRoutes(server: FastifyInstance): Promise<void> {

  server.get('/api/admin/settings', async (req: any, reply: any) => {
    const config = await getAllConfig()
    const safeConfig: Record<string, string> = {}
    for (const [key, value] of Object.entries(config)) {
      if (key.includes('secret') || key.includes('password') || key.includes('token')) {
        safeConfig[key] = value ? '••••••••' : ''
      } else {
        safeConfig[key] = value
      }
    }
    return reply.send({ settings: safeConfig })
  })

  server.put('/api/admin/settings', async (req: any, reply: any) => {
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

  server.get('/api/admin/settings/api-keys', async (req: any, reply: any) => {
    const config = await getAllConfig()
    return reply.send({
      whatsapp: {
        connected: !!(config.whatsapp_token || process.env.WHATSAPP_TOKEN),
      },
      instagram: {
        connected: !!(config.instagram_token || process.env.INSTAGRAM_ACCESS_TOKEN),
      },
      facebook: {
        connected: !!(config.facebook_token || process.env.FACEBOOK_ACCESS_TOKEN),
      },
      openai: {
        connected: !!(config.openai_key || process.env.OPENAI_API_KEY),
      },
      groq: {
        connected: !!(config.groq_key || process.env.GROQ_API_KEY),
      },
      stripe: {
        connected: !!(config.stripe_key || process.env.STRIPE_SECRET_KEY),
      },
    })
  })
}
