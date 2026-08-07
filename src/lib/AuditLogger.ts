import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db.js'
import { auditLogs } from '../db/schema.js'
import { logger } from './logger.js'

export interface AuditEntry {
  actor: string
  actorType?: 'user' | 'admin'
  action: string
  target?: string
  targetType?: string
  details?: Record<string, unknown>
  ip?: string
}

class AuditLogger {
  async log(entry: AuditEntry): Promise<void> {
    const now = new Date().toISOString()
    try {
      await getDb().insert(auditLogs).values({
        id: crypto.randomUUID(),
        actor: entry.actor,
        actorType: entry.actorType || 'user',
        action: entry.action,
        target: entry.target || null,
        targetType: entry.targetType || null,
        details: entry.details || {},
        ip: entry.ip || null,
        createdAt: now,
      })
    } catch (err) {
      logger.error({ err, entry }, 'failed to write audit log')
    }
  }

  async getRecent(limit = 50): Promise<Array<typeof auditLogs.$inferSelect>> {
    const db = getDb()
    return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit)
  }

  async getByActor(actor: string, limit = 50): Promise<Array<typeof auditLogs.$inferSelect>> {
    const db = getDb()
    return db.select().from(auditLogs).where(eq(auditLogs.actor, actor)).orderBy(desc(auditLogs.createdAt)).limit(limit)
  }

  async getByAction(action: string, limit = 50): Promise<Array<typeof auditLogs.$inferSelect>> {
    const db = getDb()
    return db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(desc(auditLogs.createdAt)).limit(limit)
  }
}

export const auditLogger = new AuditLogger()
