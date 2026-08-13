import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { config } from '../config.js'
import { logger } from './logger.js'
import { getConfig, setConfig, getAdminUserByEmail, createAdminUser, updateAdminUser, touchAdminLogin } from '../store.js'
import { auditLogger } from './AuditLogger.js'

const ADMIN_SESSIONS_KEY = 'admin_sessions'

const SALT_ROUNDS = 10
const SESSION_HOURS = 24

export interface AdminProfile {
  email: string
  name: string
  role: 'super_admin' | 'admin'
  permissions: string[]
}

export const ALL_PERMISSIONS: Array<{ section: string; actions: Array<{ key: string; label: string }> }> = [
  { section: 'Dashboard', actions: [{ key: 'dashboard.view', label: 'View dashboard' }] },
  { section: 'User Management', actions: [
    { key: 'users.view', label: 'View users' },
    { key: 'users.create', label: 'Create users' },
    { key: 'users.update', label: 'Update users' },
    { key: 'users.delete', label: 'Delete users' },
  ] },
  { section: 'Package Management', actions: [
    { key: 'packages.view', label: 'View packages' },
    { key: 'packages.create', label: 'Create packages' },
    { key: 'packages.update', label: 'Update packages' },
    { key: 'packages.delete', label: 'Delete packages' },
  ] },
  { section: 'Payments / Finance', actions: [
    { key: 'payments.view', label: 'View payments' },
  ] },
  { section: 'Top-ups', actions: [
    { key: 'topups.view', label: 'View top-up bundles' },
    { key: 'topups.create', label: 'Create / grant top-ups' },
  ] },
  { section: 'Reports', actions: [{ key: 'reports.view', label: 'View reports' }] },
  { section: 'AI Providers', actions: [
    { key: 'ai_providers.view', label: 'View AI providers' },
    { key: 'ai_providers.update', label: 'Update AI providers' },
  ] },
  { section: 'Meta Platform', actions: [
    { key: 'meta.view', label: 'View Meta settings' },
    { key: 'meta.update', label: 'Update Meta settings' },
  ] },
  { section: 'Support', actions: [
    { key: 'support.view', label: 'View support tickets' },
    { key: 'support.update', label: 'Reply to tickets' },
  ] },
  { section: 'Settings', actions: [
    { key: 'settings.view', label: 'View settings' },
    { key: 'settings.update', label: 'Update settings' },
  ] },
]

export function allPermissionKeys(): string[] {
  return ALL_PERMISSIONS.flatMap((s) => s.actions.map((a) => a.key))
}

export async function hashAdminPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

/**
 * Ensure the environment-configured admin (ADMIN_EMAIL/ADMIN_PASSWORD) exists as a
 * super admin with full access. Called once at server startup.
 */
export async function bootstrapSuperAdmin(): Promise<void> {
  const email = config.admin.email.toLowerCase()
  const existing = await getAdminUserByEmail(email)
  if (existing) {
    if (existing.role !== 'super_admin') {
      await updateAdminUser(existing.id, {
        role: 'super_admin',
        permissions: allPermissionKeys(),
        isActive: true,
      })
      logger.info({ email }, 'promoted env admin to super admin')
    }
    return
  }
  await createAdminUser({
    email,
    name: 'Super Admin',
    passwordHash: await hashAdminPassword(config.admin.password),
    role: 'super_admin',
    permissions: allPermissionKeys(),
    createdBy: 'system',
  })
  logger.info({ email }, 'bootstrapped super admin')
}

function profileFromSession(session: AdminSession): AdminProfile {
  return {
    email: session.email,
    name: session.name || '',
    role: session.role || 'admin',
    permissions: Array.isArray(session.permissions) ? session.permissions : [],
  }
}

export interface AdminSession {
  email: string
  name: string
  role: 'super_admin' | 'admin'
  permissions: string[]
  createdAt: string
  expiresAt: string
}

