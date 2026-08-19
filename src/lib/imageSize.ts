export type ImageSize = '1:1' | '4:5' | '16:9' | '9:16' | '3:4'

export const DEFAULT_IMAGE_SIZE: ImageSize = '1:1'

const SIZE_MAP: Array<{ ratio: ImageSize; keywords: RegExp }> = [
  { ratio: '9:16', keywords: /\b(9\s*[:x]\s*16|story|reels|1080x1920|tall|vertical\s*(story|reels))\b/i },
  { ratio: '1:1', keywords: /\b(square|1\s*[:x]\s*1|1080x1080)\b/i },
  { ratio: '4:5', keywords: /\b(4\s*[:x]\s*5|portrait|1080x1350)\b/i },
  { ratio: '3:4', keywords: /\b(3\s*[:x]\s*4)\b/i },
  { ratio: '16:9', keywords: /\b(16\s*[:x]\s*9|landscape|wide|1920x1080)\b/i },
]

// Maps user-spoken sizes to the aspect-ratio palette. Order matters: story/reels
// keywords are checked first so 'vertical story' resolves to 9:16, not 4:5.
export function parseImageSize(text: string | undefined): ImageSize {
  if (!text) return DEFAULT_IMAGE_SIZE
  for (const entry of SIZE_MAP) {
    if (entry.keywords.test(text)) return entry.ratio
  }
  return DEFAULT_IMAGE_SIZE
}

// Provider-specific dimension/ratio values.
export function openaiSize(size: ImageSize): string {
  const map: Record<ImageSize, string> = {
    '1:1': '1024x1024',
    '4:5': '1024x1536',
    '3:4': '1024x1536',
    '16:9': '1536x1024',
    '9:16': '1024x1792',
  }
  return map[size]
}

export function stabilityAspectRatio(size: ImageSize): string {
  const map: Record<ImageSize, string> = {
    '1:1': '1:1',
    '4:5': '4:5',
    '3:4': '3:4',
    '16:9': '16:9',
    '9:16': '9:16',
  }
  return map[size]
}

export function geminiSizePrompt(size: ImageSize): string {
  const map: Record<ImageSize, string> = {
    '1:1': 'square 1080x1080',
    '4:5': 'portrait 1080x1350 (4:5)',
    '3:4': 'portrait 1080x1440 (3:4)',
    '16:9': 'landscape 1920x1080 (16:9)',
    '9:16': 'vertical 1080x1920 (9:16)',
  }
  return map[size]
}