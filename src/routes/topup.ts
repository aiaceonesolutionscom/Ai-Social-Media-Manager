import { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { verifySession } from '../lib/userAuth.js'
import { createCheckoutSession } from '../lib/stripe.js'
import { getUser, getTopUpBundle, listActiveTopUpBundles, createPayment } from '../store.js'
import { logger } from '../lib/logger.js'

export async function registerTopUpRoutes(server: FastifyInstance): Promise<void> {
  // Public: available top-up bundles (no auth needed for the options list)
  server.get('/api/topup/options', async (_req: any, reply: any) => {
    const bundles = await listActiveTopUpBundles()
    return reply.send({ bundles })
  })

  // Buy extra credits — adds tokens WITHOUT changing the user's package.
  server.post('/api/topup', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'Unauthorized' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid session' })

    const { bundleId } = req.body as { bundleId?: string }
    if (!bundleId || typeof bundleId !== 'string' || bundleId.trim().length === 0) {
      return reply.status(400).send({ error: 'bundleId is required' })
    }

    const bundle = await getTopUpBundle(bundleId)
    if (!bundle) return reply.status(404).send({ error: 'Top-up bundle not found' })
    if (!bundle.isActive) return reply.status(400).send({ error: 'This top-up is not available' })

    const user = await getUser(session.phone)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    if (!config.stripe.secretKey) {
      if (config.dev.enabled) {
        const { grantTokens } = await import('../lib/tokens.js')
        const opId = crypto.randomUUID()
        await grantTokens(session.phone, bundle.tokens, 'system', `Top-up — ${bundle.tokens} tokens`, opId)

        await createPayment({
          phone: session.phone,
          packageId: null,
          tokenCount: bundle.tokens,
          amountCents: bundle.priceCents,
          type: 'topup',
          stripeSessionId: `test_topup_${Date.now()}`,
        })

        logger.info({ phone: session.phone, bundleId: bundle.id, tokens: bundle.tokens }, 'DEV MODE: top-up granted (no Stripe configured)')
        const newBalance = user.tokensRemaining + bundle.tokens
        return reply.send({ mock: true, granted: true, bundle: bundle.id, tokensGranted: bundle.tokens, newBalance })
      }
      return reply.status(503).send({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.' })
    }

    try {
      const successUrl = `${config.frontendUrl}/dashboard?topup=success&session_id={CHECKOUT_SESSION_ID}`
      const cancelUrl = `${config.frontendUrl}/packages?topup=cancelled`

      const checkout = await createCheckoutSession({
        kind: 'topup',
        bundleId: bundle.id,
        packageName: `Extra credits — ${bundle.tokens} tokens`,
        priceCents: bundle.priceCents,
        tokenCount: bundle.tokens,
        phone: user.phone,
        successUrl,
        cancelUrl,
      })

      await createPayment({
        phone: user.phone,
        packageId: null,
        tokenCount: bundle.tokens,
        amountCents: bundle.priceCents,
        type: 'topup',
        stripeSessionId: checkout.sessionId,
      })

      logger.info({ phone: user.phone, bundleId: bundle.id, sessionId: checkout.sessionId }, 'top-up checkout session created')
      return reply.send({ sessionId: checkout.sessionId, url: checkout.url })
    } catch (err: any) {
      logger.error({ phone: user.phone, bundleId: bundle.id, error: err.message }, 'failed to start top-up checkout')
      return reply.status(500).send({ error: `Failed to start checkout: ${err.message}` })
    }
  })
}
