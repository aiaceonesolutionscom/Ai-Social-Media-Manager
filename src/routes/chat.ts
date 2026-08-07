import crypto from 'node:crypto'
import { FastifyInstance } from 'fastify'
import { verifySession } from '../lib/userAuth.js'
import { getAccountByPlatform, getMessages } from '../store.js'
import { requireFeature } from '../lib/packagePermissions.js'
import { handleUserInput } from '../pipeline/conversation.js'
import { logger } from '../lib/logger.js'

async function requireUser(req: any): Promise<string | null> {
  const token = req.headers['authorization']?.replace('Bearer ', '') || ''
  if (!token) return null
  const session = await verifySession(token)
  return session?.phone || null
}

// The website chat mirrors the same conversation as WhatsApp: when the user has a
// connected WhatsApp number we use its accountId as the conversation key (shared with
// WhatsApp), otherwise we fall back to the canonical user phone (web-only conversation).
async function resolveChatPhone(userPhone: string): Promise<string> {
  const wa = await getAccountByPlatform(userPhone, 'whatsapp')
  return wa?.accountId || userPhone
}

export async function registerChatRoutes(server: FastifyInstance): Promise<void> {

  // Get the user's chat messages (the WhatsApp bot conversation, mirror via web)
  server.get('/api/chat/messages', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      const chatPhone = await resolveChatPhone(phone)
      const messages = await getMessages(chatPhone)
      return reply.send({ messages })
    } catch (err: any) {
      logger.error({ error: err.message, phone }, 'Failed to get chat messages')
      return reply.status(500).send({ error: `Database error: ${err.message}` })
    }
  })

  // Send a text message from the website dashboard chat (text only, no voice)
  server.post('/api/chat', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      await requireFeature(phone, 'web_chat')
    } catch (err: any) {
      return reply.status(403).send({ error: err.message })
    }

    const { message } = req.body as { message?: string }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return reply.status(400).send({ error: 'message is required' })
    }

    const chatPhone = await resolveChatPhone(phone)
    try {
      await handleUserInput(chatPhone, message.trim(), { waMsgId: `web_${Date.now()}_${crypto.randomUUID()}` })
      return reply.send({ ok: true })
    } catch (err: any) {
      logger.error({ error: err.message, phone }, 'Failed to process chat message')
      return reply.status(500).send({ error: `Failed to process message: ${err.message}` })
    }
  })
}
