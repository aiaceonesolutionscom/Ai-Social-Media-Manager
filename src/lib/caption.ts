import type { PlatformContent, Post, WrittenContent } from '../types.js'

export function fullCaption(content: WrittenContent): string {
  return [content.hook, content.caption, content.cta, content.emojis, content.hashtags].join('\n\n')
}

// Platform-specific text is produced upstream by the per-platform writers
// (generate.ts). This renderer only joins the already-platform-specific fields,
// so there is no second "platform" parameter to mislead callers.
export function platformCaption(content: WrittenContent): string {
  return fullCaption(content)
}

// The single canonical source for "what will actually be published on a
// platform". Publish and preview must BOTH consume this so the caption a user
// sees and approves is exactly the caption that goes out.
export function captionForPlatform(post: Post, platform: 'facebook' | 'instagram'): string {
  const platformContent = post.platformContent?.[platform]
  return platformContent ? platformCaption(platformContent) : fullCaption(post.content!)
}

// When the user edits (or brand-check fixes) the base caption, the same edited
// fields must be applied to every platform-specific copy so the canonical
// publish rule (captionForPlatform) yields the approved text.
export function applyContentToPlatforms(post: Post, content: WrittenContent): PlatformContent | undefined {
  if (!post.platformContent) return undefined
  const patch = (): WrittenContent => ({
    hook: content.hook,
    caption: content.caption,
    cta: content.cta,
    emojis: content.emojis,
    hashtags: content.hashtags,
    seoKeywords: content.seoKeywords,
  })
  return {
    facebook: post.platformContent.facebook ? patch() : undefined,
    instagram: post.platformContent.instagram ? patch() : undefined,
  }
}

export function previewCaption(content: WrittenContent, platformLabel: string): string {
  return `[${platformLabel}]\n\n${fullCaption(content)}`
}