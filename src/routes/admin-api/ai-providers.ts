import { FastifyInstance } from 'fastify'
import {
  createAIProvider, listAIProviders, getAIProvider, updateAIProvider, deleteAIProvider,
  setActiveAIProvider, getActiveAIProvider,
  listAICosts, upsertAICost, upsertAICostVersion, getAICost, listAICostVersions,
  getAIUsageStats, listAIUsageLogs,
  createCostVersionProposal, approveCostVersion, rejectCostVersion, getActivePricingVersion,
  validateProviderConnection,
} from '../../store.js'
import { providerManager } from '../../lib/ai/providerManager.js'
import { config } from '../../config.js'
import { checkProposedMargin } from '../../lib/profitability.js'
import { guard } from './middleware.js'
import type { AIProviderCategory } from '../../types.js'

const VALID_CATEGORIES = ['stt', 'llm', 'image']

export async function registerAdminAIProviderRoutes(server: FastifyInstance): Promise<void> {

  // ---- Providers CRUD ----

  server.get('/api/admin/ai-providers', guard('ai_providers.view'), async (req: any, reply: any) => {
    const { category } = req.query as { category?: AIProviderCategory }
    const providers = await listAIProviders(category as AIProviderCategory | undefined)

    // Mask API keys in response
    const safe = providers.map((p) => ({
      ...p,
      apiKey: p.apiKey ? `${p.apiKey.slice(0, 8)}••••••••` : '',
    }))

    // Group by category
    const grouped: Record<string, typeof safe> = {}
    for (const p of safe) {
      if (!grouped[p.category]) grouped[p.category] = []
      grouped[p.category].push(p)
    }
    return reply.send({ providers: grouped })
  })

  server.get('/api/admin/ai-providers/active', guard('ai_providers.view'), async (_req: any, reply: any) => {
    const stt = await getActiveAIProvider('stt')
    const llm = await getActiveAIProvider('llm')
    const image = await getActiveAIProvider('image')
    return reply.send({
      stt: stt ? { ...stt, apiKey: stt.apiKey ? `${stt.apiKey.slice(0, 8)}••••••••` : '' } : null,
      llm: llm ? { ...llm, apiKey: llm.apiKey ? `${llm.apiKey.slice(0, 8)}••••••••` : '' } : null,
      image: image ? { ...image, apiKey: image.apiKey ? `${image.apiKey.slice(0, 8)}••••••••` : '' } : null,
    })
  })

  server.get('/api/admin/ai-providers/:id', guard('ai_providers.view'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const provider = await getAIProvider(id)
    if (!provider) return reply.status(404).send({ error: 'Provider not found' })
    return reply.send({
      provider: {
        ...provider,
        apiKey: provider.apiKey ? `${provider.apiKey.slice(0, 8)}••••••••` : '',
      },
    })
  })

  server.post('/api/admin/ai-providers', guard('ai_providers.update'), async (req: any, reply: any) => {
    const { category, provider, displayName, apiKey, baseUrl, model, config: cfg, skipValidation } = req.body as {
      category: AIProviderCategory
      provider: string
      displayName: string
      apiKey?: string
      baseUrl?: string
      model?: string
      config?: Record<string, unknown>
      skipValidation?: boolean
    }

    if (!category || !provider || !displayName) {
      return reply.status(400).send({ error: 'Missing required fields: category, provider, displayName' })
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return reply.status(400).send({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` })
    }
    if (skipValidation === true && !config.dev.enabled) {
      return reply.status(403).send({ error: 'skipValidation is disabled in production. Provider connections must always be validated.' })
    }

    try {
      const p = await createAIProvider({
        category,
        provider,
        displayName,
        apiKey: apiKey || '',
        baseUrl: baseUrl || '',
        model: model || '',
        config: cfg || {},
        isActive: false,
        isDefault: false,
      }, skipValidation !== true)
      
      let validationResult = null
      if (apiKey && skipValidation !== true) {
        validationResult = await validateProviderConnection(provider, category, apiKey, baseUrl || '', model || '')
      }
      
      return reply.status(201).send({ 
        provider: { ...p, apiKey: p.apiKey ? `${p.apiKey.slice(0, 8)}••••••••` : '' },
        validation: validationResult
      })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.put('/api/admin/ai-providers/:id', guard('ai_providers.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const { skipValidation, ...patch } = req.body as Partial<{
      provider: string
      displayName: string
      apiKey: string
      baseUrl: string
      model: string
      config: Record<string, unknown>
      skipValidation: boolean
    }>

    if (skipValidation === true && !config.dev.enabled) {
      return reply.status(403).send({ error: 'skipValidation is disabled in production. Provider connections must always be validated.' })
    }

    try {
      const p = await updateAIProvider(id, patch, skipValidation !== true)
      
      let validationResult = null
      if (patch.apiKey && skipValidation !== true) {
        const provider = await getAIProvider(id)
        if (provider) {
          validationResult = await validateProviderConnection(provider.provider, provider.category, patch.apiKey, patch.baseUrl || provider.baseUrl, patch.model || provider.model)
        }
      }
      
      return reply.send({ 
        provider: { ...p, apiKey: p.apiKey ? `${p.apiKey.slice(0, 8)}••••••••` : '' },
        validation: validationResult
      })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.delete('/api/admin/ai-providers/:id', guard('ai_providers.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    try {
      await deleteAIProvider(id)
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  // ---- Activate ----

  server.post('/api/admin/ai-providers/:id/activate', guard('ai_providers.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const provider = await getAIProvider(id)
    if (!provider) return reply.status(404).send({ error: 'Provider not found' })

    if (!provider.apiKey) {
      return reply.status(400).send({ error: 'Cannot activate: No API key configured. Test the connection first.' })
    }

    // Test connection first
    const validation = await validateProviderConnection(provider.provider, provider.category, provider.apiKey, provider.baseUrl, provider.model)
    if (!validation.ok) {
      return reply.status(400).send({ error: `Cannot activate: ${validation.message}` })
    }

    // Margin guard: activating a provider with unprofitable pricing must be blocked.
    // Only ADMIN-APPROVED pricing versions can back an active provider — a pending
    // proposal is not enough to activate routing.
    const pricing = await getActivePricingVersion(provider.provider, provider.category)
    if (!pricing) {
      return reply.status(400).send({ error: 'Cannot activate: No approved pricing version for this provider. Add and approve pricing in Admin > AI Providers > Costs first.' })
    }
    const margin = await checkProposedMargin([{
      provider: provider.provider,
      category: provider.category,
      inputRate: pricing.inputRate,
      outputRate: pricing.outputRate,
      imageRate: pricing.imageRate,
      audioRate: pricing.audioRate,
    }])
    if (margin.result === 'BLOCK') {
      return reply.status(400).send({
        error: `Cannot activate: this pricing would make package(s) unprofitable: ${margin.lossPackages.join(', ')}. Increase package pricing or lower provider cost first.`,
        marginStatus: margin.result,
        lossPackages: margin.lossPackages,
      })
    }

    try {
      await setActiveAIProvider(id, provider.category)
      await providerManager.reload(provider.category)
      return reply.send({ success: true, activeProvider: provider.displayName, validation, marginStatus: margin.result })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  // ---- Test Connection ----

  server.post('/api/admin/ai-providers/:id/test', guard('ai_providers.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const provider = await getAIProvider(id)
    if (!provider) return reply.status(404).send({ error: 'Provider not found' })

    if (!provider.apiKey) {
      return reply.send({ ok: false, message: 'No API key configured', latencyMs: 0 })
    }

    // Dynamic import to avoid circular deps
    const { groqSTT } = await import('../../lib/ai/providers/groq.js')
    const { openaiSTT } = await import('../../lib/ai/providers/openai-stt.js')
    const { deepseekLLM } = await import('../../lib/ai/providers/deepseek.js')
    const { mistralLLM } = await import('../../lib/ai/providers/mistral.js')
    const { openaiLLM } = await import('../../lib/ai/providers/openai-llm.js')
    const { anthropicLLM } = await import('../../lib/ai/providers/anthropic.js')
    const { openaiImage } = await import('../../lib/ai/providers/openai-image.js')
    const { geminiImage } = await import('../../lib/ai/providers/gemini.js')
    const { stabilityImage } = await import('../../lib/ai/providers/stability.js')

    const adapters: Record<string, any> = {
      groq: groqSTT, 'openai-stt': openaiSTT,
      'groq-whisper': groqSTT, 'openai-whisper': openaiSTT,
      deepseek: deepseekLLM, mistral: mistralLLM, openai: openaiLLM, anthropic: anthropicLLM,
      'openai-image': openaiImage, 'gpt-image': openaiImage, gemini: geminiImage, stability: stabilityImage, 'stability-ai': stabilityImage,
    }

    // For image category with provider name 'openai', use openai-image adapter
    const adapterKey = provider.category === 'image' && provider.provider === 'openai'
      ? 'openai-image'
      : provider.provider

    const adapter = adapters[adapterKey]
    if (!adapter) {
      return reply.send({ ok: false, message: `No adapter for provider: ${provider.provider}`, latencyMs: 0 })
    }

    const result = await adapter.testConnection(provider.apiKey, provider.baseUrl, provider.model)

    // Auto-activate on successful test if not already active
    let activated = false
    if (result.ok && !provider.isActive) {
      try {
        await setActiveAIProvider(id, provider.category)
        await providerManager.reload(provider.category)
        activated = true
      } catch (err) {
        // Activation failed (e.g., cost config missing), but test passed
        result.message += ` (Test passed but activation failed: ${(err as Error).message})`
      }
    }

    return reply.send({ ...result, activated })
  })

  // ---- Costs ----

  server.get('/api/admin/ai-providers/costs', guard('ai_providers.view'), async (_req: any, reply: any) => {
    const costs = await listAICosts()
    return reply.send({ costs })
  })

  server.get('/api/admin/ai-providers/cost-versions', guard('ai_providers.view'), async (req: any, reply: any) => {
    const { provider, category } = req.query as { provider?: string; category?: AIProviderCategory }
    if (!provider || !category) {
      return reply.status(400).send({ error: 'Missing required query params: provider, category' })
    }
    const versions = await listAICostVersions(provider, category as AIProviderCategory)
    return reply.send({ versions })
  })

  server.put('/api/admin/ai-providers/costs', guard('ai_providers.update'), async (req: any, reply: any) => {
    const { provider, category, costPer1MInputTokens, costPer1MOutputTokens, costPerImage, costPerAudioMinute } = req.body as {
      provider: string
      category: AIProviderCategory
      costPer1MInputTokens?: number
      costPer1MOutputTokens?: number
      costPerImage?: number
      costPerAudioMinute?: number
    }

    if (!provider || !category) {
      return reply.status(400).send({ error: 'Missing required fields: provider, category' })
    }

    // Merge with existing cost so partial updates don't zero-out other rates
    const existing = await getAICost(provider, category)
    const merged = {
      inputRate: costPer1MInputTokens ?? existing?.costPer1MInputTokens ?? 0,
      outputRate: costPer1MOutputTokens ?? existing?.costPer1MOutputTokens ?? 0,
      imageRate: costPerImage ?? existing?.costPerImage ?? 0,
      audioRate: costPerAudioMinute ?? existing?.costPerAudioMinute ?? 0,
    }

    // Margin guard: block changes that would push any package into a loss.
    const margin = await checkProposedMargin([{ provider, category, ...merged }])
    if (margin.result === 'BLOCK') {
      return reply.status(400).send({
        error: `Pricing change blocked: it would make package(s) unprofitable: ${margin.lossPackages.join(', ')}. Increase package pricing or lower the cost first.`,
        marginStatus: margin.result,
        lossPackages: margin.lossPackages,
      })
    }

    try {
      // Pricing changes are NOT applied immediately — they create a PENDING
      // proposal that must be reviewed and approved by an admin before it
      // becomes the active version. Nothing is mutated here for BLOCK/approval
      // cases beyond the proposal row itself.
      const proposal = await createCostVersionProposal({
        provider,
        category,
        inputRate: merged.inputRate,
        outputRate: merged.outputRate,
        imageRate: merged.imageRate,
        audioRate: merged.audioRate,
        source: 'admin',
        lastVerifiedAt: new Date().toISOString(),
      })
      return reply.status(201).send({ proposal, marginStatus: margin.result, message: 'Pricing proposal created — awaiting admin approval.' })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.post('/api/admin/ai-providers/cost-versions/:id/approve', guard('ai_providers.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    try {
      const result = await approveCostVersion(id)
      if (!result.ok) {
        return reply.status(400).send({ error: result.error, marginStatus: result.marginStatus, lossPackages: result.lossPackages })
      }
      return reply.send({ success: true, marginStatus: result.marginStatus })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.post('/api/admin/ai-providers/cost-versions/:id/reject', guard('ai_providers.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    try {
      const result = await rejectCostVersion(id)
      if (!result.ok) {
        return reply.status(400).send({ error: result.error })
      }
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  // ---- Stats & History ----

  server.get('/api/admin/ai-providers/stats', guard('ai_providers.view'), async (req: any, reply: any) => {
    const { from, to, category, providerId } = req.query as {
      from?: string; to?: string; category?: AIProviderCategory; providerId?: string
    }
    const stats = await getAIUsageStats({ from, to, category: category as AIProviderCategory, providerId })
    return reply.send(stats)
  })

  server.get('/api/admin/ai-providers/history', guard('ai_providers.view'), async (req: any, reply: any) => {
    const { limit, offset, phone, providerId, category } = req.query as {
      limit?: string; offset?: string; phone?: string; providerId?: string; category?: AIProviderCategory
    }
    const logs = await listAIUsageLogs({
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
      phone,
      providerId,
      category: category as AIProviderCategory,
    })
    return reply.send({ logs })
  })
}
