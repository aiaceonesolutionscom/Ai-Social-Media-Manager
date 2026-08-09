import { FastifyInstance } from 'fastify'
import { listUsers, getUser, updateUser, activateUser, deactivateUser, deleteUser, getTransactions, createUser, listPackages, getPackage, createPayment, createTokenTransaction } from '../../store.js'
import { grantTokens } from '../../lib/tokens.js'
import { hashPassword } from '../../lib/userAuth.js'
import { clearFeatureCache } from '../../lib/packagePermissions.js'
import { guard } from './middleware.js'
import { auditLogger } from '../../lib/AuditLogger.js'

export async function registerAdminUserRoutes(server: FastifyInstance): Promise<void> {

  server.get('/api/admin/users', guard('users.view'), async (req: any, reply: any) => {
    const users = await listUsers()
    return reply.send({ users })
  })

  server.get('/api/admin/users/:phone', guard('users.view'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    const user = await getUser(phone)
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }
    return reply.send({ user })
  })

  server.post('/api/admin/users', guard('users.create'), async (req: any, reply: any) => {
    const { name, email, password, packageId, tokens } = req.body as {
      name: string
      email: string
      password?: string
      packageId?: string
      tokens?: number
    }

    if (!name || !email) {
      return reply.status(400).send({ error: 'Name and email are required' })
    }

    try {
      const phone = 'admin_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      const user = await createUser({
        phone,
        name,
        email,
        packageId: packageId || '',
        tokensRemaining: tokens || 0,
        passwordHash: password ? await hashPassword(password) : undefined,
      })
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'user.create', target: email, details: { name, packageId } })
      return reply.status(201).send({ user })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.put('/api/admin/users/:phone', guard('users.update'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    const patch = req.body as Partial<{
      name: string
      email: string
      packageId: string
      tokensRemaining: number
    }>

    try {
      const user = await updateUser(phone, patch)
      if (patch.packageId) clearFeatureCache(phone)
      return reply.send({ user })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.put('/api/admin/users/:phone/activate', guard('users.update'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    try {
      const user = await activateUser(phone)
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'user.activate', target: phone })
      return reply.send({ user })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.put('/api/admin/users/:phone/deactivate', guard('users.update'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    try {
      const user = await deactivateUser(phone)
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'user.deactivate', target: phone })
      return reply.send({ user })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.delete('/api/admin/users/:phone', guard('users.delete'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    try {
      await deleteUser(phone)
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'user.delete', target: phone })
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.get('/api/admin/users/:phone/transactions', guard('users.view'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    const limit = (req.query as any)?.limit ? Number((req.query as any).limit) : 50
    const transactions = await getTransactions(phone, limit)
    return reply.send({ transactions })
  })

  server.post('/api/admin/tokens/grant', guard('users.update'), async (req: any, reply: any) => {
    const { phone, amount, description } = req.body as {
      phone: string
      amount: number
      description: string
    }

    if (!phone || !amount) {
      return reply.status(400).send({ error: 'Phone and amount required' })
    }

    const adminEmail = req.adminEmail || 'admin'
    const success = await grantTokens(phone, amount, adminEmail, description || 'Admin grant')
    if (!success) {
      return reply.status(400).send({ error: 'Failed to grant tokens' })
    }
    auditLogger.log({ actor: adminEmail, actorType: 'admin', action: 'tokens.grant', target: phone, details: { amount } })
    return reply.send({ success: true })
  })

  server.post('/api/admin/users/:phone/grant-package', guard('users.update'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    const { packageId, tokens } = req.body as { packageId: string; tokens?: number }

    if (!packageId) {
      return reply.status(400).send({ error: 'packageId is required' })
    }

    const user = await getUser(phone)
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    const pkg = await getPackage(packageId)
    if (!pkg) {
      return reply.status(404).send({ error: 'Package not found' })
    }

    const tokensToGrant = tokens ?? pkg.includedTokens
    const newBalance = user.tokensRemaining + tokensToGrant

    await updateUser(phone, {
      packageId: pkg.slug,
      tokensRemaining: newBalance,
      tokensUsed: user.tokensUsed,
    })

    await createPayment({
      phone,
      packageId: pkg.slug,
      tokenCount: tokensToGrant,
      amountCents: pkg.priceCents,
      type: 'one_time',
      stripeSessionId: `local_${Date.now()}`,
    })

    await createTokenTransaction({
      phone,
      type: 'grant',
      amount: tokensToGrant,
      balanceAfter: newBalance,
      description: `Local payment — ${pkg.name} package`,
    })

    clearFeatureCache(phone)

    auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'user.grant_package', target: phone, details: { package: pkg.slug, tokens: tokensToGrant } })

    return reply.send({
      success: true,
      package: pkg.slug,
      tokensGranted: tokensToGrant,
      newBalance,
    })
  })
}
