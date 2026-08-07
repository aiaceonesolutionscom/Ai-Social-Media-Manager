import { fetchWithRetry } from '../../http.js'
import type { ImageProviderAdapter, ImageOptions, ImageResult, TestResult } from './base.js'

export const openaiImage: ImageProviderAdapter = {
  name: 'openai',
  category: 'image',

  async generate(apiKey: string, baseUrl: string, model: string, prompt: string, options?: ImageOptions): Promise<ImageResult> {
    const start = Date.now()
    const res = await fetchWithRetry(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        n: options?.n ?? 1,
        size: options?.size || '1024x1024',
        response_format: 'b64_json',
      }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      data?: { b64_json?: string }[]
      error?: unknown
    }
    if (!res.ok) throw new Error(`OpenAI image failed ${res.status}: ${JSON.stringify(data.error ?? data)}`)
    const b64 = data.data?.[0]?.b64_json
    if (!b64) throw new Error('OpenAI returned no image')
    return { buffer: Buffer.from(b64, 'base64'), durationMs: Date.now() - start }
  },

  async testConnection(apiKey: string, baseUrl: string, model: string): Promise<TestResult> {
    const start = Date.now()
    try {
      const res = await fetchWithRetry(`${baseUrl.replace(/\/$/, '')}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { ok: false, message: `OpenAI API error ${res.status}: ${JSON.stringify(body)}`, latencyMs: Date.now() - start }
      }
      return { ok: true, message: 'OpenAI connection successful', latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, message: `OpenAI connection failed: ${(err as Error).message}`, latencyMs: Date.now() - start }
    }
  },
}
