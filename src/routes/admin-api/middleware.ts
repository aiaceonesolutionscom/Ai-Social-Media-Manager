import { verifyAdminToken } from '../../lib/adminAuth.js'

const PUBLIC_ADMIN_ROUTES = ['/api/admin/login', '/api/admin/logout']

export async function adminAuthMiddleware(req: any, reply: any): Promise<void> {
  try {
    if (!req.url.startsWith('/api/admin')) return
    if (PUBLIC_ADMIN_ROUTES.some(r => req.url.startsWith(r))) return

    const token = req.headers['authorization']?.replace('Bearer ', '') || ''

    if (!token) {
      return reply.status(401).send({ error: 'No token provided' })
    }

    const result = await verifyAdminToken(token)
    if (!result.valid) {
      return reply.status(401).send({ error: 'Invalid token' })
    }

    req.adminEmail = result.email
  } catch (err: any) {
    // Never let middleware errors crash the request
    return reply.status(401).send({ error: 'Authentication failed' })
  }
}
