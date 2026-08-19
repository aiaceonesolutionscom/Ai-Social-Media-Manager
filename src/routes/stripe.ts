import { FastifyInstance } from 'fastify'
import { constructWebhookEvent } from '../lib/stripe.js'
import { getUser, getPackage, getPaymentByStripeSession, claimPaymentByStripeSession, completePayment, failPayment, updateUser } from '../store.js'
import { activatePackage } from '../lib/packageLifecycle.js'
import { clearFeatureCache } from '../lib/packagePermissions.js'
import { notifyNewUser, notifyPayment } from '../lib/notifications.js'
import { logger } from '../lib/logger.js'

export async function registerStripeRoutes(server: FastifyInstance): Promise<void> {
  server.post('/webhooks/stripe', async (req: any, reply: any) => {
    const signature = req.headers['stripe-signature'] as string
    const rawBody = req.rawBody || JSON.stringify(req.body)

    if (!signature) {
      return reply.status(400).send({ error: 'Missing stripe-signature header' })
    }

    let event: any
    try {
      event = await constructWebhookEvent(rawBody, signature)
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'stripe webhook signature verification failed')
      return reply.status(400).send({ error: 'Invalid signature' })
    }

    logger.info({ type: event.type }, 'stripe webhook received')

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const phone = session.metadata?.phone
        const packageId = session.metadata?.packageId
        const kind = session.metadata?.kind || 'package'

        if (!phone) {
          logger.warn('checkout.session.completed missing metadata')
          break
        }

        // Idempotency: atomically claim this session (pending → processing).
        // If nothing was claimed, the payment is already completed/processing
        // or unknown → no-op. This is race-safe under concurrent webhooks.
        const claimed = await claimPaymentByStripeSession(session.id)
        if (!claimed) {
          const existingPayment = await getPaymentByStripeSession(session.id)
          if (existingPayment && existingPayment.status === 'completed') {
            logger.info({ stripeSessionId: session.id }, 'stripe event already processed, skipping')
          } else {
            logger.warn({ stripeSessionId: session.id, status: existingPayment?.status ?? 'missing' }, 'stripe event ignored: payment not pending or unknown')
          }
          break
        }

        // Top-up: grant tokens only
        if (kind === 'topup') {
          const tokenCount = Number(session.metadata?.tokenCount) || 0
          const existingUser = await getUser(phone)
          if (!existingUser) {
            logger.warn({ phone }, 'top-up for unknown user')
            await failPayment(claimed.id)
            break
          }
          if (tokenCount > 0) {
            const { grantTokens } = await import('../lib/tokens.js')
            await grantTokens(phone, tokenCount, 'stripe', `Top-up — ${tokenCount} tokens`, `stripe:${session.id}`)
          }
          await completePayment(claimed.id)
          const { notifyPayment: notify } = await import('../lib/notifications.js')
          await notify(phone, session.amount_total || 0, `${tokenCount} tokens`)
          logger.info({ phone, tokenCount }, 'top-up completed via stripe webhook')
          break
        }

        // Package purchase: ensure user exists, then activate
        const existingUser = await getUser(phone)
        const pkg = await getPackage(packageId)
        const tokens = pkg?.includedTokens || 0

        if (!existingUser) {
          const { createUser } = await import('../store.js')
          await createUser({
            phone,
            packageId,
            tokensRemaining: tokens,
            stripeCustomerId: session.customer as string,
          })
        }

        if (pkg) {
          await activatePackage(phone, pkg.slug, {
            tokens,
            description: `Package purchase — ${pkg.name}`,
          })
        } else {
          await updateUser(phone, { packageId: undefined })
        }
        await completePayment(claimed.id)
        clearFeatureCache(phone)

        if (!existingUser) {
          await notifyNewUser(phone, phone, packageId)
        }
        await notifyPayment(phone, session.amount_total || 0, pkg?.name || 'Package')

        logger.info({ phone, packageId, tokens }, 'package purchase completed via stripe webhook')
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object
        logger.info({ subscriptionId: subscription.id }, 'subscription updated')
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        logger.info({ subscriptionId: subscription.id }, 'subscription cancelled')
        break
      }

      default:
        logger.debug({ type: event.type }, 'unhandled stripe event type')
    }

    return reply.send({ received: true })
  })

  server.get('/checkout/success', async (req: any, reply: any) => {
    return reply.send({
      message: 'Payment successful! Your account has been created. You can now start using WhatsApp to create posts.',
    })
  })
}
