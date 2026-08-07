import { FastifyInstance } from 'fastify'
import { getPool } from '../db.js'
import { jobQueue } from '../lib/queue/JobQueue.js'
import { providerManager } from '../lib/ai/providerManager.js'
import { metaConfig } from '../lib/metaConfig.js'

export async function registerHealthRoutes(server: FastifyInstance): Promise<void> {

  server.get('/health', async (_req: any, reply: any) => {
    const checks: Record<string, { status: string; latencyMs?: number; message?: string }> = {}
    let overallHealthy = true

    // Database check
    const dbStart = Date.now()
    try {
      const pool = getPool()
      await pool.query('SELECT 1')
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart }
    } catch (err) {
      checks.database = { status: 'error', message: (err as Error).message }
      overallHealthy = false
    }

    // Job queue check
    try {
      const stats = jobQueue.getStats()
      checks.queue = { status: 'ok', message: `pending: ${stats.pending}, processing: ${stats.processing}, failed: ${stats.failed}` }
    } catch (err) {
      checks.queue = { status: 'error', message: (err as Error).message }
    }

    // AI providers check
    try {
      const providerStatus = providerManager.getStatus()
      checks.aiProviders = { status: 'ok', message: `STT: ${providerStatus.stt}, LLM: ${providerStatus.llm}, Image: ${providerStatus.image}` }
    } catch (err) {
      checks.aiProviders = { status: 'error', message: (err as Error).message }
    }

    // Meta config check
    try {
      const metaStatus = metaConfig.getStatus()
      checks.meta = { status: metaStatus.configured ? 'ok' : 'not_configured', message: `App: ${metaStatus.appId}, WhatsApp: ${metaStatus.whatsappConnected}` }
    } catch (err) {
      checks.meta = { status: 'error', message: (err as Error).message }
    }

    const statusCode = overallHealthy ? 200 : 503
    return reply.status(statusCode).send({
      status: overallHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    })
  })

  server.get('/health/ready', async (_req: any, reply: any) => {
    try {
      const pool = getPool()
      await pool.query('SELECT 1')
      return reply.send({ status: 'ready' })
    } catch {
      return reply.status(503).send({ status: 'not_ready' })
    }
  })

  server.get('/health/live', async (_req: any, reply: any) => {
    return reply.send({ status: 'alive' })
  })
}
