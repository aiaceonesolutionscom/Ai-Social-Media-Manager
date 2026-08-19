import { FastifyInstance } from 'fastify'
import { listUsers, getUser, updateUser, activateUser, deactivateUser, deleteUser, getTransactions, createUser, listPackages, getPackage, createPayment, createTokenTransaction, listPayments, listAuditLogs, getUserPreferences, saveUserPreferences } from '../../store.js'
import { grantTokens } from '../../lib/tokens.js'
import { hashPassword } from '../../lib/userAuth.js'
import { clearFeatureCache } from '../../lib/packagePermissions.js'
import { activatePackage, endPackage, isPackageExpired } from '../../lib/packageLifecycle.js'
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

  server.get('/api/admin/users/:phone/detail', guard('users.view'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    const user = await getUser(phone)
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }
    const pkg = user.packageId ? await getPackage(user.packageId) : null
    const limit = 100
    const [transactions, payments, auditLogs] = await Promise.all([
      getTransactions(phone, limit),
      listPayments(phone),
      listAuditLogs({ actor: phone, limit }),
    ])
    return reply.send({
      user: {
        ...user,
        packageName: pkg?.name || '',
        packageInfo: pkg
          ? {
              name: pkg.name,
              slug: pkg.slug,
              includedTokens: pkg.includedTokens,
              billingPeriod: pkg.billingPeriod,
            }
          : null,
        packageFeatures: (pkg?.features ?? {}) as Record<string, boolean>,
      },
      transactions,
      payments,
      auditLogs,
    })
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
        tokensRemaining: packageId ? 0 : tokens || 0,
        passwordHash: password ? await hashPassword(password) : undefined,
      })
      if (packageId) {
        await activatePackage(phone, packageId, {
          tokens: tokens,
          actor: req.adminEmail,
          description: `Package assigned by admin (${req.adminEmail})`,
        })
      }
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'user.create', target: email, details: { name, packageId } })
      const created = await getUser(phone)
      return reply.status(201).send({ user: created })
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
      const existing = await getUser(phone)
      if (!existing) {
        return reply.status(404).send({ error: 'User not found' })
      }

      const { packageId, tokensRemaining, ...rest } = patch

      let user = existing

      if (packageId && packageId !== existing.packageId) {
        const pkg = await getPackage(packageId)
        if (!pkg) {
          return reply.status(404).send({ error: 'Package not found' })
        }
        user = await activatePackage(phone, pkg.slug, {
          tokens: typeof tokensRemaining === 'number' ? tokensRemaining : undefined,
          actor: req.adminEmail || 'admin',
          description: `Package changed by admin (${req.adminEmail})`,
        })
      }

      if (Object.keys(rest).length > 0) {
        user = await updateUser(phone, rest as any)
      }
      if (packageId) clearFeatureCache(phone)

      if (typeof tokensRemaining === 'number' && !packageId && tokensRemaining !== existing.tokensRemaining) {
        const delta = tokensRemaining - existing.tokensRemaining
        await createTokenTransaction({
          phone,
          type: delta > 0 ? 'grant' : 'deduct',
          amount: delta > 0 ? delta : -delta,
          balanceAfter: tokensRemaining,
          description: `Admin balance adjustment (${delta > 0 ? '+' : ''}${delta})`,
          adminId: req.adminEmail || 'admin',
        })
        auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'tokens.adjust', target: phone, details: { delta } })
      }

      const updated = await getUser(phone)
      return reply.send({ user: updated })
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

    // Replacing an existing package resets the balance — grant fresh tokens via
    // activatePackage which also sets the billing-period expiry.
    await activatePackage(phone, pkg.slug, {
      tokens: tokensToGrant,
      actor: req.adminEmail || 'admin',
      description: `Local payment — ${pkg.name} package`,
    })
    const newBalance = (await getUser(phone))?.tokensRemaining ?? 0

    await createPayment({
      phone,
      packageId: pkg.slug,
      tokenCount: tokensToGrant,
      amountCents: pkg.priceCents,
      type: 'one_time',
      stripeSessionId: `local_${Date.now()}`,
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

  server.post('/api/admin/users/:phone/end-package', guard('users.update'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }

    const user = await getUser(phone)
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }
    if (!user.packageId || user.packageStatus !== 'active') {
      return reply.status(400).send({ error: 'User has no active package to end' })
    }

    const updated = await endPackage(phone, { actor: req.adminEmail || 'admin', reason: 'ended by admin' })
    return reply.send({ success: true, user: updated })
  })

  // Get user branding settings (admin override)
  server.get('/api/admin/users/:phone/branding', guard('users.view'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    const user = await getUser(phone)
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }
    const prefs = await getUserPreferences(phone)
    return reply.send({ brandingEnabled: prefs?.brandingEnabled ?? true })
  })

  // Update user branding settings (admin override)
  server.put('/api/admin/users/:phone/branding', guard('users.update'), async (req: any, reply: any) => {
    const { phone } = req.params as { phone: string }
    const user = await getUser(phone)
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }
    const { brandingEnabled } = (req.body ?? {}) as { brandingEnabled?: boolean }
    if (typeof brandingEnabled !== 'boolean') {
      return reply.status(400).send({ error: 'brandingEnabled must be a boolean' })
    }
    const prefs = await getUserPreferences(phone)
    await saveUserPreferences(phone, { ...(prefs ?? {}), brandingEnabled })
    return reply.send({ success: true, brandingEnabled })
  })
}
