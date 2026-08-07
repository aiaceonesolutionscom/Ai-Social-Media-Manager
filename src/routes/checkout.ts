import { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { verifySession } from '../lib/userAuth.js'
import { createCheckoutSession } from '../lib/stripe.js'
import { getUser, getPackage, createPayment, updateUser, createTokenTransaction } from '../store.js'
import { logger } from '../lib/logger.js'

export async function registerCheckoutRoutes(server: FastifyInstance): Promise<void> {
  server.post('/api/checkout', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'Unauthorized' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid session' })

    const { packageId } = req.body as { packageId?: string }
    if (!packageId || typeof packageId !== 'string' || packageId.trim().length === 0) {
      return reply.status(400).send({ error: 'Package ID is required' })
    }

    if (!config.stripe.secretKey) {
      if (config.dev.enabled) {
        const user = await getUser(session.phone)
        if (!user) return reply.status(404).send({ error: 'User not found' })

        const pkg = await getPackage(packageId)
        if (!pkg) return reply.status(404).send({ error: 'Package not found' })
        if (!pkg.isActive) return reply.status(400).send({ error: 'This package is not available' })

        const tokensGranted = pkg.includedTokens
        const newBalance = user.tokensRemaining + tokensGranted

        await updateUser(session.phone, {
          packageId: pkg.slug,
          tokensRemaining: newBalance,
          tokensUsed: user.tokensUsed,
        })

        await createPayment({
          phone: session.phone,
          packageId: pkg.slug,
          tokenCount: tokensGranted,
          amountCents: pkg.priceCents,
          type: 'one_time',
          stripeSessionId: `test_${Date.now()}`,
        })

        await createTokenTransaction({
          phone: session.phone,
          type: 'grant',
          amount: tokensGranted,
          balanceAfter: newBalance,
          description: `Test checkout — ${pkg.name}`,
        })

        logger.info({ phone: session.phone, packageId: pkg.slug, tokensGranted }, 'DEV MODE: checkout granted (no Stripe configured)')
        return reply.send({ mock: true, granted: true, package: pkg.slug, tokensGranted, newBalance })
      }
      return reply.status(503).send({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.' })
    }

    const pkg = await getPackage(packageId)
    if (!pkg) return reply.status(404).send({ error: 'Package not found' })
    if (!pkg.isActive) return reply.status(400).send({ error: 'This package is not available' })

    const user = await getUser(session.phone)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    try {
      const successUrl = `${config.frontendUrl}/connect?payment=success&session_id={CHECKOUT_SESSION_ID}`
      const cancelUrl = `${config.frontendUrl}/checkout?plan=${pkg.slug}&payment=cancelled`

      const checkout = await createCheckoutSession({
        packageId: pkg.slug,
        packageName: pkg.name,
        priceCents: pkg.priceCents,
        phone: user.phone,
        successUrl,
        cancelUrl,
      })

      await createPayment({
        phone: user.phone,
        packageId: pkg.slug,
        tokenCount: pkg.includedTokens,
        amountCents: pkg.priceCents,
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
