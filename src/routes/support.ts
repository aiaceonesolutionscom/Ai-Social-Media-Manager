import { FastifyInstance } from 'fastify'
import { verifySession } from '../lib/userAuth.js'
import { createSupportTicket, getSupportTickets, getAllSupportTickets, updateSupportTicket } from '../store.js'
import { requireFeature } from '../lib/packagePermissions.js'
import { logger } from '../lib/logger.js'

async function requireUser(req: any): Promise<string | null> {
  const token = req.headers['authorization']?.replace('Bearer ', '') || ''
  if (!token) return null
  const session = await verifySession(token)
  return session?.phone || null
}

export async function registerSupportRoutes(server: FastifyInstance): Promise<void> {

  // Create support ticket (requires priority_support feature)
  server.post('/api/support/tickets', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      await requireFeature(phone, 'priority_support')
    } catch (err: any) {
      return reply.status(403).send({ error: err.message })
    }

    const { subject, message, priority } = req.body as { subject?: string; message?: string; priority?: string }
    if (!subject || !message) {
      return reply.status(400).send({ error: 'Subject and message are required' })
    }

    try {
      const ticket = await createSupportTicket({ phone, subject, message, priority })
      return reply.status(201).send({ ticket })
    } catch (err: any) {
      logger.error({ error: err.message, phone }, 'Failed to create support ticket')
      return reply.status(500).send({ error: `Database error: ${err.message}` })
    }
  })

  // Get user's support tickets
  server.get('/api/support/tickets', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      const tickets = await getSupportTickets(phone)
      return reply.send({ tickets })
    } catch (err: any) {
      logger.error({ error: err.message, phone }, 'Failed to get support tickets')
      return reply.status(500).send({ error: `Database error: ${err.message}` })
    }
  })

  // ---- Admin endpoints ----

  // Get all support tickets
  server.get('/api/admin/support/tickets', async (req: any, reply: any) => {
    try {
      const tickets = await getAllSupportTickets()
      return reply.send({ tickets })
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // Update support ticket (admin)
  server.put('/api/admin/support/tickets/:id', async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const { status, priority } = req.body as { status?: string; priority?: string }

    try {
      await updateSupportTicket(id, { status, priority })
      return reply.send({ success: true })
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })
}
