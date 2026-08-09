import { FastifyInstance } from 'fastify'
import {
  createAIProvider, listAIProviders, getAIProvider, updateAIProvider, deleteAIProvider,
  setActiveAIProvider, getActiveAIProvider,
  listAICosts, upsertAICost, getAICost,
  getAIUsageStats, listAIUsageLogs,
} from '../../store.js'
import { providerManager } from '../../lib/ai/providerManager.js'
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
    const { category, provider, displayName, apiKey, baseUrl, model, config: cfg } = req.body as {
      category: AIProviderCategory
      provider: string
      displayName: string
      apiKey?: string
      baseUrl?: string
      model?: string
      config?: Record<string, unknown>
    }

    if (!category || !provider || !displayName) {
      return reply.status(400).send({ error: 'Missing required fields: category, provider, displayName' })
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return reply.status(400).send({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` })
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
      })
      return reply.status(201).send({ provider: { ...p, apiKey: p.apiKey ? `${p.apiKey.slice(0, 8)}••••••••` : '' } })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.put('/api/admin/ai-providers/:id', guard('ai_providers.update'), async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const patch = req.body as Partial<{
      provider: string
      displayName: string
      apiKey: string
      baseUrl: string
      model: string
      config: Record<string, unknown>
    }>

    try {
      const p = await updateAIProvider(id, patch)
      return reply.send({ provider: { ...p, apiKey: p.apiKey ? `${p.apiKey.slice(0, 8)}••••••••` : '' } })
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

    try {
      await setActiveAIProvider(id, provider.category)
      await providerManager.reload(provider.category)
      return reply.send({ success: true, activeProvider: provider.displayName })
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
    return reply.send(result)
  })

  // ---- Costs ----

  server.get('/api/admin/ai-providers/costs', guard('ai_providers.view'), async (_req: any, reply: any) => {
    const costs = await listAICosts()
    return reply.send({ costs })
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

    try {
      const cost = await upsertAICost({ provider, category, costPer1MInputTokens, costPer1MOutputTokens, costPerImage, costPerAudioMinute })
      return reply.send({ cost })
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
