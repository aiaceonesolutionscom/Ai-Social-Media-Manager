import { fetchWithRetry } from '../../http.js'
import type { ImageProviderAdapter, ImageOptions, ImageResult, TestResult } from './base.js'

export const geminiImage: ImageProviderAdapter = {
  name: 'gemini',
  category: 'image',

  async generate(apiKey: string, baseUrl: string, model: string, prompt: string, options?: ImageOptions): Promise<ImageResult> {
    const start = Date.now()
    const modelName = model || 'gemini-2.0-flash-preview-image-generation'
    // P5-11 — the API key is sent as the X-Goog-Api-Key header, never as a query
    // parameter (query params leak into access logs and history).
    const url = `${baseUrl.replace(/\/$/, '')}/models/${modelName}:generateContent`

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Do NOT put any text in the image. ${prompt}` }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[]
      error?: unknown
    }
    if (!res.ok) throw new Error(`Gemini image failed ${res.status}: ${JSON.stringify(data.error ?? data)}`)
    const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data
    if (!b64) throw new Error('Gemini returned no image data')
    return { buffer: Buffer.from(b64, 'base64'), durationMs: Date.now() - start }
  },

  async testConnection(apiKey: string, baseUrl: string, model: string): Promise<TestResult> {
    const start = Date.now()
    try {
      const modelName = model || 'gemini-2.0-flash-preview-image-generation'
      const url = `${baseUrl.replace(/\/$/, '')}/models/${modelName}`
      const res = await fetchWithRetry(url, { method: 'GET', headers: { 'X-Goog-Api-Key': apiKey } })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { ok: false, message: `Gemini API error ${res.status}: ${JSON.stringify(body)}`, latencyMs: Date.now() - start }
      }
      return { ok: true, message: 'Gemini connection successful', latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, message: `Gemini connection failed: ${(err as Error).message}`, latencyMs: Date.now() - start }
    }
  },
}
