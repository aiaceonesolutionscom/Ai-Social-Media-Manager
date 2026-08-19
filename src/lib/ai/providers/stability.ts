import { fetchWithRetry } from '../../http.js'
import type { ImageProviderAdapter, ImageOptions, ImageResult, TestResult } from './base.js'

export const stabilityImage: ImageProviderAdapter = {
  name: 'stability',
  category: 'image',

  async generate(apiKey: string, baseUrl: string, model: string, prompt: string, options?: ImageOptions): Promise<ImageResult> {
    const start = Date.now()
    const res = await fetchWithRetry(`${baseUrl.replace(/\/$/, '')}/stable-image/generate/core`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'image/*',
      },
      body: new URLSearchParams({ prompt, aspect_ratio: options?.size || '1:1' }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`Stability image failed ${res.status}: ${text.slice(0, 300)}`)
    }
    return { buffer: Buffer.from(await res.arrayBuffer()), durationMs: Date.now() - start }
  },

  async testConnection(apiKey: string, baseUrl: string, model: string): Promise<TestResult> {
    const start = Date.now()
    try {
      const res = await fetchWithRetry(`${baseUrl.replace(/\/$/, '')}/user/balance`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { ok: false, message: `Stability API error ${res.status}: ${JSON.stringify(body)}`, latencyMs: Date.now() - start }
      }
      return { ok: true, message: 'Stability connection successful', latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, message: `Stability connection failed: ${(err as Error).message}`, latencyMs: Date.now() - start }
    }
  },
}
