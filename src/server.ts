import { config, clerkKeyMismatchWarning } from './config.js'
import { initStore, recoverStuckPosts, recoverStuckScheduledPosts, recoverStuckPayments, listPackages, getAllConfig, getUser, getPackage, createPost, setStage, autoResolveErrorLogs, listAdCampaignsByPhone, getAdCampaignByPhone, cancelAdCampaign, updateAdCampaign, createAdCampaign } from './store.js'
import { providerManager, validateProviderRegistry } from './lib/ai/providerManager.js'
import { metaConfig } from './lib/metaConfig.js'
import { startTokenRefreshScheduler } from './lib/tokenRefresh.js'
import { closeDb } from './db.js'
import { registerMediaRoute } from './routes/media.js'
import { handleWebhook, handleVerify } from './routes/webhook.js'
import { handleUserInput, handleVoiceInput } from './pipeline/conversation.js'
import { startPublishScheduler, schedulePost, getScheduledPosts, cancelScheduledPostById, rescheduleScheduledPost, normalizeScheduleTime } from './pipeline/publish.js'
import { storageManager } from './lib/StorageManager.js'
import { startAdScheduler } from './pipeline/adScheduler.js'
import { startPackageExpiryScheduler } from './lib/PackageExpiryScheduler.js'
import { requireFeature, FeatureNotIncludedError } from './lib/packagePermissions.js'
import { bootstrapSuperAdmin } from './lib/adminAuth.js'
import { saveImageBuffer } from './storage.js'
import { localFileUrl } from './lib/whatsapp.js'
import { ensureReady, assertProductionSecurityConfig } from './config.js'
import { verifyWebhookSignature } from './lib/whatsapp.js'
import { rateLimit } from './lib/ratelimit.js'
import { registerAdminAuthRoutes } from './routes/admin-api/auth.js'
import { registerAdminPackageRoutes } from './routes/admin-api/packages.js'
import { registerAdminTopUpRoutes } from './routes/admin-api/topups.js'
import { registerAdminUserRoutes } from './routes/admin-api/users.js'
import { registerAdminPaymentRoutes } from './routes/admin-api/payments.js'
import { registerAdminSettingsRoutes } from './routes/admin-api/settings.js'
import { registerAdminStatsRoutes } from './routes/admin-api/stats.js'
import { registerAdminAIProviderRoutes } from './routes/admin-api/ai-providers.js'
import { registerAdminMetaSettingsRoutes } from './routes/admin-api/meta-settings.js'
import { registerAdminReportRoutes } from './routes/admin-api/reports.js'
import { registerAdminAdminsRoutes } from './routes/admin-api/admins.js'
import { registerAdminAuditRoutes } from './routes/admin-api/audit.js'
import { registerAdminErrorRoutes } from './routes/admin-api/errors.js'
import { registerAssistantRoutes } from './routes/assistant.js'
import { registerSupportRoutes } from './routes/support.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerBillingRoutes } from './routes/billing.js'
import { registerStripeRoutes } from './routes/stripe.js'
import { registerAdSchedulerRoutes } from './routes/adScheduler.js'
import { registerNotificationRoutes } from './routes/notifications.js'
import { registerGatewayRoutes } from './routes/gateway.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerSocialRoutes } from './routes/social.js'
import { registerCheckoutRoutes } from './routes/checkout.js'
import { registerChatRoutes } from './routes/chat.js'
import { registerBrandRoutes } from './routes/brand.js'
import { registerTopUpRoutes } from './routes/topup.js'
import { verifySession } from './lib/userAuth.js'
import { adminAuthMiddleware } from './routes/admin-api/middleware.js'
import { setLoggerDbReady, logger } from './lib/logger.js'

// Capture any uncaught error from the whole project (A to Z) into the error log.
function registerGlobalErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    logger.error({ source: 'uncaught', stack: err.stack, error: err.message }, 'uncaught exception')
  })
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    logger.error({ source: 'unhandled', stack: err.stack, error: err.message }, 'unhandled promise rejection')
  })
}

