import { fetchWithRetry } from '../../http.js'
import type { LLMProviderAdapter, ChatMessage, ChatOptions, ChatResult, TestResult } from './base.js'

export const anthropicLLM: LLMProviderAdapter = {
  name: 'anthropic',
  category: 'llm',

  async chat(apiKey: string, baseUrl: string, model: string, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const start = Date.now()
    const systemMsg = messages.find((m) => m.role === 'system')
    const nonSystem = messages.filter((m) => m.role !== 'system')

    const body: Record<string, unknown> = {
      model,
      messages: nonSystem,
      max_tokens: 4096,
      temperature: options?.temperature ?? 0.7,
    }
    if (systemMsg) body.system = systemMsg.content

    const res = await fetchWithRetry(`${baseUrl.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as {
      content?: { type: string; text?: string }[]
      usage?: { input_tokens?: number; output_tokens?: number }
      error?: unknown
    }
    if (!res.ok) throw new Error(`Anthropic LLM failed ${res.status}: ${JSON.stringify(data.error ?? data)}`)
    const content = data.content?.find((c) => c.type === 'text')?.text
    if (!content) throw new Error('Anthropic LLM returned empty response')
    return {
      content,
      tokensInput: data.usage?.input_tokens ?? 0,
      tokensOutput: data.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
    }
  },

  async testConnection(apiKey: string, baseUrl: string, model: string): Promise<TestResult> {
    const start = Date.now()
    try {
      const res = await fetchWithRetry(`${baseUrl.replace(/\/$/, '')}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
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
        return { ok: false, message: `Anthropic API error ${res.status}: ${JSON.stringify(body)}`, latencyMs: Date.now() - start }
      }
      return { ok: true, message: 'Anthropic connection successful', latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, message: `Anthropic connection failed: ${(err as Error).message}`, latencyMs: Date.now() - start }
    }
  },
}
