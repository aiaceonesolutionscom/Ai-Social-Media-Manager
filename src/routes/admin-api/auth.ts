import { FastifyInstance } from 'fastify'
import { adminLogin, verifyAdminToken, adminLogout } from '../../lib/adminAuth.js'
import { rateLimit } from '../../lib/ratelimit.js'

export async function registerAdminAuthRoutes(server: FastifyInstance): Promise<void> {
  server.post('/api/admin/login', async (req: any, reply: any) => {
    const { allowed, remaining } = rateLimit(`admin:${req.ip}`, { windowMs: 5 * 60 * 1000, max: 5 })
    if (!allowed) {
      return reply.status(429).send({ error: 'Too many login attempts. Please try again later.' })
    }

    const { email, password } = req.body as { email: string; password: string }

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' })
    }

    const result = await adminLogin(email, password)
    if (!result.success) {
      return reply.status(401).send({ error: result.error })
    }

    return reply.send({ token: result.token, email, remaining })
  })

  server.post('/api/admin/logout', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    await adminLogout(token)
    return reply.send({ success: true })
  })

  server.get('/api/admin/me', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    const result = await verifyAdminToken(token)

    if (!result.valid) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    return reply.send({ email: result.email })
  })
}