async function main(): Promise<void> {
  registerGlobalErrorHandlers()
  await initStore()
  setLoggerDbReady(true)
  await bootstrapSuperAdmin()
  await providerManager.load()
  await validateProviderRegistry()
  await metaConfig.load()
  await recoverStuckPosts()
  await recoverStuckScheduledPosts()
  await recoverStuckPayments()
  startPublishScheduler()
  startAdScheduler()
  startPackageExpiryScheduler()
  startTokenRefreshScheduler()
  setInterval(() => {
    autoResolveErrorLogs().catch(() => 0)
  }, 60 * 60 * 1000)
  setInterval(() => {
    recoverStuckPayments().catch(() => 0)
  }, 15 * 60 * 1000)
  // P5-12 — nightly orphaned-media sweep; referenced files (posts / avatars) are preserved.
  setInterval(() => {
    storageManager.cleanup(30).catch(() => 0)
  }, 24 * 60 * 60 * 1000)
  // ensureReady() — commented out for dev mode without real API keys

  if (config.admin.email === 'admin@example.com' || config.admin.password === 'admin123') {
    console.warn(
      '⚠️  WARNING: Using default admin credentials (admin@example.com / admin123). ' +
      'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before going to production.',
    )
  }

  if (config.stripe.secretKey && !config.stripe.webhookSecret) {
    logger.error(
      { source: 'config' },
      'FATAL: STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set. Refusing to start — customers would be charged without token credit.',
    )
    process.exit(1)
  }

  try {
    assertProductionSecurityConfig()
  } catch (err) {
    logger.error({ source: 'config' }, (err as Error).message)
    process.exit(1)
  }

  if (config.dev.enabled) {
    console.warn(
      '⚠️  DEV MODE is ON. External integrations (stripe, whatsapp, image, publish, connect, STT) ' +
      'are being MOCKED when their real key is missing. NEVER deploy with DEV_MODE=true.',
    )
  }

  const server = await import('fastify').then((m) => m.default({ logger: true, bodyLimit: 10 * 1024 * 1024 }))

  // H7 — CORS only reflects a configured/known origin, never an arbitrary one.
  const allowedOrigins = new Set<string>([
    ...config.allowedOrigins,
    config.frontendUrl,
    ...(config.dev.enabled ? ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8787'] : []),
  ])

  server.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (origin && allowedOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
      reply.header('Access-Control-Allow-Credentials', 'true')
      reply.header('Access-Control-Max-Age', '86400')
    } else if (origin) {
      // Requests from unknown origins get no CORS headers → the browser blocks them.
      reply.header('Vary', 'Origin')
    }
    if (request.method === 'OPTIONS') {
      reply.code(204).send()
    }
  })

  // H19 — structured JSON errors + generic 500 in production.
  server.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'Not found' })
  })
  server.setErrorHandler((err: any, _req, reply) => {
    const status = err?.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500
    if (status >= 500) {
      logger.error({ error: err?.stack || err?.message }, 'unhandled request error')
    }
    reply.code(status).send({ error: status >= 500 ? 'Internal server error' : (err?.message || 'Bad request') })
  })

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
    const cfg = await getAllConfig()
    const stripeKey = config.stripe.secretKey || cfg.stripe_secret
    // Admin toggles control visibility in checkout; the secret key controls real capability.
    const stripeEnabled = cfg.payment_method_stripe !== 'off'
    const gatewayEnabled = cfg.gateway_enabled !== 'off'
    const gatewayConfigured = !!(cfg.gateway_api_key && cfg.gateway_webhook_secret)
    const parsePercent = (raw: string | undefined, fallback: number): number => {
      const n = Number(raw)
      return Number.isFinite(n) && n >= 0 ? n : fallback
    }
    const taxPercent = parsePercent(cfg.checkout_tax_percent, 8)
    const mdrPercent = parsePercent(cfg.checkout_mdr_percent, 2)

    const integrations = {
      stripe: !!stripeKey,
      whatsapp: !!(config.whatsapp.token && config.whatsapp.phoneNumberId),
      facebook: !!(config.oauth.facebook.clientId),
      instagram: !!(config.instagram.accessToken && config.instagram.igUserId),
      groq: !!config.stt.apiKey,
      llm: !!config.llm.apiKey,
      openai: !!config.image.openaiKey,
      clerk: !!config.clerk.secretKey,
    }
    const whatsapp = {
      connected: integrations.whatsapp,
      number: metaConfig.getWhatsAppDisplayNumber(),
    }
    return reply.send({
      devMode: config.dev.enabled,
      integrations,
      whatsapp,
      paymentMethods: {
        stripe: stripeEnabled,
        gateway: gatewayEnabled,
      },
      checkout: {
        taxPercent,
        mdrPercent,
        pkrRate: Number(cfg.payment_local_pkr_rate) || 0,
      },
      gatewayPayment: {
        enabled: gatewayEnabled,
        configured: gatewayConfigured,
        sandbox: cfg.gateway_sandbox === 'on',
        webhookUrl: `${config.publicBaseUrl}/webhooks/gateway`,
      },
    })
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
    const { getConfiguredCost } = await import('./lib/TokenEngine.js')
    return reply.send({
      standardPost: Number(cfg.cost_standard_post) || 1,
      crossPlatform: Number(cfg.cost_cross_platform) || 2,
      imageRegenerate: Number(cfg.cost_image_regenerate) || 1,
      adCampaign: Number(cfg.cost_ad_campaign) || 5,
      voiceTranscription: await getConfiguredCost('voice_transcription'),
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
    return reply.send({
      features: pkg?.features || {},
      package: pkg
        ? {
            slug: pkg.slug,
            name: pkg.name,
            tokens: pkg.includedTokens,
            priceCents: pkg.priceCents,
          }
        : null,
    })
  })

  // User API: get current user's posts
  server.get('/api/posts', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'No token provided' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid or expired session' })

    const { listPostsForUser } = await import('./store.js')
    const [posts, scheduled] = await Promise.all([
      listPostsForUser(session.phone),
      getScheduledPosts(session.phone).catch(() => []),
    ])
    const scheduledByPost = new Map(scheduled.map((s) => [s.postId, s.publishAt]))
    const enriched = posts.map((p: any) => ({
      ...p,
      scheduledAt: scheduledByPost.get(p.id) || null,
    }))
    return reply.send({ posts: enriched })
  })

  // User API: get current user's scheduled posts
  server.get('/api/posts/scheduled', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'No token provided' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid or expired session' })

    try {
      await requireFeature(session.phone, 'scheduled_publishing')
    } catch (err) {
      if (err instanceof FeatureNotIncludedError) return reply.status(403).send({ error: err.message })
      throw err
    }

    const posts = await getScheduledPosts(session.phone)
    return reply.send({ posts })
  })

  // User API: schedule a new post from the dashboard (caption + image + time)
  server.post('/api/posts/schedule', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'No token provided' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid or expired session' })

    try {
      await requireFeature(session.phone, 'scheduled_publishing')
    } catch (err) {
      if (err instanceof FeatureNotIncludedError) return reply.status(403).send({ error: err.message })
      throw err
    }

    const { caption, publishAt, imageBase64, publishNow } = req.body as {
      caption?: string
      publishAt?: string
      imageBase64?: string
      publishNow?: boolean
    }

    if (!caption || typeof caption !== 'string' || !caption.trim()) {
      return reply.status(400).send({ error: 'caption is required' })
    }
    const imageBuffer = imageBase64 ? Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64') : undefined
    if (!imageBuffer || imageBuffer.length === 0) {
      return reply.status(400).send({ error: 'image is required' })
    }

    const post = await createPost(session.phone)
    const content = {
      hook: '',
      caption: caption.trim(),
      cta: '',
      emojis: '',
      hashtags: '',
      seoKeywords: [],
    }
    await setStage(post.id, 'WRITTEN', {
      content,
      intent: { topic: caption.trim(), audience: '', tone: '', goal: 'promote', language: '', emotion: '' },
    })
    const relPath = saveImageBuffer(imageBuffer, post.id)
    await setStage(post.id, 'IMAGE', { imagePath: relPath, imageUrl: localFileUrl(relPath) })

    // "directly post" — publish immediately instead of scheduling.
    if (publishNow === true) {
      await setStage(post.id, 'APPROVED')
      const { enqueuePublish } = await import('./pipeline/publish.js')
      try {
        await enqueuePublish(post.id)
      } catch (err) {
        return reply.status(500).send({ error: `Could not publish now: ${(err as Error).message}` })
      }
      return reply.status(201).send({ postId: post.id, published: true })
    }

    const { resolveUserTimezone, isValidTimezone } = await import('./lib/timezone.js')
    const reqTz = (req.body as { timezone?: string }).timezone
    const timezone = isValidTimezone(reqTz) ? reqTz! : await resolveUserTimezone(session.phone)
    const publishIso = await normalizeScheduleTime(publishAt || '', timezone)
    if (!publishIso) {
      return reply.status(400).send({ error: 'publishAt must be a valid future time (e.g. ISO date, "in 2 hours", "tomorrow at 5pm", "15 August at 9am")' })
    }
    await schedulePost(post.id, session.phone, publishIso)
    return reply.status(201).send({ postId: post.id, publishAt: publishIso })
  })

  // NOTE: GET /api/ads/scheduled, POST /api/ads/scheduled/:id/cancel, and
  // POST /api/ads/scheduled/:id/edit are already registered in adScheduler.ts.
  // Only the manual-create route below is added here.

  // User API: create a manual ad campaign from the dashboard (no AI copy — use the
  // creative the user supplies). Optional publishNow to launch immediately.
  server.post('/api/ads', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'No token provided' })
    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid or expired session' })
    try {
      await requireFeature(session.phone, 'ad_campaigns')
    } catch (err) {
      if (err instanceof FeatureNotIncludedError) return reply.status(403).send({ error: err.message })
      throw err
    }
    const body = req.body as {
      name?: string
      headline?: string
      primaryText?: string
      description?: string
      websiteUrl?: string
      imageBase64?: string
      budget?: number
      budgetType?: 'daily' | 'total'
      currency?: string
      objective?: string
      location?: string
      audience?: string
      publishAt?: string
      publishNow?: boolean
      timezone?: string
    }
    if (!body.primaryText?.trim() && !body.headline?.trim()) {
      return reply.status(400).send({ error: 'Ad creative (headline or primary text) is required' })
    }
    if (!body.websiteUrl?.trim()) {
      return reply.status(400).send({ error: 'websiteUrl is required for the ad landing page' })
    }
    let imageUrl = ''
    if (body.imageBase64) {
      const buf = Buffer.from(body.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
      imageUrl = localFileUrl(saveImageBuffer(buf, `ad_${Date.now()}`))
    }
    if (!imageUrl) return reply.status(400).send({ error: 'imageBase64 is required for the ad' })
    const reqTz = body.timezone
    const { resolveUserTimezone, isValidTimezone } = await import('./lib/timezone.js')
    const tz = isValidTimezone(reqTz) ? reqTz! : await resolveUserTimezone(session.phone)
    let publishIso: string | null = null
    if (body.publishAt) {
      publishIso = await normalizeScheduleTime(body.publishAt, tz)
      if (!publishIso) return reply.status(400).send({ error: 'publishAt must be a valid future time' })
    }
    const campaign = await createAdCampaign({
      phone: session.phone,
      name: body.name?.trim() || (body.headline?.trim() || 'Manual Ad'),
      objective: body.objective || 'OUTCOME_ENGAGEMENT',
      adContent: {
        headline: body.headline?.trim() || body.primaryText!.trim(),
        primaryText: body.primaryText!.trim(),
        description: body.description?.trim() || '',
        callToAction: 'Learn More',
        linkUrl: body.websiteUrl.trim(),
      },
      targeting: {
        ageMin: 18,
        ageMax: 65,
        genders: ['all'],
        locations: body.location ? [body.location] : [],
        interests: body.audience ? [body.audience] : [],
      },
      budgetCents: Math.round((body.budget ?? 5) * 100),
      budgetType: body.budgetType ?? 'daily',
      currency: body.currency?.toUpperCase() || 'USD',
      imageUrl,
      publishAt: publishIso ?? undefined,
    })
    if (body.publishNow && !publishIso) await updateAdCampaign(campaign.id, { status: 'scheduled' })
    return reply.status(201).send({ id: campaign.id, publishAt: campaign.publishAt ?? null, status: campaign.status })
  })

  // User API: cancel a scheduled post
  server.post('/api/posts/scheduled/:id/cancel', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'No token provided' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid or expired session' })

    try {
      await requireFeature(session.phone, 'scheduled_publishing')
    } catch (err) {
      if (err instanceof FeatureNotIncludedError) return reply.status(403).send({ error: err.message })
      throw err
    }

    const { id } = req.params as { id: string }
    const cancelled = await cancelScheduledPostById(id, session.phone)
    if (!cancelled) return reply.status(404).send({ error: 'Scheduled post not found' })
    return reply.send({ success: true })
  })

  server.post('/api/posts/scheduled/:id/reschedule', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'No token provided' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid or expired session' })

    try {
      await requireFeature(session.phone, 'scheduled_publishing')
    } catch (err) {
      if (err instanceof FeatureNotIncludedError) return reply.status(403).send({ error: err.message })
      throw err
    }

    const { id } = req.params as { id: string }
    const { publishAt, timezone: reqTz } = req.body as { publishAt?: string; timezone?: string }
    const { resolveUserTimezone, isValidTimezone } = await import('./lib/timezone.js')
    const timezone = isValidTimezone(reqTz) ? reqTz! : await resolveUserTimezone(session.phone)
    const publishIso = await normalizeScheduleTime(publishAt || '', timezone)
    if (!publishIso) {
      return reply.status(400).send({ error: 'publishAt must be a valid future time' })
    }

    const rescheduled = await rescheduleScheduledPost(id, session.phone, publishIso)
    if (!rescheduled) return reply.status(404).send({ error: 'Scheduled post not found' })
    return reply.send({ success: true, publishAt: publishIso })
  })

  server.addHook('preHandler', adminAuthMiddleware)

  registerAdminAuthRoutes(server)
  registerAdminPackageRoutes(server)
  registerAdminTopUpRoutes(server)
  registerAdminUserRoutes(server)
  registerAdminPaymentRoutes(server)
  registerAdminSettingsRoutes(server)
  registerAdminStatsRoutes(server)
  registerAdminAIProviderRoutes(server)
  registerAdminMetaSettingsRoutes(server)
  registerAdminReportRoutes(server)
  registerAdminAdminsRoutes(server)
  registerAdminAuditRoutes(server)
  registerAdminErrorRoutes(server)
  registerAssistantRoutes(server)
  registerSupportRoutes(server)
  registerHealthRoutes(server)
  registerBillingRoutes(server)
  registerStripeRoutes(server)
  registerAdSchedulerRoutes(server)
  registerNotificationRoutes(server)
  registerGatewayRoutes(server)
  registerAuthRoutes(server)
  registerSocialRoutes(server)
  registerCheckoutRoutes(server)
  registerChatRoutes(server)
  registerBrandRoutes(server)
  registerTopUpRoutes(server)

  server.get('/', async () => {
    return { status: 'ok', message: 'AI Instagram Agent is running' }
  })

  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`Server running on http://localhost:${config.port}`)

  const clerkWarn = clerkKeyMismatchWarning()
  if (clerkWarn) {
    console.warn(`\n⚠️  CLERK CONFIG WARNING: ${clerkWarn}\n`)
  }

  const shutdown = async (signal: string) => {
    console.log(`${signal} received. Shutting down gracefully...`)
    try {
      await server.close()
      await closeDb()
    } catch (err) {
      logger.error({ source: 'shutdown', stack: (err as Error).stack, error: (err as Error).message }, 'error during shutdown')
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  logger.error({ source: 'startup', stack: (err as Error).stack, error: (err as Error).message }, 'failed to start server')
  process.exit(1)
})