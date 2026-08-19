import { readFile } from 'node:fs/promises'
import { config } from '../../config.js'
import { logger } from '../logger.js'
import { getActiveAIProvider, logAIUsage, getActivePricingVersion } from '../../store.js'
import type { AIProviderCategory, AIProvider } from '../../types.js'
import type { STTProviderAdapter, LLMProviderAdapter, ImageProviderAdapter, ChatMessage, ChatOptions, TranscribeOptions, ImageOptions } from './providers/base.js'
import { groqSTT } from './providers/groq.js'
import { openaiSTT } from './providers/openai-stt.js'
import { deepseekLLM } from './providers/deepseek.js'
import { mistralLLM } from './providers/mistral.js'
import { openaiLLM } from './providers/openai-llm.js'
import { anthropicLLM } from './providers/anthropic.js'
import { openaiImage } from './providers/openai-image.js'
import { geminiImage } from './providers/gemini.js'
import { stabilityImage } from './providers/stability.js'
import { openaiSize, stabilityAspectRatio, type ImageSize } from '../imageSize.js'

const STT_ADAPTERS: Record<string, STTProviderAdapter> = {
  groq: groqSTT,
  'openai-stt': openaiSTT,
  'groq-whisper': groqSTT,
  'openai-whisper': openaiSTT,
}

const LLM_ADAPTERS: Record<string, LLMProviderAdapter> = {
  deepseek: deepseekLLM,
  mistral: mistralLLM,
  openai: openaiLLM,
  anthropic: anthropicLLM,
}

const IMAGE_ADAPTERS: Record<string, ImageProviderAdapter> = {
  openai: openaiImage,
  gemini: geminiImage,
  stability: stabilityImage,
  'gpt-image': openaiImage,
  'openai-image': openaiImage,
  'stability-ai': stabilityImage,
}

class ProviderManager {
  private sttAdapter: STTProviderAdapter | null = null
  private llmAdapter: LLMProviderAdapter | null = null
  private imageAdapter: ImageProviderAdapter | null = null
  private sttProvider: AIProvider | null = null
  private llmProvider: AIProvider | null = null
  private imageProvider: AIProvider | null = null
  private loaded = false

