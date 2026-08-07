import { eq, desc } from 'drizzle-orm'
import { getDb } from '../db.js'
import { webhookEvents } from '../db/schema.js'
import { logger } from './logger.js'

export type WebhookSource = 'whatsapp' | 'stripe' | 'meta'
export type WebhookStatus = 'received' | 'processing' | 'completed' | 'failed' | 'retrying'

export interface WebhookEventEntry {
  source: WebhookSource
  eventType: string
  payload: Record<string, unknown>
  headers?: Record<string, string>
  status: WebhookStatus
  responseCode?: number
  error?: string
  retryCount?: number
}

class WebhookLogger {
  async log(entry: WebhookEventEntry): Promise<void> {
    const now = new Date().toISOString()
    try {
      await getDb().insert(webhookEvents).values({
        id: crypto.randomUUID(),
        source: entry.source,
        eventType: entry.eventType,
        payload: entry.payload,
        headers: entry.headers || {},
        status: entry.status,
        responseCode: entry.responseCode,
        error: entry.error || null,
        retryCount: entry.retryCount || 0,
        createdAt: now,
      })
    } catch (err) {
      logger.error({ err, entry }, 'failed to log webhook event')
    }
  }

  async updateStatus(id: string, status: WebhookStatus, responseCode?: number, error?: string): Promise<void> {
    await getDb()
      .update(webhookEvents)
      .set({ status, responseCode, error: error || null })
      .where(eq(webhookEvents.id, id))
  }

  async getRecent(limit = 50): Promise<Array<typeof webhookEvents.$inferSelect>> {
    return getDb().select().from(webhookEvents).orderBy(desc(webhookEvents.createdAt)).limit(limit)
  }

  async getFailed(limit = 20): Promise<Array<typeof webhookEvents.$inferSelect>> {
    return getDb()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.status, 'failed'))
      .orderBy(desc(webhookEvents.createdAt))
      .limit(limit)
  }

  async getStats(): Promise<{
    total: number
    completed: number
    failed: number
    processing: number
    bySource: Record<string, number>
  }> {
    const all = await getDb().select().from(webhookEvents)
    const bySource: Record<string, number> = {}
    for (const event of all) {
      bySource[event.source] = (bySource[event.source] || 0) + 1
    }
    return {
      total: all.length,
      completed: all.filter((e) => e.status === 'completed').length,
      failed: all.filter((e) => e.status === 'failed').length,
      processing: all.filter((e) => e.status === 'processing').length,
      bySource,
    }
  }
}

export const webhookLogger = new WebhookLogger()
