import { FastifyInstance } from 'fastify'
import { getPackage, getPayment, claimPayment, completePayment, failPayment, getAllConfig } from '../store.js'
import { activatePackage } from '../lib/packageLifecycle.js'
import { notifyPayment } from '../lib/notifications.js'
import { getGatewaySettings, verifyGatewayWebhook } from '../lib/gateway.js'
import { logger } from '../lib/logger.js'

/**
 * Verifies that a completed gateway event charged the amount we recorded for this
 * payment. The gateway charges in PKR: base = (amountCents/100) * pkrRate, plus the
 * gateway MDR. We accept the webhook amount expressed in major units, minor units, or
 * decimal PKR (the gateway may vary) as long as it matches the expected charge, and we
 * reject events whose currency is not PKR.
 */
function gatewayAmountMatches(amount: unknown, expectedPkr: number, currency: string | undefined): boolean {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return false
  if (currency && currency.toUpperCase() !== 'PKR') return false
  const candidates = [expectedPkr, expectedPkr * 100, expectedPkr / 100]
  return candidates.some((c) => Math.abs(n - c) <= Math.max(1, c * 0.001))
}

export async function registerGatewayRoutes(server: FastifyInstance): Promise<void> {
  server.post('/webhooks/gateway', async (req: any, reply: any) => {
    const signature = req.headers['x-rapidgateway-signature'] || req.headers['x-rg-signature'] || ''
    const timestamp = req.headers['x-rapidgateway-timestamp']
    const rawBody = req.rawBody ?? JSON.stringify(req.body)

    const settings = await getGatewaySettings()
    if (!settings.enabled) {
      return reply.status(404).send({ error: 'Not found' })
    }
    if (!signature) {
      return reply.status(400).send({ error: 'Missing signature header' })
    }

    const valid = verifyGatewayWebhook({
      rawBody,
      timestamp: timestamp as string | undefined,
      signature: signature as string,
      webhookSecret: settings.webhookSecret,
    })
    if (!valid) {
      logger.warn('gateway webhook signature verification failed')
      return reply.status(401).send({ error: 'Invalid signature' })
    }

    let event: any
    try {
      event = JSON.parse(rawBody)
    } catch (err) {
      return reply.status(400).send({ error: 'Invalid JSON payload' })
    }

    const eventType = event?.eventType || event?.type || ''
    if (eventType === 'webhook.test') {
      return reply.send({ received: true })
    }

    const merchantTransactionId = event?.merchantTransactionId as string | undefined
    if (!merchantTransactionId) {
      logger.warn('gateway webhook missing merchantTransactionId')
      return reply.status(400).send({ error: 'Missing merchantTransactionId' })
    }

    const payment = await getPayment(merchantTransactionId)
    if (!payment) {
      logger.warn({ merchantTransactionId }, 'gateway webhook for unknown payment')
      return reply.send({ received: true })
    }

    const txnRef = event?.gatewayTxnRef || ''

    if (eventType === 'transaction.completed') {
      // Atomic idempotency gate: only one webhook may claim the pending payment.
      const claimed = await claimPayment(payment.id)
      if (!claimed) {
        logger.info({ merchantTransactionId, status: payment.status }, 'gateway webhook for finalized payment, skipping')
        return reply.send({ received: true })
      }

      // Never activate a package from an event that does not match the recorded charge.
      const cfg = await getAllConfig()
      const pkrRate = Number(cfg.payment_local_pkr_rate) || 0
      const mdrPercent = payment.mdrPercent ?? 0
      const basePkr = Math.round((payment.amountCents / 100) * pkrRate)
      const expectedPkr = Math.round(basePkr * (1 + mdrPercent / 100))
      if (pkrRate <= 0 || !gatewayAmountMatches(event.amount, expectedPkr, event.currency)) {
        logger.warn(
          { merchantTransactionId, phone: payment.phone, amount: event.amount, currency: event.currency, expectedPkr },
          'gateway webhook amount/currency mismatch, rejecting completion',
        )
        return reply.status(400).send({ error: 'Amount or currency mismatch' })
      }

      const pkg = payment.packageId ? await getPackage(payment.packageId) : null
      if (pkg) {
        await activatePackage(payment.phone, pkg.slug, {
          tokens: payment.tokenCount || pkg.includedTokens,
          description: `Gateway payment — ${pkg.name}${txnRef ? ` (${txnRef})` : ''}`,
        })
      }
      await completePayment(payment.id)
      if (txnRef) {
        await updateGatewayPaymentRef(payment.id, txnRef)
      }
      await notifyPayment(payment.phone, payment.amountCents, pkg?.name || 'Package')
      logger.info({ merchantTransactionId, phone: payment.phone }, 'gateway payment completed, package activated')
    } else if (eventType === 'transaction.failed') {
      const claimed = await claimPayment(payment.id)
      if (claimed) {
        await failPayment(payment.id)
      }
      logger.info({ merchantTransactionId, phone: payment.phone }, 'gateway payment failed')
    } else {
      logger.debug({ eventType }, 'unhandled gateway event type')
    }

    return reply.send({ received: true })
  })
}

async function updateGatewayPaymentRef(id: string, txnRef: string): Promise<void> {
  const { updatePayment } = await import('../store.js')
  await updatePayment(id, { stripeSessionId: `rg_${txnRef}` })
}