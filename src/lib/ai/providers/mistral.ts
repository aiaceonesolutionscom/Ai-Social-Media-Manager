import { fetchWithRetry } from '../../http.js'
import type { LLMProviderAdapter, ChatMessage, ChatOptions, ChatResult, TestResult } from './base.js'

export const mistralLLM: LLMProviderAdapter = {
  name: 'mistral',
  category: 'llm',

  async chat(apiKey: string, baseUrl: string, model: string, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const start = Date.now()
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
    }
    if (options?.json) {
      body.response_format = { type: 'json_object' }
    }
    if (options?.maxTokens) {
      body.max_tokens = options.maxTokens
    }

    const res = await fetchWithRetry(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      error?: unknown
    }
    if (!res.ok) throw new Error(`Mistral LLM failed ${res.status}: ${JSON.stringify(data.error ?? data)}`)
    const choice = data.choices?.[0]
    const content = choice?.message?.content
    if (!content) throw new Error('Mistral LLM returned empty response')
    return {
      content,
      tokensInput: data.usage?.prompt_tokens ?? 0,
      tokensOutput: data.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - start,
      finishReason: choice?.finish_reason,
      truncated: choice?.finish_reason === 'length',
    }
  },

  async testConnection(apiKey: string, baseUrl: string, model: string): Promise<TestResult> {
    const start = Date.now()
    try {
      const res = await fetchWithRetry(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say "ok"' }],
          max_tokens: 5,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { ok: false, message: `Mistral API error ${res.status}: ${JSON.stringify(body)}`, latencyMs: Date.now() - start }
      }
      return { ok: true, message: 'Mistral connection successful', latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, message: `Mistral connection failed: ${(err as Error).message}`, latencyMs: Date.now() - start }
    }
  },
}
