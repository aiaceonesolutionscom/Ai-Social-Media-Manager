import { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { verifySession } from '../lib/userAuth.js'
import { createCheckoutSession } from '../lib/stripe.js'
import { createGatewaySession, getGatewaySettings, isGatewayConfigured } from '../lib/gateway.js'
import { getUser, getPackage, createPayment, updatePayment, getAllConfig } from '../store.js'
import { activatePackage, isPackageExpired } from '../lib/packageLifecycle.js'
import { logger } from '../lib/logger.js'

export async function registerCheckoutRoutes(server: FastifyInstance): Promise<void> {
  server.post('/api/checkout', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'Unauthorized' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid session' })

    const body = req.body as { packageId?: string; method?: string; reference?: string }
    const { packageId } = body
    const requested = (body.method || '').toLowerCase()

    if (!packageId || typeof packageId !== 'string' || packageId.trim().length === 0) {
      return reply.status(400).send({ error: 'Package ID is required' })
    }

    const pkg = await getPackage(packageId)
    if (!pkg) return reply.status(404).send({ error: 'Package not found' })
    if (!pkg.isActive) return reply.status(400).send({ error: 'This package is not available' })

    const user = await getUser(session.phone)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    // Block purchase while an active package exists.
    if (user.packageStatus === 'active' && !isPackageExpired(user)) {
      return reply.status(400).send({
        error: 'You already have an active package. End your current package first, then buy a new one.',
      })
    }

    const cfg = await getAllConfig()
    const stripeKey = config.stripe.secretKey || cfg.stripe_secret
    const devMock = config.dev.enabled && !stripeKey
    // Admin toggles control visibility; the key controls real capability.
    const stripeEnabled = cfg.payment_method_stripe !== 'off'
    const gatewayEnabled = cfg.gateway_enabled !== 'off'

    // Checkout pricing: the estimated tax (admin-adjustable) is added for Stripe (and the
    // dev-mode mock). The gateway (JazzCash / EasyPaisa) charges the base price plus the
    // gateway MDR — no tax.
    const parsePercent = (raw: string | undefined, fallback: number): number => {
      const n = Number(raw)
      return Number.isFinite(n) && n >= 0 ? n : fallback
    }
    const taxPercent = parsePercent(cfg.checkout_tax_percent, 8)
    const mdrPercent = parsePercent(cfg.checkout_mdr_percent, 2)
    const taxCents = Math.round((pkg.priceCents * taxPercent) / 100)
    const chargeCents = pkg.priceCents + taxCents

    let flow: 'stripe' | 'mock' | 'gateway'
    if (requested === 'gateway') {
      if (!gatewayEnabled) return reply.status(400).send({ error: 'Gateway payments are not enabled' })
      flow = 'gateway'
    } else if (requested === 'stripe') {
      if (devMock) {
        flow = 'mock'
      } else if (stripeEnabled) {
        flow = 'stripe'
      } else if (gatewayEnabled) {
        return reply.status(400).send({ error: 'Stripe payments are not enabled' })
      } else {
        return reply.status(503).send({ error: 'No payment method is enabled' })
      }
    } else if (requested === 'local') {
      return reply.status(400).send({ error: 'Local payments are no longer available. Use Card / JazzCash / EasyPaisa instead.' })
    } else if (devMock) {
      flow = 'mock'
    } else if (stripeEnabled) {
      flow = 'stripe'
    } else if (gatewayEnabled) {
      flow = 'gateway'
    } else {
      return reply.status(503).send({ error: 'No payment method is enabled' })
    }

    if (flow === 'gateway') {
      // Gateway checkout (Card / JazzCash / EasyPaisa via RapidGateway). The customer is
      // redirected to the gateway's hosted page; activation happens via the signed webhook.
      const settings = await getGatewaySettings(cfg)
      if (!isGatewayConfigured(settings)) {
        return reply.status(503).send({ error: 'Gateway is not configured. Add the API key and webhook secret in Payment settings.' })
      }

      const pkrRate = Number(cfg.payment_local_pkr_rate) || 0
      if (pkrRate <= 0) {
        return reply.status(503).send({ error: 'Gateway checkout requires a PKR rate. Set it in Payment settings.' })
      }
      // Gateway checkout: no estimated tax — only the gateway MDR is added on top of the
      // package price so JazzCash / EasyPaisa customers pay the base amount.
      const basePkr = Math.round((pkg.priceCents / 100) * pkrRate)
      const amountPkr = Math.round(basePkr * (1 + mdrPercent / 100))
      const mdrPkr = amountPkr - basePkr

      const payment = await createPayment({
        phone: user.phone,
        packageId: pkg.slug,
        tokenCount: pkg.includedTokens,
        amountCents: pkg.priceCents,
        currency: 'PKR',
        taxPercent: 0,
        mdrPercent: Math.round(mdrPercent),
        taxAmount: 0,
        mdrAmount: mdrPkr,
        type: 'one_time',
      })
      await updatePayment(payment.id, { stripeSessionId: `rg_${payment.id}` })

      const webhookUrl = `${config.publicBaseUrl}/webhooks/gateway`
      const returnUrl = `${config.frontendUrl}/checkout?plan=${pkg.slug}&payment=gateway_done`

      try {
        const session = await createGatewaySession({
          amountPkr,
          merchantTransactionId: payment.id,
          phone: user.phone,
          returnUrl,
          webhookUrl,
          settings,
        })
        logger.info({ phone: user.phone, packageId: pkg.slug, paymentId: payment.id, gatewayTxn: session.id }, 'gateway checkout session created')
        return reply.send({ gateway: true, sessionId: session.id, url: session.url })
      } catch (err) {
        logger.error({ phone: user.phone, packageId: pkg.slug, error: (err as Error).message }, 'failed to create gateway session')
        return reply.status(500).send({ error: `Failed to start checkout: ${(err as Error).message}` })
      }
    }

    if (flow === 'mock') {
      const tokensGranted = pkg.includedTokens

      // H15 — record the payment row FIRST, then grant. A grant without a payment
      // record is invisible to billing and untraceable.
      await createPayment({
        phone: session.phone,
        packageId: pkg.slug,
        tokenCount: tokensGranted,
        amountCents: pkg.priceCents,
        taxPercent: Math.round(taxPercent),
        mdrPercent: Math.round(mdrPercent),
        taxAmount: taxCents,
        mdrAmount: 0,
        type: 'one_time',
        stripeSessionId: `test_${Date.now()}`,
      })

      await activatePackage(session.phone, pkg.slug, {
        tokens: tokensGranted,
        description: `Test checkout — ${pkg.name}`,
      })

      logger.info({ phone: session.phone, packageId: pkg.slug, tokensGranted }, 'DEV MODE: checkout granted (no Stripe configured)')
      const newUser = await getUser(session.phone)
      return reply.send({ mock: true, granted: true, package: pkg.slug, tokensGranted, newBalance: newUser?.tokensRemaining ?? tokensGranted })
    }

    if (!stripeKey) {
      return reply.status(503).send({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.' })
    }

    try {
      const successUrl = `${config.frontendUrl}/connect?payment=success&session_id={CHECKOUT_SESSION_ID}`
      const cancelUrl = `${config.frontendUrl}/checkout?plan=${pkg.slug}&payment=cancelled`

      const checkout = await createCheckoutSession({
        packageId: pkg.slug,
        packageName: pkg.name,
        priceCents: chargeCents,
        phone: user.phone,
        successUrl,
        cancelUrl,
      })

      await createPayment({
        phone: user.phone,
        packageId: pkg.slug,
        tokenCount: pkg.includedTokens,
        amountCents: pkg.priceCents,
        taxPercent: Math.round(taxPercent),
        mdrPercent: Math.round(mdrPercent),
        taxAmount: taxCents,
        mdrAmount: 0,
        type: 'one_time',
        stripeSessionId: checkout.sessionId,
      })

      logger.info({ phone: user.phone, packageId: pkg.slug, sessionId: checkout.sessionId }, 'checkout session created')
      return reply.send({ sessionId: checkout.sessionId, url: checkout.url })
    } catch (err: any) {
      logger.error({ phone: user.phone, packageId: pkg.slug, error: err.message }, 'failed to create checkout session')
      return reply.status(500).send({ error: `Failed to start checkout: ${err.message}` })
    }
  })
}