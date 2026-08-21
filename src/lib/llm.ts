import { providerManager } from './ai/providerManager.js'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chat(messages: ChatMessage[], opts: { json?: boolean; temperature?: number; phone?: string } = {}): Promise<string> {
  return providerManager.chat(messages, opts)
}

export async function chatJson<T>(messages: ChatMessage[], opts: { temperature?: number; phone?: string; maxTokens?: number } = {}): Promise<T> {
  return providerManager.chatJson<T>(messages, opts)
}
