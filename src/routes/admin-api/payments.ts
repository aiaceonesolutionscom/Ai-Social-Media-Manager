import { FastifyInstance } from 'fastify'

import { listPayments, getPayment, updatePayment, getPackage, getUser, getAllConfig, setConfig } from '../../store.js'
import { activatePackage, endPackage } from '../../lib/packageLifecycle.js'
import { clearFeatureCache } from '../../lib/packagePermissions.js'
import { paymentStatusTransitionAllowed } from '../../lib/paymentTransitions.js'
import { guard } from './middleware.js'

export async function registerAdminPaymentRoutes(server: FastifyInstance): Promise<void> {

  // ---- Payment method configuration (super admin only) ----

  server.get('/api/admin/payments/methods', guard('payments.view'), async (_req: any, reply: any) => {
    const cfg = await getAllConfig()
    return reply.send({
      stripe: cfg.payment_method_stripe !== 'off',
      gateway: cfg.gateway_enabled !== 'off',
      gatewaySandbox: cfg.gateway_sandbox === 'on',
      gatewayApiBase: cfg.gateway_api_base || 'https://api.rapidgateway.pk',
      gatewayApiKeySet: !!cfg.gateway_api_key,
      gatewayWebhookSecretSet: !!cfg.gateway_webhook_secret,
      pkrRate: Number(cfg.payment_local_pkr_rate) || 0,
      taxPercent: (() => { const n = Number(cfg.checkout_tax_percent); return Number.isFinite(n) && n >= 0 ? n : 8 })(),
      mdrPercent: (() => { const n = Number(cfg.checkout_mdr_percent); return Number.isFinite(n) && n >= 0 ? n : 2 })(),
    })
  })

  server.put('/api/admin/payments/methods', guard('payments.view'), async (req: any, reply: any) => {
    if (req.adminRole !== 'super_admin') {
      return reply.status(403).send({ error: 'Super admin access required' })
    }
    const body = (req.body ?? {}) as {
      stripe?: 'on' | 'off'
      pkrRate?: number | string
      taxPercent?: number | string
      mdrPercent?: number | string
      gateway?: 'on' | 'off'
      gatewaySandbox?: boolean
      gatewayApiBase?: string
      gatewayApiKey?: string
      gatewayWebhookSecret?: string
    }

    await setConfig('payment_method_stripe', body.stripe === 'on' ? 'on' : 'off')
    await setConfig('payment_local_pkr_rate', String(Number(body.pkrRate) || 0))
    await setConfig('checkout_tax_percent', String(Math.max(0, Number(body.taxPercent) || 0)))
    await setConfig('checkout_mdr_percent', String(Math.max(0, Number(body.mdrPercent) || 0)))
    await setConfig('gateway_enabled', body.gateway === 'on' ? 'on' : 'off')
    await setConfig('gateway_sandbox', body.gatewaySandbox ? 'on' : 'off')
    await setConfig('gateway_api_base', (body.gatewayApiBase || '').trim() || 'https://api.rapidgateway.pk')
    if (body.gatewayApiKey && String(body.gatewayApiKey).trim()) {
      await setConfig('gateway_api_key', String(body.gatewayApiKey).trim())
    }
    if (body.gatewayWebhookSecret && String(body.gatewayWebhookSecret).trim()) {
      await setConfig('gateway_webhook_secret', String(body.gatewayWebhookSecret).trim())
    }

    return reply.send({ success: true })
  })

  // ---- Payments ----

  server.get('/api/admin/payments', guard('payments.view'), async (req: any, reply: any) => {
    const phone = (req.query as any)?.phone as string | undefined
    const payments = await listPayments(phone)
    return reply.send({ payments })
  })

  server.get('/api/admin/payments/:id', guard('payments.view'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const payment = await getPayment(id)
    if (!payment) {
      return reply.status(404).send({ error: 'Payment not found' })
    }
    return reply.send({ payment })
  })

  server.put('/api/admin/payments/:id', guard('payments.view'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const patch = req.body as Partial<{ status: string }>

    try {
      const existing = await getPayment(id)
      if (!existing) return reply.status(404).send({ error: 'Payment not found' })

      const isLocal = existing.stripeSessionId.startsWith('local_')

      // H10 — only allow admin to mark a payment completed when it is a genuine
      // local (manual) payment, and never allow arbitrary status writes.
      const approve = patch.status === 'completed' && existing.status === 'pending' && isLocal

      // Revoke a completed (auto-activated) local payment -> rollback + trust-lock the user.
      const revoked = patch.status === 'refunded' && existing.status === 'completed' && isLocal

      if (!paymentStatusTransitionAllowed(existing.status as any, patch.status as any, isLocal)) {
        return reply.status(400).send({
          error: `Cannot change payment status from '${existing.status}' to '${patch.status ?? ''}' for ${isLocal ? 'local' : 'gateway'} payment ${id}`,
        })
      }

      if (approve) {
        const pkg = existing.packageId ? await getPackage(existing.packageId) : null
        if (pkg) {
          await activatePackage(existing.phone, pkg.slug, {
            tokens: existing.tokenCount || pkg.includedTokens,
            actor: req.adminEmail,
            description: `Local payment confirmed — ${pkg.name} (${existing.stripeSessionId})`,
          })
        }
        clearFeatureCache(existing.phone)
        const { notifyPayment } = await import('../../lib/notifications.js')
        await notifyPayment(existing.phone, existing.amountCents, pkg?.name || 'Package')
      }

      if (revoked) {
        await setConfig(`untrusted_local:${existing.phone}`, '1')
        const user = await getUser(existing.phone)
        // Only end the current package if it is the one this payment activated.
        if (user && user.packageStatus === 'active' && user.packageId === existing.packageId) {
          try {
            await endPackage(existing.phone, {
              actor: req.adminEmail,
              reason: `Local payment ${existing.stripeSessionId} revoked`,
            })
          } catch (err) {
            // no-op if the user/package has changed
          }
        }
        clearFeatureCache(existing.phone)
      }

      const payment = await updatePayment(id, patch as any)
      return reply.send({ payment, activated: approve, revoked })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.get('/api/admin/payments/stats', guard('payments.view'), async (req: any, reply: any) => {
    const payments = await listPayments()
    const completed = payments.filter(p => p.status === 'completed')
    const totalRevenue = completed.reduce((sum, p) => sum + p.amountCents, 0)
    const thisMonth = completed.filter(p => {
      const d = new Date(p.createdAt)
      const now = new Date()
      return d.getUTCMonth() === now.getUTCMonth() && d.getUTCFullYear() === now.getUTCFullYear()
    })
    const monthRevenue = thisMonth.reduce((sum, p) => sum + p.amountCents, 0)

    return reply.send({
      totalPayments: payments.length,
      completedPayments: completed.length,
      totalRevenue,
      monthRevenue,
    })
  })
}