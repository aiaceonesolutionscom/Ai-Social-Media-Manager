import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { config } from '../config.js'
import { logger } from './logger.js'
import { getConfig, setConfig } from '../store.js'

const ADMIN_TOKEN_KEY = 'admin_jwt_secret'
const ADMIN_SESSIONS_KEY = 'admin_sessions'
const ADMIN_PASSWORD_HASH_KEY = 'admin_password_hash'

const SALT_ROUNDS = 10
const SESSION_HOURS = 24

export async function getAdminSecret(): Promise<string> {
  let secret = await getConfig(ADMIN_TOKEN_KEY)
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
    await setConfig(ADMIN_TOKEN_KEY, secret)
  }
  return secret
}

async function getStoredPasswordHash(): Promise<string> {
  let hash = await getConfig(ADMIN_PASSWORD_HASH_KEY)
  if (!hash) {
    hash = await bcrypt.hash(config.admin.password, SALT_ROUNDS)
    await setConfig(ADMIN_PASSWORD_HASH_KEY, hash)
  }
  return hash
}

export async function adminLogin(email: string, password: string): Promise<{ success: boolean; token?: string; error?: string }> {
  if (email !== config.admin.email) {
    return { success: false, error: 'Invalid email' }
  }

  const storedHash = await getStoredPasswordHash()
  const valid = await bcrypt.compare(password, storedHash)
  if (!valid) {
    return { success: false, error: 'Invalid password' }
  }

  const secret = await getAdminSecret()
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString()

  const sessionsJson = await getConfig(ADMIN_SESSIONS_KEY) || '{}'
  const sessions = JSON.parse(sessionsJson) as Record<string, { email: string; createdAt: string; expiresAt: string }>
  sessions[token] = { email, createdAt: new Date().toISOString(), expiresAt }
  await setConfig(ADMIN_SESSIONS_KEY, JSON.stringify(sessions))

  logger.info({ email }, 'admin logged in')
  return { success: true, token }
}

export async function verifyAdminToken(token: string): Promise<{ valid: boolean; email?: string }> {
  if (!token) return { valid: false }

  const sessionsJson = await getConfig(ADMIN_SESSIONS_KEY) || '{}'
  const sessions = JSON.parse(sessionsJson) as Record<string, { email: string; createdAt: string; expiresAt: string }>

  const session = sessions[token]
  if (!session) return { valid: false }

  if (new Date(session.expiresAt) < new Date()) {
    delete sessions[token]
    await setConfig(ADMIN_SESSIONS_KEY, JSON.stringify(sessions))
    return { valid: false }
  }

  return { valid: true, email: session.email }
}

export async function adminLogout(token: string): Promise<void> {
  const sessionsJson = await getConfig(ADMIN_SESSIONS_KEY) || '{}'
  const sessions = JSON.parse(sessionsJson) as Record<string, { email: string; createdAt: string; expiresAt: string }>
  delete sessions[token]
  await setConfig(ADMIN_SESSIONS_KEY, JSON.stringify(sessions))
  logger.info('admin logged out')
}

export async function changeAdminPassword(oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const storedHash = await getStoredPasswordHash()
  const valid = await bcrypt.compare(oldPassword, storedHash)
  if (!valid) {
    return { success: false, error: 'Current password is incorrect' }
  }

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await setConfig(ADMIN_PASSWORD_HASH_KEY, newHash)
  logger.info('admin password changed')
  return { success: true }
}

export async function hashAdminPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}
