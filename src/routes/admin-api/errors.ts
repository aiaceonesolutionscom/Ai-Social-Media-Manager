import { FastifyInstance } from 'fastify'
import { listErrorLogs, countErrorLogs, clearErrorLogs, markErrorLogResolved, autoResolveErrorLogs } from '../../store.js'
import { guard } from './middleware.js'

export async function registerAdminErrorRoutes(server: FastifyInstance): Promise<void> {

  server.get('/api/admin/errors', guard('logs.view'), async (req: any, reply: any) => {
    const { source, resolved, page = '1', limit = '50' } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
    const offset = (pageNum - 1) * limitNum

    try {
      // Auto-resolve stale errors on each listing
      await autoResolveErrorLogs().catch(() => 0)
      const resolvedFilter = resolved === 'true' ? true : resolved === 'false' ? false : undefined
      const [logs, total] = await Promise.all([
        listErrorLogs({ source: source || undefined, resolved: resolvedFilter, limit: limitNum, offset }),
        countErrorLogs(),
      ])
      return reply.send({ logs, total, page: pageNum, limit: limitNum })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  server.patch('/api/admin/errors/:id/resolve', guard('logs.view'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const { resolved } = req.body as { resolved?: boolean }
    try {
      const updated = await markErrorLogResolved(id, resolved !== false)
      if (!updated) return reply.status(404).send({ error: 'Error log not found' })
      return reply.send({ success: true, log: updated })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  server.delete('/api/admin/errors', guard('logs.view'), async (_req: any, reply: any) => {
    try {
      await clearErrorLogs()
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })
}