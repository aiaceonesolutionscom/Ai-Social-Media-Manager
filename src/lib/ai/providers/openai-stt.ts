import { fetchWithRetry } from '../../http.js'
import type { STTProviderAdapter, TranscribeOptions, TranscribeResult, TestResult } from './base.js'

export const openaiSTT: STTProviderAdapter = {
  name: 'openai-stt',
  category: 'stt',

  async transcribe(apiKey: string, baseUrl: string, model: string, audioBuffer: Buffer, options?: TranscribeOptions): Promise<TranscribeResult> {
    const start = Date.now()
    const form = new FormData()
    form.append('file', new Blob([audioBuffer]), 'voice.ogg')
    form.append('model', model || 'whisper-1')
    form.append('response_format', options?.responseFormat || 'json')

    const res = await fetchWithRetry(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    const body = (await res.json().catch(() => ({}))) as { text?: string; error?: unknown }
    if (!res.ok) throw new Error(`OpenAI STT failed ${res.status}: ${JSON.stringify(body.error ?? body)}`)
    const text = body.text?.trim()
    if (!text) throw new Error('OpenAI STT returned empty transcript')
    return { text, durationMs: Date.now() - start }
  },

  async testConnection(apiKey: string, baseUrl: string, model: string): Promise<TestResult> {
    const start = Date.now()
    try {
      const res = await fetchWithRetry(`${baseUrl}/models`, {
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
