import { FastifyInstance } from 'fastify'
import { createPackage, listPackages, getPackage, updatePackage, deletePackage, getConfig, setConfig } from '../../store.js'
import { clearFeatureCache } from '../../lib/packagePermissions.js'
import { guard } from './middleware.js'
import { auditLogger } from '../../lib/AuditLogger.js'

export async function registerAdminPackageRoutes(server: FastifyInstance): Promise<void> {

  server.get('/api/admin/packages', guard('packages.view'), async (req: any, reply: any) => {
    const pkgs = await listPackages()
    const defaultSlug = await getConfig('default_package')
    return reply.send({ packages: pkgs, defaultPackage: defaultSlug || 'pro' })
  })

  // PUT default BEFORE :id to avoid route conflict
  server.put('/api/admin/packages/default', guard('packages.update'), async (req: any, reply: any) => {
    const { slug } = req.body as { slug?: string }
    if (!slug) return reply.status(400).send({ error: 'Slug is required' })
    const pkg = await getPackage(slug)
    if (!pkg) return reply.status(404).send({ error: 'Package not found' })
    await setConfig('default_package', slug)
    auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'packages.set_default', target: slug })
    return reply.send({ success: true, defaultPackage: slug })
  })

  server.get('/api/admin/packages/:id', guard('packages.view'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const pkg = await getPackage(id)
    if (!pkg) {
      return reply.status(404).send({ error: 'Package not found' })
    }
    return reply.send({ package: pkg })
  })

  server.post('/api/admin/packages', guard('packages.create'), async (req: any, reply: any) => {
    const { name, slug, description, priceCents, includedTokens, features, sortOrder, billingPeriod, yearlyPriceCents, setupType } = req.body as {
      name: string
      slug: string
      description?: string
      priceCents: number
      includedTokens: number
      features?: Record<string, unknown>
      sortOrder?: number
      billingPeriod?: 'monthly' | 'yearly'
      yearlyPriceCents?: number
      setupType?: 'none' | 'standard' | 'premium'
    }

    if (!name || !slug || !priceCents || !includedTokens) {
      return reply.status(400).send({ error: 'Missing required fields: name, slug, priceCents, includedTokens' })
    }

    try {
      const pkg = await createPackage({
        name, slug, description, priceCents, includedTokens, features, sortOrder,
        billingPeriod: billingPeriod || 'monthly',
        yearlyPriceCents: yearlyPriceCents ? Number(yearlyPriceCents) : 0,
        setupType: setupType || 'none',
      })
      clearFeatureCache()
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'packages.create', target: slug, details: { name } })
      return reply.status(201).send({ package: pkg })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.put('/api/admin/packages/:id', guard('packages.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const patch = req.body as Partial<{
      name: string
      slug: string
      description: string
      priceCents: number
      includedTokens: number
      features: Record<string, unknown>
      isActive: boolean
      sortOrder: number
      billingPeriod?: 'monthly' | 'yearly'
      yearlyPriceCents?: number
      setupType?: 'none' | 'standard' | 'premium'
    }>

    try {
      const pkg = await updatePackage(id, {
        ...patch,
        billingPeriod: patch.billingPeriod || undefined,
        yearlyPriceCents: patch.yearlyPriceCents !== undefined ? Number(patch.yearlyPriceCents) : undefined,
        setupType: patch.setupType || undefined,
      })
      clearFeatureCache()
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'packages.update', target: id })
      return reply.send({ package: pkg })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.delete('/api/admin/packages/:id', guard('packages.delete'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    try {
      await deletePackage(id)
      clearFeatureCache()
      auditLogger.log({ actor: req.adminEmail, actorType: 'admin', action: 'packages.delete', target: id })
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })
}
