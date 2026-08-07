import { getPost } from '../src/store.js'
import type { Post } from '../src/types.js'

export const PHONE = '919999999999'

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
