import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import {
  getUser,
  getUserByEmail,
  createUser,
  createUserSession,
  getUserSession,
  deleteUserSession,
} from '../store.js'
import { logger } from './logger.js'

const SALT_ROUNDS = 10
const SESSION_DAYS = 30

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

function generatePhoneId(): string {
  return 'u_' + randomBytes(16).toString('hex')
}

export async function createEmailUser(email: string, password: string, name: string): Promise<{ token: string; phone: string }> {
  const existing = await getUserByEmail(email)
  if (existing) throw new Error('Email already registered')

  const phone = generatePhoneId()
  const passwordHash = await hashPassword(password)

  await createUser({
    phone,
    name,
    email,
    passwordHash,
  })

  const token = await createSession(email)
  logger.info({ email, phone }, 'created email user')
  return { token, phone }
}

export async function loginEmailUser(email: string, password: string): Promise<{ token: string; phone: string }> {
  const user = await getUserByEmail(email)
  if (!user) throw new Error('Invalid email or password')
  if (!user.passwordHash) throw new Error('Account uses social login. Please sign in with your provider.')
  if (user.active !== 1) throw new Error('Your account has been deactivated. Please contact support.')

  const valid = await comparePassword(password, user.passwordHash)
  if (!valid) throw new Error('Invalid email or password')

  const token = await createSession(email)
  logger.info({ email }, 'email user logged in')
  return { token, phone: user.phone }
}

export async function findOrCreateOAuthUser(
  provider: string,
  providerId: string,
  email: string,
  name: string,
  avatarUrl?: string,
): Promise<{ token: string; phone: string; isNew: boolean }> {
  let isNew = false
  let user = await getUserByEmail(email)

  if (user) {
    if (user.active !== 1) throw new Error('Your account has been deactivated. Please contact support.')
    if (!user.oauthProvider) {
      const { updateUser } = await import('../store.js')
      await updateUser(user.phone, {
        oauthProvider: provider,
        oauthId: providerId,
        avatarUrl: avatarUrl || user.avatarUrl,
      })
      logger.info({ email, provider }, 'linked OAuth to existing account')
    }
  } else {
    const phone = generatePhoneId()
    user = await createUser({
      phone,
      name,
      email,
      oauthProvider: provider,
      oauthId: providerId,
      avatarUrl,
    })
    isNew = true
    logger.info({ email, provider, phone }, 'created OAuth user')
  }

  const token = await createSession(email)
  return { token, phone: user!.phone, isNew }
}

export async function createSession(email: string): Promise<string> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  await createUserSession(token, email, expiresAt)
  return token
}

export async function verifySession(token: string): Promise<{ email: string; phone: string } | null> {
  const session = await getUserSession(token)
  if (!session) return null

  const user = await getUserByEmail(session.userEmail)
  if (!user || user.active !== 1) {
    await deleteUserSession(token)
    return null
  }

  return { email: session.userEmail, phone: user.phone }
}

export async function destroySession(token: string): Promise<void> {
  await deleteUserSession(token)
}
