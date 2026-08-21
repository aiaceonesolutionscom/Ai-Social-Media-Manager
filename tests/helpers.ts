import { getPost, createUser, createPackage, getPackage, connectAccount } from '../src/store.js'
import type { Post } from '../src/types.js'

export const PHONE = '919999999999'

// Register the test user so checkUserAccess (which rejects unregistered senders) allows the webhook flow.
// resetStore() clears packages too, so (re)create the referenced package with all publish features.
export async function registerTestUser(opts: { tokens?: number; packageId?: string } = {}): Promise<void> {
  const packageId = opts.packageId || 'pro'
  const existing = await getPackage(packageId)
  if (!existing) {
    await createPackage({
      name: 'Pro',
      slug: packageId,
      description: 'Test package',
      priceCents: 100,
      includedTokens: 1000,
      features: {
        facebook_publishing: true,
        instagram_publishing: true,
        whatsapp_broadcast: true,
        web_chat: true,
        voice_transcription: true,
        scheduled_publishing: true,
        analytics_dashboard: true,
        priority_support: true,
        ad_campaigns: true,
        image_generation: true,
      },
    })
  }
  await createUser({
    phone: PHONE,
    name: 'Test User',
    email: 'test@example.com',
    tokensRemaining: opts.tokens ?? 100,
    packageId,
  })
  await connectAccount({ phone: PHONE, platform: 'instagram', accountId: '17841400000000000', accountName: 'Test IG', accessToken: 'mock-ig-token' })
  await connectAccount({ phone: PHONE, platform: 'facebook', accountId: 'dev_fb_page', accountName: 'Test FB', accessToken: 'dev_fb_token' })
}

export const IMAGE_BUFFER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function makeAudioPayload(msgId = 'wamid.Audio'): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '123456789',
      changes: [{
        value: {
          messages: [{
            from: PHONE,
            id: msgId,
            type: 'audio',
            audio: { id: 'audio-media-id-123', mime_type: 'audio/ogg; codecs=opus', voice: true },
          }],
        },
        field: 'messages',
      }],
    }],
  }
}

export function makeButtonPayload(buttonId: string, msgId = `wamid.${buttonId}`): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '123456789',
      changes: [{
        value: {
          messages: [{
            from: PHONE,
            id: msgId,
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: buttonId } },
          }],
        },
        field: 'messages',
      }],
    }],
  }
}

export function makeTextPayload(text: string, msgId = `wamid.Text.${Math.random().toString(36).slice(2)}`): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '123456789',
      changes: [{
        value: {
          messages: [{
            from: PHONE,
            id: msgId,
            type: 'text',
            text: { body: text },
          }],
        },
        field: 'messages',
      }],
    }],
  }
}

export async function waitForStatus(postId: string, target: string | string[], timeoutMs = 8000): Promise<Post> {
  const targets = Array.isArray(target) ? target : [target]
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const post = await getPost(postId)
    if (post && targets.includes(post.status)) return post
    if (post && post.status === 'FAILED') throw new Error(`Post FAILED: ${post.error}`)
    await new Promise((r) => setTimeout(r, 20))
  }
  const post = await getPost(postId)
  throw new Error(`Timed out waiting for status ${targets.join('|')}. Last: ${post?.status}`)
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
