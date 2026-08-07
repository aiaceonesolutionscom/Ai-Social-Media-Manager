import { readFile } from 'node:fs/promises'
import { config } from '../config.js'
import { fetchWithRetry } from './http.js'
import { logger } from './logger.js'

export async function transcribeAudio(filePath: string): Promise<string> {
  if (!config.stt.apiKey) {
    if (config.dev.enabled) {
      logger.info({}, 'DEV MODE: STT skipped (no GROQ_API_KEY) — returning mock transcript')
      return 'Create a social media post about the launch of my new coffee shop for busy professionals in the city.'
    }
    throw new Error('GROQ_API_KEY is not set')
  }
  const file = await readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([file]), 'voice.ogg')
  form.append('model', config.stt.model)
  form.append('response_format', 'json')

  const res = await fetchWithRetry(`${config.stt.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.stt.apiKey}` },
    body: form,
  })
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: unknown }
  if (!res.ok) throw new Error(`STT failed ${res.status}: ${JSON.stringify(body.error ?? body)}`)
  const text = body.text?.trim()
  if (!text) throw new Error('STT returned empty transcript')
  return text
}