  async load(): Promise<void> {
    try {
      const stt = await getActiveAIProvider('stt')
      if (stt) {
        this.sttProvider = stt
        this.sttAdapter = STT_ADAPTERS[stt.provider] || null
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to load STT provider')
    }

    try {
      const llm = await getActiveAIProvider('llm')
      if (llm) {
        this.llmProvider = llm
        this.llmAdapter = LLM_ADAPTERS[llm.provider] || null
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to load LLM provider')
    }

    try {
      const image = await getActiveAIProvider('image')
      if (image) {
        this.imageProvider = image
        this.imageAdapter = IMAGE_ADAPTERS[image.provider] || null
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to load image provider')
    }

    this.loaded = true
    logger.info({
      stt: this.sttProvider?.provider || 'none',
      llm: this.llmProvider?.provider || 'none',
      image: this.imageProvider?.provider || 'none',
    }, 'AI providers loaded')
  }

  async reload(category?: AIProviderCategory): Promise<void> {
    if (!category || category === 'stt') {
      this.sttAdapter = null
      this.sttProvider = null
      try {
        const stt = await getActiveAIProvider('stt')
        if (stt) {
          this.sttProvider = stt
          this.sttAdapter = STT_ADAPTERS[stt.provider] || null
        }
      } catch {}
    }
    if (!category || category === 'llm') {
      this.llmAdapter = null
      this.llmProvider = null
      try {
        const llm = await getActiveAIProvider('llm')
        if (llm) {
          this.llmProvider = llm
          this.llmAdapter = LLM_ADAPTERS[llm.provider] || null
        }
      } catch {}
    }
    if (!category || category === 'image') {
      this.imageAdapter = null
      this.imageProvider = null
      try {
        const image = await getActiveAIProvider('image')
        if (image) {
          this.imageProvider = image
          this.imageAdapter = IMAGE_ADAPTERS[image.provider] || null
        }
      } catch {}
    }
  }

  // ---- STT ----

  async transcribeAudio(filePath: string, opts?: { phone?: string; durationMs?: number }): Promise<string> {
    const phone = opts?.phone
    // Dev mode fallback
    if (config.dev.enabled && !this.sttAdapter) {
      logger.info({}, 'DEV MODE: STT skipped (no active provider) — returning mock transcript')
      return 'Create a social media post about the launch of my new coffee shop for busy professionals in the city.'
    }

    if (!this.sttAdapter || !this.sttProvider) {
      throw new Error(
        'No active Speech-to-Text provider configured. ' +
        'Go to Admin > AI Providers > Speech-to-Text, add a provider (Groq Whisper or OpenAI Whisper), ' +
        'enter your API key, test it, and activate it.'
      )
    }

    // Resolve the ACTIVE pricing version BEFORE calling the provider. If no
    // pricing is configured the operation is blocked before any API call is
    // made (no silent-zero cost, no wasted spend) and an unpriced usage row is
    // logged so the admin can see exactly what was blocked.
    const pricing = await getActivePricingVersion(this.sttProvider.provider, 'stt')
    if (!pricing) {
      await logAIUsage({
        phone: phone || '',
        providerId: this.sttProvider.id,
        category: 'stt',
        model: this.sttProvider.model,
        feature: 'transcribe',
        tokensInput: 0,
        tokensOutput: 0,
        estimatedCostCents: 0,
        durationMs: 0,
        audioSeconds: 0,
        success: true,
        error: '',
        pricingVersionId: null,
        unpriced: true,
        cachedInputTokens: 0,
      }).catch((err) => logger.warn({ error: err.message }, 'Failed to log STT usage'))
      throw new Error(
        'Speech-to-Text operation blocked: no pricing configured for ' +
        `${this.sttProvider.provider} ${this.sttProvider.model}. ` +
        'Add pricing in Admin > AI Providers > Costs before generating content.'
      )
    }

    try {
      const audioBuffer = await readFile(filePath)
      const result = await this.sttAdapter.transcribe(
        this.sttProvider.apiKey,
        this.sttProvider.baseUrl,
        this.sttProvider.model,
        audioBuffer,
        { durationMs: opts?.durationMs },
      )

      const costCents = Math.ceil((result.durationMs / 60000) * pricing.audioRate)

      logAIUsage({
        phone: phone || '',
        providerId: this.sttProvider.id,
        category: 'stt',
        model: this.sttProvider.model,
        feature: 'transcribe',
        tokensInput: 0,
        tokensOutput: 0,
        estimatedCostCents: costCents,
        durationMs: result.durationMs,
        audioSeconds: Math.round(result.durationMs / 1000),
        success: true,
        error: '',
        pricingVersionId: pricing.id,
        unpriced: false,
        cachedInputTokens: 0,
      }).catch((err) => logger.warn({ error: err.message }, 'Failed to log STT usage'))

      return result.text
    } catch (err) {
      const error = err as Error
      logger.error({ 
        provider: this.sttProvider.provider, 
        model: this.sttProvider.model, 
        error: error.message 
      }, 'STT transcription failed')
      throw new Error(
        `Speech-to-Text failed with ${this.sttProvider.provider} (${this.sttProvider.model}): ${error.message}. ` +
        'Check your API key and model in Admin > AI Providers.'
      )
    }
  }

  // ---- LLM ----

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    if (!this.llmAdapter || !this.llmProvider) {
      throw new Error(
        'No active Language Model provider configured. ' +
        'Go to Admin > AI Providers > Language Model, add a provider (DeepSeek, Mistral, OpenAI, or Anthropic), ' +
        'enter your API key, test it, and activate it.'
      )
    }

    // Resolve pricing BEFORE calling the provider — a missing pricing version
    // blocks the request before any API spend happens.
    const pricing = await getActivePricingVersion(this.llmProvider.provider, 'llm')
    if (!pricing) {
      await logAIUsage({
        phone: opts.phone || '',
        providerId: this.llmProvider.id,
        category: 'llm',
        model: this.llmProvider.model,
        feature: opts.json ? 'chat_json' : 'chat',
        tokensInput: 0,
        tokensOutput: 0,
        estimatedCostCents: 0,
        durationMs: 0,
        success: true,
        error: '',
        pricingVersionId: null,
        unpriced: true,
        cachedInputTokens: 0,
      }).catch((err) => logger.warn({ error: err.message }, 'Failed to log LLM usage'))
      throw new Error(
        'Language Model operation blocked: no pricing configured for ' +
        `${this.llmProvider.provider} ${this.llmProvider.model}. ` +
        'Add pricing in Admin > AI Providers > Costs before generating content.'
      )
    }

    try {
      const result = await this.llmAdapter.chat(
        this.llmAdapter.name === 'anthropic' ? this.llmProvider.apiKey : this.llmProvider.apiKey,
        this.llmProvider.baseUrl,
        this.llmProvider.model,
        messages,
        opts,
      )

      const costCents = Math.ceil(
        (result.tokensInput * pricing.inputRate + result.tokensOutput * pricing.outputRate) / 1_000_000
      )

      logAIUsage({
        phone: opts.phone || '',
        providerId: this.llmProvider.id,
        category: 'llm',
        model: this.llmProvider.model,
        feature: opts.json ? 'chat_json' : 'chat',
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        estimatedCostCents: costCents,
        durationMs: result.durationMs,
        success: true,
        error: '',
        pricingVersionId: pricing.id,
        unpriced: false,
        cachedInputTokens: 0,
      }).catch((err) => logger.warn({ error: err.message }, 'Failed to log LLM usage'))

      return result.content
    } catch (err) {
      const error = err as Error
      logger.error({ 
        provider: this.llmProvider.provider, 
        model: this.llmProvider.model, 
        error: error.message 
      }, 'LLM chat failed')
      throw new Error(
        `Language Model failed with ${this.llmProvider.provider} (${this.llmProvider.model}): ${error.message}. ` +
        'Check your API key and model in Admin > AI Providers > Language Model.'
      )
    }
  }

  async chatJson<T>(messages: ChatMessage[], opts: { temperature?: number } = {}): Promise<T> {
    const raw = await this.chat(messages, { json: true, temperature: opts.temperature })
    const text = raw.trim()
    const json = text.startsWith('```')
      ? text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
      : text
    return JSON.parse(json) as T
  }

  // ---- Image ----

  async generateImage(prompt: string, phone?: string, options?: ImageOptions): Promise<Buffer> {
    // Dev mode fallback
    if (config.dev.enabled && !this.imageAdapter) {
      logger.info({ prompt: prompt.slice(0, 80) }, 'DEV MODE: image generation skipped — returning placeholder PNG')
      const { placeholderPng } = await import('../image.js')
      return placeholderPng(1024, 1024)
    }

    if (!this.imageAdapter || !this.imageProvider) {
      throw new Error(
        'No active Image Generation provider configured. ' +
        'Go to Admin > AI Providers > Image Generation, add a provider (OpenAI GPT Image, Gemini, or Stability AI), ' +
        'enter your API key, test it, and activate it.'
      )
    }

    // Resolve pricing BEFORE calling the provider — a missing pricing version
    // blocks the request before any API spend happens.
    const pricing = await getActivePricingVersion(this.imageProvider.provider, 'image')
    if (!pricing) {
      await logAIUsage({
        phone: phone || '',
        providerId: this.imageProvider.id,
        category: 'image',
        model: this.imageProvider.model,
        feature: 'generate',
        tokensInput: 0,
        tokensOutput: 0,
        estimatedCostCents: 0,
        durationMs: 0,
        imageCount: 0,
        success: true,
        error: '',
        pricingVersionId: null,
        unpriced: true,
        cachedInputTokens: 0,
      }).catch((err) => logger.warn({ error: err.message }, 'Failed to log image usage'))
      throw new Error(
        'Image Generation operation blocked: no pricing configured for ' +
        `${this.imageProvider.provider} ${this.imageProvider.model}. ` +
        'Add pricing in Admin > AI Providers > Costs before generating content.'
      )
    }

    try {
      let sizeOption: string | undefined
      if (options?.size) {
        if (this.imageProvider.provider === 'stability') {
          sizeOption = stabilityAspectRatio(options.size as ImageSize)
        } else {
          sizeOption = openaiSize(options.size as ImageSize)
        }
      }
      const result = await this.imageAdapter.generate(
        this.imageProvider.apiKey,
        this.imageProvider.baseUrl,
        this.imageProvider.model,
        prompt,
        sizeOption ? { size: sizeOption } : undefined,
      )

      const costCents = pricing.imageRate

      logAIUsage({
        phone: phone || '',
        providerId: this.imageProvider.id,
        category: 'image',
        model: this.imageProvider.model,
        feature: 'generate',
        tokensInput: 0,
        tokensOutput: 0,
        estimatedCostCents: costCents,
        durationMs: result.durationMs,
        imageCount: 1,
        success: true,
        error: '',
        pricingVersionId: pricing.id,
        unpriced: false,
        cachedInputTokens: 0,
      }).catch((err) => logger.warn({ error: err.message }, 'Failed to log image usage'))

      return result.buffer
    } catch (err) {
      const error = err as Error
      logger.error({ 
        provider: this.imageProvider.provider, 
        model: this.imageProvider.model, 
        error: error.message 
      }, 'Image generation failed')
      throw new Error(
        `Image Generation failed with ${this.imageProvider.provider} (${this.imageProvider.model}): ${error.message}. ` +
        'Check your API key and model in Admin > AI Providers > Image Generation.'
      )
    }
  }

  // ---- Status ----

  getStatus(): { stt: string; llm: string; image: string } {
    return {
      stt: this.sttProvider?.provider || 'none',
      llm: this.llmProvider?.provider || 'none',
      image: this.imageProvider?.provider || 'none',
    }
  }
}

export const providerManager = new ProviderManager()

// Validation functions
const ALL_ADAPTERS = {
  stt: STT_ADAPTERS,
  llm: LLM_ADAPTERS,
  image: IMAGE_ADAPTERS,
} as const

export async function validateProviderRegistry(): Promise<void> {
  const { listAIProviders } = await import('../../store.js')
  const allProviders = await listAIProviders()
  
  const issues: string[] = []
  
  for (const provider of allProviders) {
    const adapters = ALL_ADAPTERS[provider.category]
    if (!adapters) {
      issues.push(`Unknown category: ${provider.category} for provider ${provider.displayName}`)
      continue
    }
    
    const adapterKey = provider.category === 'image' && provider.provider === 'openai' 
      ? 'openai-image' 
      : provider.provider
    
    if (!adapters[adapterKey]) {
      issues.push(`No adapter for provider "${provider.provider}" (${provider.category}) - ${provider.displayName}`)
    }
  }
  
  if (issues.length > 0) {
    logger.warn({ issues }, 'Provider registry validation issues found')
  } else {
    logger.info('Provider registry validation passed')
  }
}

export async function validateActiveProviders(): Promise<{ stt: boolean; llm: boolean; image: boolean }> {
  const { getActiveAIProvider } = await import('../../store.js')
  const results = { stt: false, llm: false, image: false }
  
  for (const category of ['stt', 'llm', 'image'] as AIProviderCategory[]) {
    try {
      const provider = await getActiveAIProvider(category)
      if (!provider || !provider.apiKey) {
        continue
      }
      
      const adapters = ALL_ADAPTERS[category]
      const adapterKey = category === 'image' && provider.provider === 'openai' 
        ? 'openai-image' 
        : provider.provider
      const adapter = adapters[adapterKey]
      
      if (!adapter) {
        continue
      }
      
      const result = await adapter.testConnection(provider.apiKey, provider.baseUrl, provider.model)
      results[category] = result.ok
      
      if (!result.ok) {
        logger.warn({ category, provider: provider.provider, error: result.message }, 'Active provider validation failed')
      }
    } catch (err) {
      logger.warn({ category, error: (err as Error).message }, 'Active provider validation error')
    }
  }
  
  return results
}
