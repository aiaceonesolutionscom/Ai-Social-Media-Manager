import { FastifyInstance } from 'fastify'
import { guard } from './admin-api/middleware.js'
import { verifySession } from '../lib/userAuth.js'
import { listNotifications, countUnreadNotifications, markNotificationRead, markAllNotificationsRead } from '../store.js'

async function requireUser(req: any): Promise<string | null> {
  const token = req.headers['authorization']?.replace('Bearer ', '') || ''
  if (!token) return null
  const session = await verifySession(token)
  return session?.phone || null
}

export async function registerNotificationRoutes(server: FastifyInstance): Promise<void> {

  // ---- Admin ----

  server.get('/api/admin/notifications', guard('logs.view'), async (req: any, reply: any) => {
    const { unread } = req.query as { unread?: string }
    try {
      const notifications = await listNotifications({
        targetType: 'admin',
        unreadOnly: unread === 'true',
        limit: 100,
      })
      const unreadCount = await countUnreadNotifications({ targetType: 'admin' })
      return reply.send({ notifications, unreadCount })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  server.post('/api/admin/notifications/:id/read', guard('logs.view'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const marked = await markNotificationRead(id, { targetType: 'admin' })
    if (!marked) return reply.status(404).send({ error: 'Notification not found' })
    return reply.send({ success: true })
  })

  server.post('/api/admin/notifications/read-all', guard('logs.view'), async (_req: any, reply: any) => {
    await markAllNotificationsRead({ targetType: 'admin' })
    return reply.send({ success: true })
  })

  // ---- User ----

  server.get('/api/notifications', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    const { unread } = req.query as { unread?: string }
    try {
      const notifications = await listNotifications({
        targetType: 'user',
        targetPhone: phone,
        unreadOnly: unread === 'true',
        limit: 100,
      })
      const unreadCount = await countUnreadNotifications({ targetType: 'user', targetPhone: phone })
      return reply.send({ notifications, unreadCount })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  server.post('/api/notifications/:id/read', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    const { id } = req.params as { id: string }
    const marked = await markNotificationRead(id, { targetType: 'user', targetPhone: phone })
    if (!marked) return reply.status(404).send({ error: 'Notification not found' })
    return reply.send({ success: true })
  })

  server.post('/api/notifications/read-all', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    await markAllNotificationsRead({ targetType: 'user', targetPhone: phone })
    return reply.send({ success: true })
  })
}