async function readSessions(): Promise<Record<string, AdminSession>> {
  const json = await getConfig(ADMIN_SESSIONS_KEY)
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, AdminSession>
  } catch {
    return {}
  }
}

async function writeSessions(sessions: Record<string, AdminSession>): Promise<void> {
  await setConfig(ADMIN_SESSIONS_KEY, JSON.stringify(sessions))
}

export async function adminLogin(email: string, password: string): Promise<{ success: boolean; token?: string; error?: string }> {
  const admin = await getAdminUserByEmail(email)
  if (!admin) {
    return { success: false, error: 'Invalid email or password' }
  }
  if (!admin.isActive) {
    return { success: false, error: 'This admin account is disabled' }
  }

  const valid = await bcrypt.compare(password, admin.passwordHash)
  if (!valid) {
    return { success: false, error: 'Invalid email or password' }
  }

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString()

  const sessions = await readSessions()
  sessions[token] = {
    email: admin.email,
    name: admin.name,
    role: admin.role,
    permissions: admin.role === 'super_admin' ? allPermissionKeys() : admin.permissions,
    createdAt: new Date().toISOString(),
    expiresAt,
  }
  await writeSessions(sessions)
  await touchAdminLogin(admin.id)
  auditLogger.log({ actor: admin.email, actorType: 'admin', action: 'admin.login', target: admin.email, details: { name: admin.name, role: admin.role } })
  logger.info({ email }, 'admin logged in')
  return { success: true, token }
}

export async function verifyAdminToken(token: string): Promise<{ valid: boolean } & Partial<AdminProfile>> {
  if (!token) return { valid: false }

  const sessions = await readSessions()
  const session = sessions[token]
  if (!session) return { valid: false }

  if (new Date(session.expiresAt) < new Date()) {
    delete sessions[token]
    await writeSessions(sessions)
    return { valid: false }
  }

  return { valid: true, ...profileFromSession(session) }
}

export function hasPermission(profile: AdminProfile, permission: string): boolean {
  if (profile.role === 'super_admin') return true
  return profile.permissions.includes(permission)
}

export async function adminLogout(token: string): Promise<void> {
  const sessions = await readSessions()
  const session = sessions[token]
  delete sessions[token]
  await writeSessions(sessions)
  if (session) {
    auditLogger.log({ actor: session.email, actorType: 'admin', action: 'admin.logout', target: session.email })
  }
  logger.info('admin logged out')
}

/**
 * Immediately invalidate every live session for an admin (used when the admin is
 * deactivated, deleted, demoted, or has their permissions changed). Prevents a
 * stale 24h snapshot from keeping an account privileged after it is revoked.
 */
export async function invalidateAdminSessions(email: string): Promise<void> {
  const sessions = await readSessions()
  let changed = false
  for (const [token, s] of Object.entries(sessions)) {
    if (s.email === email) {
      delete sessions[token]
      changed = true
    }
  }
  if (changed) {
    await writeSessions(sessions)
    logger.info({ email }, 'invalidated admin sessions')
  }
}

export async function changeAdminPassword(email: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const admin = await getAdminUserByEmail(email)
  if (!admin) {
    return { success: false, error: 'Admin not found' }
  }
  const valid = await bcrypt.compare(oldPassword, admin.passwordHash)
  if (!valid) {
    return { success: false, error: 'Current password is incorrect' }
  }
  await updateAdminUser(admin.id, { passwordHash: await hashAdminPassword(newPassword) })
  auditLogger.log({ actor: admin.email, actorType: 'admin', action: 'admin.password_change', target: admin.email })
  logger.info({ email }, 'admin password changed')
  return { success: true }
}

// Kept for compatibility — no longer required for login
export async function getAdminSecret(): Promise<string> {
  let secret = await getConfig('admin_jwt_secret')
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
    await setConfig('admin_jwt_secret', secret)
  }
  return secret
}
