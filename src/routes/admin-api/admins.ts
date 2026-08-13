import { FastifyInstance } from 'fastify'
import { listAdminUsers, getAdminUser, createAdminUser, updateAdminUser, deleteAdminUser } from '../../store.js'
import { hashAdminPassword, allPermissionKeys, invalidateAdminSessions } from '../../lib/adminAuth.js'
import { guard } from './middleware.js'
import { auditLogger } from '../../lib/AuditLogger.js'

export const ADMIN_ROLES = ['super_admin', 'admin']

function sanitize(admin: any) {
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    permissions: admin.permissions,
    isActive: admin.isActive,
    createdAt: admin.createdAt,
    lastLoginAt: admin.lastLoginAt,
  }
}

export async function registerAdminAdminsRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/admin/admins', guard('admins.view'), async (_req: any, reply: any) => {
    const admins = await listAdminUsers()
    return reply.send({
      admins: admins.map(sanitize),
      roles: ADMIN_ROLES,
      allPermissions: allPermissionKeys(),
    })
  })

  server.post('/api/admin/admins', guard('admins.create'), async (req: any, reply: any) => {
    const { name, email, password, role, permissions } = req.body as {
      name: string
      email: string
      password: string
      role?: string
      permissions?: string[]
    }

    if (!name || !email || !password) {
      return reply.status(400).send({ error: 'Name, email and password are required' })
    }

    const targetRole = (role || 'admin') as 'admin' | 'super_admin'
    if (targetRole === 'super_admin' && req.adminRole !== 'super_admin') {
      return reply.status(403).send({ error: 'Only super admins can create super admins' })
    }

    const perms = Array.isArray(permissions) ? permissions.filter(p => allPermissionKeys().includes(p)) : []

    try {
      const admin = await createAdminUser({
        email,
        name,
        passwordHash: await hashAdminPassword(password),
        role: targetRole,
        permissions: perms,
        createdBy: req.adminEmail,
      })
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'admins.create', target: email, details: { role: targetRole, permissions: perms } })
      return reply.status(201).send({ admin: sanitize(admin) })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.put('/api/admin/admins/:id', guard('admins.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const { name, role, permissions, password, isActive } = req.body as {
      name?: string
      role?: string
      permissions?: string[]
      password?: string
      isActive?: boolean
    }

    const target = await getAdminUser(id)
    if (!target) {
      return reply.status(404).send({ error: 'Admin not found' })
    }

    const isSuperTarget = target.role === 'super_admin'
    const isSelf = target.email === req.adminEmail

    if (isSuperTarget && req.adminRole !== 'super_admin') {
      return reply.status(403).send({ error: 'Only super admins can manage super admins' })
    }
    if (isSuperTarget && role && role !== 'super_admin') {
      return reply.status(403).send({ error: 'Cannot demote a super admin' })
    }
    if (role === 'super_admin' && req.adminRole !== 'super_admin') {
      return reply.status(403).send({ error: 'Only super admins can assign this role' })
    }
    if (isSelf && req.adminRole !== 'super_admin' && (permissions !== undefined || role !== undefined)) {
      return reply.status(403).send({ error: 'You cannot change your own role or permissions' })
    }
    if (isSelf && isActive === false) {
      return reply.status(400).send({ error: 'You cannot deactivate your own account' })
    }

    const perms = Array.isArray(permissions) ? permissions.filter(p => allPermissionKeys().includes(p)) : permissions

    const changesPrivileges =
      (permissions !== undefined && JSON.stringify(perms) !== JSON.stringify(target.permissions)) ||
      (role !== undefined && role !== target.role) ||
      isActive === false

    try {
      const admin = await updateAdminUser(id, {
        name,
        role: role as 'admin' | 'super_admin' | undefined,
        permissions: perms,
        passwordHash: password ? await hashAdminPassword(password) : undefined,
        isActive,
      })
      if (changesPrivileges) {
        await invalidateAdminSessions(target.email)
      }
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'admins.update', target: target.email, details: { role: role || target.role } })
      return reply.send({ admin: sanitize(admin) })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.delete('/api/admin/admins/:id', guard('admins.delete'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const target = await getAdminUser(id)
    if (!target) {
      return reply.status(404).send({ error: 'Admin not found' })
    }

    if (target.email === req.adminEmail) {
      return reply.status(400).send({ error: 'You cannot delete your own account' })
    }
    if (target.role === 'super_admin') {
      if (req.adminRole !== 'super_admin') {
        return reply.status(403).send({ error: 'Only super admins can delete super admins' })
      }
      const superAdmins = (await listAdminUsers()).filter(a => a.role === 'super_admin' && a.isActive)
      if (superAdmins.length <= 1) {
        return reply.status(400).send({ error: 'Cannot delete the last super admin' })
      }
    }

    try {
      await deleteAdminUser(id)
      await invalidateAdminSessions(target.email)
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'admins.delete', target: target.email })
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })
}
