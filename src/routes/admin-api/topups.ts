import { FastifyInstance } from 'fastify'
import { listTopUpBundles, getTopUpBundle, createTopUpBundle, updateTopUpBundle, deleteTopUpBundle } from '../../store.js'
import { guard } from './middleware.js'
import { auditLogger } from '../../lib/AuditLogger.js'

export async function registerAdminTopUpRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/admin/topups', guard('topups.view'), async (_req: any, reply: any) => {
    const bundles = await listTopUpBundles()
    return reply.send({ bundles })
  })

  server.get('/api/admin/topups/:id', guard('topups.view'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const bundle = await getTopUpBundle(id)
    if (!bundle) return reply.status(404).send({ error: 'Top-up bundle not found' })
    return reply.send({ bundle })
  })

  server.post('/api/admin/topups', guard('topups.create'), async (req: any, reply: any) => {
    const { tokens, priceCents, sortOrder } = req.body as {
      tokens?: number
      priceCents?: number
      sortOrder?: number
    }

    if (!tokens || tokens <= 0 || !priceCents || priceCents <= 0) {
      return reply.status(400).send({ error: 'Tokens and price are required' })
    }

    try {
      const bundle = await createTopUpBundle({ tokens, priceCents, sortOrder })
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'topups.create', target: String(tokens), details: { priceCents } })
      return reply.status(201).send({ bundle })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.put('/api/admin/topups/:id', guard('topups.create'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const patch = req.body as Partial<{
      tokens: number
      priceCents: number
      isActive: boolean
      sortOrder: number
    }>

    try {
      const bundle = await updateTopUpBundle(id, patch)
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'topups.update', target: id })
      return reply.send({ bundle })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.delete('/api/admin/topups/:id', guard('topups.create'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    try {
      await deleteTopUpBundle(id)
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'topups.delete', target: id })
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })
}
