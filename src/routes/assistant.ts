import { FastifyInstance } from 'fastify'
import { answerQuery } from '../lib/AssistantService.js'
import { rateLimit } from '../lib/ratelimit.js'

const MAX_QUERY_LENGTH = 500

export async function registerAssistantRoutes(server: FastifyInstance): Promise<void> {
  const handle = async (req: any, reply: any) => {
    const q: string = (req.query?.q || req.body?.q || req.body?.message || '').toString().trim()

    // H17 — input cap: reject oversized queries without processing them.
    if (q.length > MAX_QUERY_LENGTH) {
      return reply.status(400).send({ error: `Query too long (max ${MAX_QUERY_LENGTH} characters)` })
    }

    // H17 — rate limit by client IP so the public endpoint cannot be spammed.
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown'
    const limit = rateLimit(`assistant:${ip}`, { windowMs: 60 * 1000, max: 20 })
    if (!limit.allowed) {
      return reply.status(429).send({ error: 'Too many requests, please try again later' })
    }

    return reply.send(await answerQuery(q))
  }

  server.get('/api/public/assistant', handle)
  server.post('/api/public/assistant', handle)
}