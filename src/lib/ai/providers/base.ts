import type { AIProviderCategory } from '../../../types.js'

export interface TranscribeOptions {
  responseFormat?: 'json' | 'text'
  durationMs?: number
}

export interface TranscribeResult {
  text: string
  durationMs: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  json?: boolean
  temperature?: number
  phone?: string
  maxTokens?: number
}

export interface ChatResult {
  content: string
  tokensInput: number
  tokensOutput: number
  durationMs: number
  finishReason?: string
  truncated?: boolean
}

export interface ImageOptions {
  size?: string
  n?: number
}

export interface ImageResult {
  buffer: Buffer
  durationMs: number
}

export interface TestResult {
  ok: boolean
  message: string
  latencyMs: number
}

export interface STTProviderAdapter {
  name: string
  category: 'stt'
  transcribe(apiKey: string, baseUrl: string, model: string, audioBuffer: Buffer, options?: TranscribeOptions): Promise<TranscribeResult>
  testConnection(apiKey: string, baseUrl: string, model: string): Promise<TestResult>
}

export interface LLMProviderAdapter {
  name: string
  category: 'llm'
  chat(apiKey: string, baseUrl: string, model: string, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>
  testConnection(apiKey: string, baseUrl: string, model: string): Promise<TestResult>
}

export interface ImageProviderAdapter {
  name: string
  category: 'image'
  generate(apiKey: string, baseUrl: string, model: string, prompt: string, options?: ImageOptions): Promise<ImageResult>
  testConnection(apiKey: string, baseUrl: string, model: string): Promise<TestResult>
}

export type ProviderAdapter = STTProviderAdapter | LLMProviderAdapter | ImageProviderAdapter
