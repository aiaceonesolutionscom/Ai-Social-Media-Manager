import { config } from './config.js'
import { initStore, recoverStuckPosts, listPackages, getAllConfig, getUser, getPackage } from './store.js'
import { closeDb } from './db.js'
import { registerMediaRoute } from './routes/media.js'
import { handleWebhook, handleVerify } from './routes/webhook.js'
import { handleUserInput, handleVoiceInput } from './pipeline/conversation.js'
import { ensureReady } from './config.js'
import { verifyWebhookSignature } from './lib/whatsapp.js'
import { rateLimit } from './lib/ratelimit.js'
import { registerAdminAuthRoutes } from './routes/admin-api/auth.js'
import { registerAdminPackageRoutes } from './routes/admin-api/packages.js'
import { registerAdminUserRoutes } from './routes/admin-api/users.js'
import { registerAdminPaymentRoutes } from './routes/admin-api/payments.js'
import { registerAdminSettingsRoutes } from './routes/admin-api/settings.js'
import { registerAdminStatsRoutes } from './routes/admin-api/stats.js'
import { registerStripeRoutes } from './routes/stripe.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerSocialRoutes } from './routes/social.js'
import { registerCheckoutRoutes } from './routes/checkout.js'
import { verifySession } from './lib/userAuth.js'
import { adminAuthMiddleware } from './routes/admin-api/middleware.js'

async function main(): Promise<void> {
  await initStore()
  await recoverStuckPosts()
  // ensureReady() — commented out for dev mode without real API keys

  if (config.admin.email === 'admin@example.com' || config.admin.password === 'admin123') {
    console.warn(
      '⚠️  WARNING: Using default admin credentials (admin@example.com / admin123). ' +
      'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before going to production.',
    )
  }

  if (config.dev.enabled) {
    console.warn(
      '⚠️  DEV MODE is ON. External integrations (stripe, whatsapp, image, publish, connect, STT) ' +
      'are being MOCKED when their real key is missing. NEVER deploy with DEV_MODE=true.',
    )
  }

  const server = await import('fastify').then((m) => m.default({ logger: true, bodyLimit: 10 * 1024 * 1024 }))

  // Capture the raw body so we can verify the WhatsApp signature.
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (req: any, body: string, done: any) => {
    try {
      req.rawBody = body
      done(null, body ? JSON.parse(body) : {})
    } catch (err: any) {
      err.statusCode = 400
      done(err)
    }
  })

  server.get(config.webhookPath, async (req: any, reply: any) => {
    const result = await handleVerify(req)
    return reply.status(result.status).send(result.body)
  })

  server.post(config.webhookPath, async (req: any, reply: any) => {
    if (!config.whatsapp.appSecret) {
      if (config.dev.enabled) {
        console.warn('⚠️  DEV MODE: WhatsApp webhook signature verification is SKIPPED (no WHATSAPP_APP_SECRET). Never deploy with DEV_MODE=true.')
      } else {
        return reply.status(500).send({ error: 'WHATSAPP_APP_SECRET is not configured. Webhook verification is mandatory.' })
      }
    }
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {})
    const signature = (req.headers['x-hub-signature-256'] as string) || undefined
    if (config.whatsapp.appSecret && !verifyWebhookSignature(rawBody, signature)) {
      return reply.status(401).send({ error: 'Invalid signature' })
    }

    const msgFrom = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
    if (msgFrom) {
      const { allowed, remaining } = rateLimit(msgFrom)
      if (!allowed) {
        return reply.status(429).send({ error: 'Too many requests. Please try again later.' })
      }
    }

    const result = await handleWebhook(req.body)
    return reply.status(result.status).send(result.body)
  })

  registerMediaRoute(server)

  // Public API: list active packages
  server.get('/api/packages', async (_req: any, reply: any) => {
    const pkgs = await listPackages()
    return reply.send(pkgs)
  })

  // Public API: integration / dev-mode status (drives frontend test-mode UI)
  server.get('/api/meta', async (_req: any, reply: any) => {
    const integrations = {
      stripe: !!config.stripe.secretKey,
      whatsapp: !!(config.whatsapp.token && config.whatsapp.phoneNumberId),
      facebook: !!(config.oauth.facebook.clientId),
      instagram: !!(config.instagram.accessToken && config.instagram.igUserId),
      groq: !!config.stt.apiKey,
      llm: !!config.llm.apiKey,
      openai: !!config.image.openaiKey,
      clerk: !!config.clerk.secretKey,
    }
    return reply.send({ devMode: config.dev.enabled, integrations })
  })

  // Dev-only: simulate a WhatsApp message to drive the whole conversation via curl
  if (config.dev.enabled) {
    server.post('/api/dev/message', async (req: any, reply: any) => {
      const { phone, text, voice } = req.body as { phone?: string; text?: string; voice?: boolean }
      if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
        return reply.status(400).send({ error: 'phone is required' })
      }
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return reply.status(400).send({ error: 'text is required' })
      }
      console.log(`[DEV] ${phone} → ${voice ? 'voice' : 'text'}: ${text}`)
      if (voice) {
        await handleVoiceInput(phone, text, { waMsgId: `dev_${Date.now()}` })
      } else {
        await handleUserInput(phone, text, { waMsgId: `dev_${Date.now()}` })
      }
      return reply.send({ ok: true })
    })
  }

  // Public API: token costs (for "How tokens are spent" section)
  server.get('/api/token-costs', async (_req: any, reply: any) => {
    const cfg = await getAllConfig()
    return reply.send({
      standardPost: Number(cfg.cost_standard_post) || 1,
      crossPlatform: Number(cfg.cost_cross_platform) || 2,
      imageRegenerate: Number(cfg.cost_image_regenerate) || 1,
      adCampaign: Number(cfg.cost_ad_campaign) || 5,
      voiceTranscription: cfg.cost_voice_transcription || 'Free',
      captionEditing: cfg.cost_caption_editing || 'Free',
    })
  })

  // User API: get current user's package features (for Connect page filtering)
  server.get('/api/user/package', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'No token provided' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid or expired session' })

    const user = await getUser(session.phone)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    if (!user.packageId) {
      return reply.send({ features: {} })
    }

    const pkg = await getPackage(user.packageId)
    return reply.send({ features: pkg?.features || {} })
  })

  server.addHook('preHandler', adminAuthMiddleware)

  registerAdminAuthRoutes(server)
  registerAdminPackageRoutes(server)
  registerAdminUserRoutes(server)
  registerAdminPaymentRoutes(server)
  registerAdminSettingsRoutes(server)
  registerAdminStatsRoutes(server)
  registerStripeRoutes(server)
  registerAuthRoutes(server)
  registerSocialRoutes(server)
  registerCheckoutRoutes(server)

  server.get('/', async () => {
    return { status: 'ok', message: 'AI Instagram Agent is running' }
  })

  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`Server running on http://localhost:${config.port}`)

  const shutdown = async (signal: string) => {
    console.log(`${signal} received. Shutting down gracefully...`)
    try {
      await server.close()
      await closeDb()
    } catch (err) {
      console.error('Error during shutdown:', err)
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})