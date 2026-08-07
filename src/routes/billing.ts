import { FastifyInstance } from 'fastify'
import { billingEngine } from '../lib/BillingEngine.js'

export async function registerBillingRoutes(server: FastifyInstance): Promise<void> {

  server.get('/api/admin/billing/summary', async (_req: any, reply: any) => {
    try {
      const summary = await billingEngine.getSummary()
      return reply.send(summary)
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  server.get('/api/admin/billing/user/:phone', async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    try {
      const cost = await billingEngine.getUserCost(phone)
      return reply.send(cost)
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })
}
