import { FastifyInstance } from 'fastify'
import { constructWebhookEvent } from '../lib/stripe.js'
import { createUser, getPackage, createPayment, updatePayment } from '../store.js'
import { grantTokens } from '../lib/tokens.js'
import { clearFeatureCache } from '../lib/packagePermissions.js'
import { sendWelcomeMessage } from '../lib/welcome.js'
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

        // Extra-credit top-up: grant tokens only, do NOT change the user's package.
        if (kind === 'topup') {
          const tokenCount = Number(session.metadata?.tokenCount) || 0
          const existingUser = await import('../store.js').then(m => m.getUser(phone))
          if (!existingUser) {
            logger.warn({ phone }, 'top-up for unknown user')
            break
          }
          if (tokenCount > 0) {
            const { grantTokens } = await import('../lib/tokens.js')
            await grantTokens(phone, tokenCount, 'stripe', `Top-up — ${tokenCount} tokens`)
          }
          const payment = await createPayment({
            phone,
            packageId: null,
            tokenCount,
            amountCents: session.amount_total || 0,
            type: 'topup',
            stripeSessionId: session.id,
          })
          await updatePayment(payment.id, { status: 'completed' })
          const { notifyPayment } = await import('../lib/notifications.js')
          await notifyPayment(phone, session.amount_total || 0, `${tokenCount} tokens`)
          logger.info({ phone, tokenCount }, 'top-up completed via stripe webhook')
          break
        }

          const existingUser = await import('../store.js').then(m => m.getUser(phone))
        if (!existingUser) {
          const pkg = await getPackage(packageId)
          const tokens = pkg?.includedTokens || 0

          const user = await createUser({
            phone,
            packageId,
            tokensRemaining: tokens,
            stripeCustomerId: session.customer as string,
          })

          const payment = await createPayment({
            phone,
            packageId,
            tokenCount: tokens,
            amountCents: session.amount_total || 0,
            type: 'subscription',
            stripeSessionId: session.id,
          })

          await updatePayment(payment.id, { status: 'completed' })
          clearFeatureCache(phone)

          await sendWelcomeMessage(phone)
          await notifyNewUser(phone, user.name || phone, packageId)
          await notifyPayment(phone, session.amount_total || 0, pkg?.name || 'Unknown')

          logger.info({ phone, packageId }, 'new user created via stripe webhook')
        } else {
          const payment = await createPayment({
            phone,
            packageId,
            tokenCount: 0,
            amountCents: session.amount_total || 0,
            type: 'subscription',
            stripeSessionId: session.id,
          })

          await updatePayment(payment.id, { status: 'completed' })

          logger.info({ phone }, 'existing user made a payment')
        }
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
