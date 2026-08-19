import { providerManager } from './ai/providerManager.js'

export async function transcribeAudio(filePath: string, opts?: { phone?: string; durationMs?: number }): Promise<string> {
  return providerManager.transcribeAudio(filePath, opts)
}
