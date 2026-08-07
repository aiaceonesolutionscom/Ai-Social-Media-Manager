import type { WrittenContent } from '../types.js'

export function fullCaption(content: WrittenContent): string {
  return [content.hook, content.caption, content.cta, content.emojis, content.hashtags].join('\n\n')
}

export function platformCaption(content: WrittenContent, platform: 'facebook' | 'instagram'): string {
  return fullCaption(content)
}

export function previewCaption(content: WrittenContent, platformLabel: string): string {
  return `[${platformLabel}]\n\n${fullCaption(content)}`
}
