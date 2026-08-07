import { providerManager } from './ai/providerManager.js'

export async function transcribeAudio(filePath: string): Promise<string> {
  return providerManager.transcribeAudio(filePath)
}
