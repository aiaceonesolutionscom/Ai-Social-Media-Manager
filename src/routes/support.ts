import { FastifyInstance } from 'fastify'
import { guard } from './admin-api/middleware.js'
import { verifySession } from '../lib/userAuth.js'
import {
  createSupportTicket,
  getSupportTickets,
  getAllSupportTickets,
  updateSupportTicket,
  getSupportTicket,
  createSupportReply,
  getSupportReplies,
  listAllSupportReplies,
  getAccountByPlatform,
} from '../store.js'
import { requireFeature } from '../lib/packagePermissions.js'
import { sendText } from '../lib/whatsapp.js'
import { logger } from '../lib/logger.js'

async function requireUser(req: any): Promise<string | null> {
  const token = req.headers['authorization']?.replace('Bearer ', '') || ''
  if (!token) return null
  const session = await verifySession(token)
  return session?.phone || null
}

async function resolvePushNumber(phone: string): Promise<string> {
  const wa = await getAccountByPlatform(phone, 'whatsapp')
  return wa?.accountId || phone
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
      const replies = await listAllSupportReplies(tickets.map((t) => t.id))
      const withReplies = tickets.map((t) => ({ ...t, replies: replies[t.id] || [] }))
      return reply.send({ tickets: withReplies })
    } catch (err: any) {
      logger.error({ error: err.message, phone }, 'Failed to get support tickets')
      return reply.status(500).send({ error: `Database error: ${err.message}` })
    }
  })

  // Get a single support ticket (with thread) — ownership required
  server.get('/api/support/tickets/:id', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    const { id } = req.params as { id: string }
    const ticket = await getSupportTicket(id)
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' })
    if (ticket.phone !== phone) return reply.status(403).send({ error: 'Forbidden' })

    const replies = await getSupportReplies(id)
    return reply.send({ ticket: { ...ticket, replies } })
  })

  // Reply to a ticket (user side, keeps the thread alive)
  server.post('/api/support/tickets/:id/reply', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    const { id } = req.params as { id: string }
    const ticket = await getSupportTicket(id)
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' })
    if (ticket.phone !== phone) return reply.status(403).send({ error: 'Forbidden' })

    const { message } = req.body as { message?: string }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return reply.status(400).send({ error: 'Message is required' })
    }

    const replyRecord = await createSupportReply({ ticketId: id, role: 'user', body: message.trim() })
    await updateSupportTicket(id, { status: 'open' })
    return reply.status(201).send({ reply: replyRecord })
  })

  // ---- Admin endpoints ----

  // Get all support tickets (with reply threads)
  server.get('/api/admin/support/tickets', guard('support.view'), async (req: any, reply: any) => {
    try {
      const tickets = await getAllSupportTickets()
      const replies = await listAllSupportReplies(tickets.map((t) => t.id))
      const withReplies = tickets.map((t) => ({ ...t, replies: replies[t.id] || [] }))
      return reply.send({ tickets: withReplies })
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // Get a single support ticket (with thread)
  server.get('/api/admin/support/tickets/:id', guard('support.view'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const ticket = await getSupportTicket(id)
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' })
    const replies = await getSupportReplies(id)
    return reply.send({ ticket: { ...ticket, replies } })
  })

  // Update support ticket (admin)
  server.put('/api/admin/support/tickets/:id', guard('support.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const { status, priority } = req.body as { status?: string; priority?: string }

    try {
      await updateSupportTicket(id, { status, priority })
      return reply.send({ success: true })
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // Reply to a support ticket (admin). Saves the reply and pushes it to the user on WhatsApp.
  server.post('/api/admin/support/tickets/:id/reply', guard('support.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const { message } = req.body as { message?: string }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return reply.status(400).send({ error: 'Message is required' })
    }

    try {
      const ticket = await getSupportTicket(id)
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' })

      const replyRecord = await createSupportReply({ ticketId: id, role: 'admin', body: message.trim() })
      await updateSupportTicket(id, { status: 'replied' })

      const pushNumber = await resolvePushNumber(ticket.phone)
      try {
        await sendText(
          pushNumber,
          `📨 Support reply on "${ticket.subject}":\n\n${message.trim()}\n\nReply to this message or open the Support page in your dashboard to continue the conversation.`,
        )
      } catch (pushErr) {
        logger.warn({ ticketId: id, error: (pushErr as Error).message }, 'failed to push support reply via WhatsApp')
      }

      return reply.status(201).send({ reply: replyRecord })
    } catch (err: any) {
      logger.error({ ticketId: id, error: err.message }, 'admin support reply failed')
      return reply.status(500).send({ error: err.message })
    }
  })
}
