import { FastifyInstance } from 'fastify'
import { adminLogin, verifyAdminToken, adminLogout, allPermissionKeys, changeAdminPassword } from '../../lib/adminAuth.js'
import { rateLimit } from '../../lib/ratelimit.js'
import { getAdminUserByEmail, updateAdminUser } from '../../store.js'
import { auditLogger } from '../../lib/AuditLogger.js'

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

    return reply.send({
      email: result.email,
      name: result.name,
      role: result.role,
      permissions: result.role === 'super_admin' ? allPermissionKeys() : (result.permissions || []),
    })
  })

  // Self-service profile: update own name and/or password. Does NOT require admins.update.
  server.put('/api/admin/profile', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    const result = await verifyAdminToken(token)
    if (!result.valid || !result.email) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const { name, currentPassword, newPassword } = req.body as {
      name?: string
      currentPassword?: string
      newPassword?: string
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return reply.status(400).send({ error: 'Name must be a non-empty string' })
    }

    if (newPassword) {
      if (!currentPassword) {
        return reply.status(400).send({ error: 'currentPassword is required to change your password' })
      }
      if (newPassword.length < 8) {
        return reply.status(400).send({ error: 'New password must be at least 8 characters' })
      }
      const pwResult = await changeAdminPassword(result.email, currentPassword, newPassword)
      if (!pwResult.success) {
        return reply.status(400).send({ error: pwResult.error })
      }
    }

    if (name !== undefined && name.trim() !== (result.name || '')) {
      const admin = await getAdminUserByEmail(result.email)
      if (!admin) {
        return reply.status(404).send({ error: 'Admin not found' })
      }
      await updateAdminUser(admin.id, { name: name.trim() })
    }

    auditLogger.log({ actor: result.email, actorType: 'admin', action: 'admin.profile_update', target: result.email })

    return reply.send({
      email: result.email,
      name: (name !== undefined && name.trim() !== (result.name || '')) ? name.trim() : result.name,
    })
  })
}
