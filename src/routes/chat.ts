import crypto from 'node:crypto'
import { FastifyInstance } from 'fastify'
import { verifySession } from '../lib/userAuth.js'
import { getAccountByPlatform, getMessages, getChatThread, createChatThread, listChatThreads, threadPhoneKey } from '../store.js'
import { requireFeature } from '../lib/packagePermissions.js'
import { checkUserAccess } from '../lib/auth.js'
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

  // List the user's web chat sessions (New Chat history).
  server.get('/api/chat/threads', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })
    try {
      const threads = await listChatThreads(phone)
      return reply.send({ threads })
    } catch (err: any) {
      logger.error({ error: err.message, phone }, 'Failed to list chat threads')
      return reply.status(500).send({ error: `Database error: ${err.message}` })
    }
  })

  // Create a new web chat session.
  server.post('/api/chat/threads', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })
    try {
      const thread = await createChatThread(phone)
      return reply.send({ thread })
    } catch (err: any) {
      logger.error({ error: err.message, phone }, 'Failed to create chat thread')
      return reply.status(500).send({ error: `Database error: ${err.message}` })
    }
  })

  // Get the user's chat messages. With ?threadId= it returns that web session's
  // messages; without it, the WhatsApp-shared conversation (mirror via web).
  server.get('/api/chat/messages', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      const threadId = (req.query as { threadId?: string }).threadId
      if (threadId) {
        const thread = await getChatThread(threadId)
        if (!thread || thread.phone !== phone) {
          return reply.status(404).send({ error: 'Thread not found' })
        }
        const messages = await getMessages(threadPhoneKey(threadId))
        return reply.send({ messages })
      }
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

    // Same access gate as WhatsApp: only active users with tokens remaining may use the assistant.
    const access = await checkUserAccess(phone)
    if (!access.allowed) {
      if (access.reason === 'no_tokens') {
        return reply.status(403).send({ error: 'No tokens remaining. Please upgrade your plan or buy more tokens.' })
      }
      if (access.reason === 'deactivated') {
        return reply.status(403).send({ error: 'Your account has been deactivated. Please contact admin for assistance.' })
      }
      return reply.status(403).send({ error: 'You are not registered. Please contact admin to get access.' })
    }

    const { message, threadId } = req.body as { message?: string; threadId?: string }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return reply.status(400).send({ error: 'message is required' })
    }

    let chatPhone: string
    if (threadId) {
      const thread = await getChatThread(threadId)
      if (!thread || thread.phone !== phone) {
        return reply.status(404).send({ error: 'Thread not found' })
      }
      chatPhone = threadPhoneKey(threadId)
    } else {
      chatPhone = await resolveChatPhone(phone)
    }
    try {
      await handleUserInput(chatPhone, message.trim(), { waMsgId: `web_${Date.now()}_${crypto.randomUUID()}`, channel: 'webchat' })
      return reply.send({ ok: true })
    } catch (err: any) {
      logger.error({ error: err.message, phone }, 'Failed to process chat message')
      return reply.status(500).send({ error: `Failed to process message: ${err.message}` })
    }
  })
}
