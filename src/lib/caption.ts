import type { WrittenContent } from '../types.js'

export function fullCaption(content: WrittenContent): string {
  return [content.hook, content.caption, content.cta, content.emojis, content.hashtags].join('\n\n')
}
