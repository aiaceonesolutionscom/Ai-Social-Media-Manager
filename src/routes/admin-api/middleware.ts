import { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAdminToken, hasPermission } from '../../lib/adminAuth.js'

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
    req.adminName = result.name
    req.adminRole = result.role
    req.adminPermissions = result.permissions || []
    req.adminProfile = result
  } catch (err: any) {
    // Never let middleware errors crash the request
    return reply.status(401).send({ error: 'Authentication failed' })
  }
}

/**
 * Route-level permission guard. Attach after a route group's handler definitions
 * (or call inside each handler). Super admins bypass all checks.
 */
export function requirePermission(permission: string) {
  return async (req: any, reply: any): Promise<void> => {
    if (req.adminRole === 'super_admin') return
    if (!req.adminProfile || !hasPermission(req.adminProfile, permission)) {
      return reply.status(403).send({ error: `Access denied: missing "${permission}" permission` })
    }
  }
}

/**
 * Fastify route options wrapper: server.get('/path', guard('users.view'), handler)
 */
export function guard(permission: string): { preHandler: any[] } {
  return { preHandler: [requirePermission(permission)] }
}

export type { FastifyRequest, FastifyReply }
