import { FastifyInstance } from 'fastify'
import { getDb } from '../../db.js'
import { auditLogs } from '../../db/schema.js'
import { desc, eq, like, and } from 'drizzle-orm'
import { guard } from './middleware.js'

export async function registerAdminAuditRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/admin/audit-logs', guard('logs.view'), async (req: any, reply: any) => {
    const { action, actor, phone, page = '1', limit = '50' } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
    const offset = (pageNum - 1) * limitNum

    try {
      const db = getDb()
      const conditions: any[] = []
      if (action) conditions.push(eq(auditLogs.action, action))
      if (actor) conditions.push(like(auditLogs.actor, `%${actor}%`))
      if (phone) conditions.push(like(auditLogs.target, `%${phone}%`))

      const where = conditions.length ? and(...conditions) : undefined

      const [rows, countRow] = await Promise.all([
        db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limitNum).offset(offset),
        db.select({ count: auditLogs.id }).from(auditLogs).where(where),
      ])

      return reply.send({
        logs: rows,
        total: countRow.length,
        page: pageNum,
        limit: limitNum,
      })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })
}
