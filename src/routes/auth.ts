import { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { createEmailUser, loginEmailUser, findOrCreateOAuthUser, verifySession, destroySession, createSession, hashPassword, comparePassword } from '../lib/userAuth.js'
import { getUser, getUserByEmail, createUser, updateUser, getPackage, updateUserSessionsEmail } from '../store.js'
import { storageManager } from '../lib/StorageManager.js'
import { rateLimit } from '../lib/ratelimit.js'
import { verifyToken, createClerkClient } from '@clerk/backend'
import { logger } from '../lib/logger.js'

export async function registerAuthRoutes(server: FastifyInstance): Promise<void> {
  // ---- Email/Password Auth ----

  server.post('/api/auth/signup', async (req: any, reply: any) => {
    const { allowed } = rateLimit(`signup:${req.ip}`, { windowMs: 60 * 60 * 1000, max: 10 })
    if (!allowed) {
      return reply.status(429).send({ error: 'Too many signup attempts. Please try again later.' })
    }

    const { email, password, name } = req.body as { email?: string; password?: string; name?: string }

    if (!email || !password || !name) {
      return reply.status(400).send({ error: 'Email, password, and name are required' })
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: 'Password must be at least 6 characters' })
    }
    if (!email.includes('@')) {
      return reply.status(400).send({ error: 'Invalid email address' })
    }

    try {
      const result = await createEmailUser(email, password, name)
      return reply.send({ token: result.token, phone: result.phone })
    } catch (err: any) {
      return reply.status(409).send({ error: err.message })
    }
  })

  server.post('/api/auth/login', async (req: any, reply: any) => {
    const { allowed } = rateLimit(`login:${req.ip}`, { windowMs: 5 * 60 * 1000, max: 10 })
    if (!allowed) {
      return reply.status(429).send({ error: 'Too many login attempts. Please try again later.' })
    }

    const { email, password } = req.body as { email?: string; password?: string }

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' })
    }

    try {
      const result = await loginEmailUser(email, password)
      return reply.send({ token: result.token, phone: result.phone })
    } catch (err: any) {
      return reply.status(401).send({ error: err.message })
    }
  })

  server.get('/api/auth/me', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) return reply.status(401).send({ error: 'No token provided' })

    const session = await verifySession(token)
    if (!session) return reply.status(401).send({ error: 'Invalid or expired session' })

    const user = await getUser(session.phone)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const pkg = user.packageId ? await getPackage(user.packageId) : undefined

    return reply.send({
      phone: user.phone,
      name: user.name,
      email: user.email,
      packageId: user.packageId,
      packageName: pkg?.name || '',
      tokensRemaining: user.tokensRemaining,
      tokensUsed: user.tokensUsed,
      avatarUrl: user.avatarUrl,
      oauthProvider: user.oauthProvider,
    })
  })

  server.post('/api/auth/logout', async (req: any, reply: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (token) await destroySession(token)
    return reply.send({ success: true })
  })

  // ---- User profile ----

  const requireSession = async (req: any, reply: any): Promise<string | null> => {
    const token = req.headers['authorization']?.replace('Bearer ', '') || ''
    if (!token) {
      reply.status(401).send({ error: 'No token provided' })
      return null
    }
    const session = await verifySession(token)
    if (!session) {
      reply.status(401).send({ error: 'Invalid or expired session' })
      return null
    }
    return session.phone
  }

  server.put('/api/user/profile', async (req: any, reply: any) => {
    const phone = await requireSession(req, reply)
    if (!phone) return

    const { name, email } = (req.body ?? {}) as { name?: string; email?: string }

    if (!name && !email) {
      return reply.status(400).send({ error: 'Nothing to update' })
    }

    const patch: { name?: string; email?: string } = {}
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return reply.status(400).send({ error: 'Name cannot be empty' })
      }
      patch.name = name.trim()
    }
    if (email !== undefined) {
      if (typeof email !== 'string' || !email.includes('@')) {
        return reply.status(400).send({ error: 'Invalid email address' })
      }
      const cleanEmail = email.trim()
      const existing = await getUserByEmail(cleanEmail)
      if (existing && existing.phone !== phone) {
        return reply.status(409).send({ error: 'Email already registered to another account' })
      }
      patch.email = cleanEmail
    }

      try {
        const current = await getUser(phone)
        if (patch.email && current && current.email && current.email !== patch.email) {
          await updateUserSessionsEmail(current.email, patch.email)
        }
        const user = await updateUser(phone, patch)
      const pkg = user.packageId ? await getPackage(user.packageId) : undefined
      return reply.send({
        phone: user.phone,
        name: user.name,
        email: user.email,
        packageId: user.packageId,
        packageName: pkg?.name || '',
        tokensRemaining: user.tokensRemaining,
        tokensUsed: user.tokensUsed,
        avatarUrl: user.avatarUrl,
        oauthProvider: user.oauthProvider,
      })
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  server.post('/api/user/avatar', async (req: any, reply: any) => {
    const phone = await requireSession(req, reply)
    if (!phone) return

    const { dataUrl } = (req.body ?? {}) as { dataUrl?: string }
    if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl)) {
      return reply.status(400).send({ error: 'A valid base64 image data URL (png/jpeg/webp) is required' })
    }

    const buffer = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64')
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
      return reply.status(400).send({ error: 'Image is empty or larger than 5MB' })
    }

    const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,/)
    const ext = match?.[1] === 'jpeg' ? 'jpg' : match?.[1] || 'png'
    const safePhone = phone.replace(/[^a-zA-Z0-9_-]/g, '_')
    const avatarUrl = await storageManager.save(`avatar_${safePhone}.${ext}`, buffer)

    const user = await updateUser(phone, { avatarUrl })
    return reply.send({ success: true, avatarUrl, user })
  })

  server.put('/api/user/password', async (req: any, reply: any) => {
    const phone = await requireSession(req, reply)
    if (!phone) return

    const { currentPassword, newPassword } = (req.body ?? {}) as { currentPassword?: string; newPassword?: string }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return reply.status(400).send({ error: 'New password must be at least 6 characters' })
    }

    const user = await getUser(phone)
    if (!user) return reply.status(404).send({ error: 'User not found' })

    if (user.passwordHash) {
      if (!currentPassword || typeof currentPassword !== 'string') {
        return reply.status(400).send({ error: 'Current password is required' })
      }
      const valid = await comparePassword(currentPassword, user.passwordHash)
      if (!valid) {
        return reply.status(400).send({ error: 'Current password is incorrect' })
      }
    }

    const passwordHash = await hashPassword(newPassword)
    await updateUser(phone, { passwordHash })
    return reply.send({ success: true })
  })

  // ---- Clerk (external auth provider) ----
  // The frontend exchanges a Clerk session JWT for an app session token.
  server.post('/api/auth/clerk', async (req: any, reply: any) => {
    const { allowed } = rateLimit(`clerk:${req.ip}`, { windowMs: 60 * 60 * 1000, max: 60 })
    if (!allowed) {
      return reply.status(429).send({ error: 'Too many requests. Please try again later.' })
    }

    const { token } = req.body as { token?: string }
    if (!token || typeof token !== 'string') {
      return reply.status(400).send({ error: 'A Clerk session token is required' })
    }

    if (!config.clerk.secretKey) {
      return reply.status(503).send({ error: 'CLERK_SECRET_KEY is not configured' })
    }

    let subject: string
    try {
      const verifyOpts: Record<string, string> = { secretKey: config.clerk.secretKey }
      if (config.clerk.publishableKey) verifyOpts.publishableKey = config.clerk.publishableKey
      const claims = await verifyToken(token, verifyOpts)
      subject = claims.sub
    } catch (err: any) {
      logger.warn({
        error: err.message,
        fullMessage: err.fullMessage,
        reason: err.reason,
        action: err.action,
        status: err.status,
        errors: err.errors,
        cause: err.cause?.message,
      }, 'clerk token verification failed')
      return reply.status(401).send({ error: 'Invalid or expired Clerk session' })
    }

    try {
      const client = createClerkClient({ secretKey: config.clerk.secretKey })
      const clerkUser = await client.users.getUser(subject)

      const email = clerkUser.emailAddresses?.[0]?.emailAddress || `${subject}@clerk.dev`
      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || email.split('@')[0] || 'Clerk User'

      let user = await getUserByEmail(email)
      if (!user) {
        user = await createUser({
          phone: `clk_${subject}`,
          name,
          email,
          oauthProvider: 'clerk',
          oauthId: subject,
          avatarUrl: clerkUser.imageUrl || undefined,
        })
        logger.info({ email, phone: user.phone }, 'created user via Clerk')
      }

      if (user.active !== 1) {
        return reply.status(403).send({ error: 'Your account has been deactivated. Please contact support.' })
      }

      const appToken = await createSession(email)
      return reply.send({ token: appToken, phone: user.phone, email, name, user })
    } catch (err: any) {
      logger.error({ error: err.message }, 'clerk bridge failed')
      return reply.status(500).send({ error: `Clerk bridge failed: ${err.message}` })
    }
  })

  // ---- OAuth Providers ----

  server.get('/api/auth/providers', async (_req: any, reply: any) => {
    return reply.send({
      google: !!config.oauth.google.clientId,
      facebook: !!config.oauth.facebook.clientId,
      github: !!config.oauth.github.clientId,
    })
  })

  // Google OAuth
  server.get('/api/auth/google', async (req: any, reply: any) => {
    if (!config.oauth.google.clientId) {
      return reply.status(503).send({ error: 'Google OAuth not configured' })
    }
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${config.oauth.google.clientId}&redirect_uri=${encodeURIComponent(config.oauth.google.callbackUrl)}&response_type=code&scope=openid email profile&access_type=offline`
    return reply.redirect(url)
  })

  server.get('/api/auth/google/callback', async (req: any, reply: any) => {
    const { code, error } = req.query as { code?: string; error?: string }
    if (error || !code) return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`)

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.oauth.google.clientId,
          client_secret: config.oauth.google.clientSecret,
          redirect_uri: config.oauth.google.callbackUrl,
          grant_type: 'authorization_code',
        }),
      })
      const tokenData = await tokenRes.json() as any
      if (!tokenData.access_token) throw new Error('Failed to get access token')

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      const userData = await userRes.json() as any

      const result = await findOrCreateOAuthUser('google', userData.id, userData.email, userData.name, userData.picture)
      return reply.redirect(`${config.frontendUrl}/auth/callback?token=${result.token}&phone=${result.phone}&new=${result.isNew}`)
    } catch (err: any) {
      return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`)
    }
  })

  // Facebook OAuth
  server.get('/api/auth/facebook', async (req: any, reply: any) => {
    if (!config.oauth.facebook.clientId) {
      return reply.status(503).send({ error: 'Facebook OAuth not configured' })
    }
    const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${config.oauth.facebook.clientId}&redirect_uri=${encodeURIComponent(config.oauth.facebook.callbackUrl)}&scope=email,public_profile`
    return reply.redirect(url)
  })

  server.get('/api/auth/facebook/callback', async (req: any, reply: any) => {
    const { code, error } = req.query as { code?: string; error?: string }
    if (error || !code) return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`)

    try {
      const tokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?client_id=${config.oauth.facebook.clientId}&redirect_uri=${encodeURIComponent(config.oauth.facebook.callbackUrl)}&client_secret=${config.oauth.facebook.clientSecret}&code=${code}`)
      const tokenData = await tokenRes.json() as any
      if (!tokenData.access_token) throw new Error('Failed to get access token')

      const userRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name,email&access_token=${tokenData.access_token}`)
      const userData = await userRes.json() as any

      const result = await findOrCreateOAuthUser('facebook', userData.id, userData.email || `${userData.id}@facebook.com`, userData.name)
      return reply.redirect(`${config.frontendUrl}/auth/callback?token=${result.token}&phone=${result.phone}&new=${result.isNew}`)
    } catch (err: any) {
      return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`)
    }
  })

  // GitHub OAuth
  server.get('/api/auth/github', async (req: any, reply: any) => {
    if (!config.oauth.github.clientId) {
      return reply.status(503).send({ error: 'GitHub OAuth not configured' })
    }
    const url = `https://github.com/login/oauth/authorize?client_id=${config.oauth.github.clientId}&redirect_uri=${encodeURIComponent(config.oauth.github.callbackUrl)}&scope=user:email`
    return reply.redirect(url)
  })

  server.get('/api/auth/github/callback', async (req: any, reply: any) => {
    const { code, error } = req.query as { code?: string; error?: string }
    if (error || !code) return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`)

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: config.oauth.github.clientId,
          client_secret: config.oauth.github.clientSecret,
          code,
        }),
      })
      const tokenData = await tokenRes.json() as any
      if (!tokenData.access_token) throw new Error('Failed to get access token')

      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      const userData = await userRes.json() as any

      const email = userData.email || `${userData.login}@github.com`
      const result = await findOrCreateOAuthUser('github', String(userData.id), email, userData.name || userData.login, userData.avatar_url)
      return reply.redirect(`${config.frontendUrl}/auth/callback?token=${result.token}&phone=${result.phone}&new=${result.isNew}`)
    } catch (err: any) {
      return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`)
    }
  })
}
