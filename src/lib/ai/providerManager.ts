import { readFile } from 'node:fs/promises'
import { config } from '../../config.js'
import { logger } from '../logger.js'
import { getActiveAIProvider, logAIUsage, getAICost } from '../../store.js'
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

  async transcribeAudio(filePath: string, phone?: string): Promise<string> {
    // Dev mode fallback
    if (config.dev.enabled && !this.sttAdapter) {
      logger.info({}, 'DEV MODE: STT skipped (no active provider) — returning mock transcript')
      return 'Create a social media post about the launch of my new coffee shop for busy professionals in the city.'
    }

    if (!this.sttAdapter || !this.sttProvider) {
      throw new Error('No active STT provider configured. Set one in Admin > AI Providers.')
    }

    const audioBuffer = await readFile(filePath)
    const result = await this.sttAdapter.transcribe(
      this.sttProvider.apiKey,
      this.sttProvider.baseUrl,
      this.sttProvider.model,
      audioBuffer,
    )

    // Log usage
    const cost = await getAICost(this.sttProvider.provider, 'stt')
    const costCents = cost ? Math.ceil((result.durationMs / 60000) * cost.costPerAudioMinute) : 0

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
      success: true,
      error: '',
    }).catch((err) => logger.warn({ error: err.message }, 'Failed to log STT usage'))

    return result.text
  }

  // ---- LLM ----

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    if (!this.llmAdapter || !this.llmProvider) {
      throw new Error('No active LLM provider configured. Set one in Admin > AI Providers.')
    }

    const result = await this.llmAdapter.chat(
      this.llmAdapter.name === 'anthropic' ? this.llmProvider.apiKey : this.llmProvider.apiKey,
      this.llmProvider.baseUrl,
      this.llmProvider.model,
      messages,
      opts,
    )

    // Log usage
    const cost = await getAICost(this.llmProvider.provider, 'llm')
    const costCents = cost
      ? Math.ceil(
          (result.tokensInput * cost.costPer1MInputTokens + result.tokensOutput * cost.costPer1MOutputTokens) / 1_000_000
        )
      : 0

    logAIUsage({
      phone: '',
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
    }).catch((err) => logger.warn({ error: err.message }, 'Failed to log LLM usage'))

    return result.content
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

  async generateImage(prompt: string): Promise<Buffer> {
    // Dev mode fallback
    if (config.dev.enabled && !this.imageAdapter) {
      logger.info({ prompt: prompt.slice(0, 80) }, 'DEV MODE: image generation skipped — returning placeholder PNG')
      const { placeholderPng } = await import('../image.js')
      return placeholderPng(1024, 1024)
    }

    if (!this.imageAdapter || !this.imageProvider) {
      throw new Error('No active image provider configured. Set one in Admin > AI Providers.')
    }

    const result = await this.imageAdapter.generate(
      this.imageProvider.apiKey,
      this.imageProvider.baseUrl,
      this.imageProvider.model,
      prompt,
    )

    // Log usage
    const cost = await getAICost(this.imageProvider.provider, 'image')
    const costCents = cost ? cost.costPerImage : 0

    logAIUsage({
      phone: '',
      providerId: this.imageProvider.id,
      category: 'image',
      model: this.imageProvider.model,
      feature: 'generate',
      tokensInput: 0,
      tokensOutput: 0,
      estimatedCostCents: costCents,
      durationMs: result.durationMs,
      success: true,
      error: '',
    }).catch((err) => logger.warn({ error: err.message }, 'Failed to log image usage'))

    return result.buffer
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
