import { config } from '../config.js'
import { fetchWithRetry } from './http.js'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chat(messages: ChatMessage[], opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
  if (!config.llm.apiKey) throw new Error('LLM_API_KEY is not set')
  const { json = false, temperature = 0.7 } = opts
  const body: Record<string, unknown> = {
    model: config.llm.model,
    messages,
    temperature,
  }
  if (json) {
    body.response_format = { type: 'json_object' }
  }

  const res = await fetchWithRetry(`${config.llm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[]
    error?: unknown
  }
  if (!res.ok) throw new Error(`LLM failed ${res.status}: ${JSON.stringify(data.error ?? data)}`)
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM returned empty response')
  return content
}

export async function chatJson<T>(messages: ChatMessage[], opts: { temperature?: number } = {}): Promise<T> {
  const raw = await chat(messages, { json: true, temperature: opts.temperature })
  const text = raw.trim()
  const json = text.startsWith('```')
    ? text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    : text
  return JSON.parse(json) as T
}
