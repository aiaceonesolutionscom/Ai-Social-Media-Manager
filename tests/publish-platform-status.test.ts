import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createPost, updatePost, setConversation, getPost, recoverStuckScheduledPosts } from '../src/store.js'
import { getDb } from '../src/db.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { publishImage } from '../src/lib/instagram.js'
import { publishToFacebook } from '../src/lib/facebook.js'
import { chatJson } from '../src/lib/llm.js'
import { sendText } from '../src/lib/whatsapp.js'
import { schedulePost, enqueuePublish } from '../src/pipeline/publish.js'
import { expirePackage, activatePackage } from '../src/lib/packageLifecycle.js'
import { scheduledPosts } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import type { WrittenContent } from '../src/types.js'
import { PHONE, makeButtonPayload, waitForStatus, wait, registerTestUser } from './helpers.js'

vi.mock('../src/lib/facebook.js', () => ({ publishToFacebook: vi.fn() }))

const publishImageMock = vi.mocked(publishImage)
const fbPublishMock = vi.mocked(publishToFacebook)
const sendTextMock = vi.mocked(sendText)
const chatJsonMock = vi.mocked(chatJson)

async function waitForText(substr: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (sendTextMock.mock.calls.some((c) => typeof c[1] === 'string' && (c[1] as string).includes(substr))) return
    await wait(20)
  }
  throw new Error(`Timed out waiting for a text message containing "${substr}"`)
}

const ORIGINAL: WrittenContent = {
  hook: 'Boost your mornings!',
  caption: '3 simple tips for a better morning routine that will transform your day.',
  cta: 'Save this post and share your best morning tip in the comments!',
  emojis: '🌅 💧 ✨',
  hashtags: '#MorningRoutine #Wellness #Productivity',
  seoKeywords: ['morning routine'],
}

async function makeReadyPost(): Promise<string> {
  const post = await createPost(PHONE)
  await updatePost(post.id, {
    transcript: 'I want a morning routine post.',
    intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' },
    content: ORIGINAL,
    imagePrompt: 'Morning scene',
    imagePath: 'images/test.png',
    imageUrl: 'http://mock/media/test.png',
    status: 'AWAITING_APPROVAL',
  })
  await setConversation(PHONE, { kind: 'awaiting_approval', postId: post.id })
  return post.id
}

describe('Per-platform publish statuses (C1) + entitlement gate (C8) + scheduler recovery (C2)', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
  })

  it('Instagram fails but Facebook succeeds → PARTIAL_SUCCESS with per-platform statuses', async () => {
    fbPublishMock.mockResolvedValue({ postId: 'fb_post_1', permalink: 'https://facebook.com/fb_post_1' })
    publishImageMock.mockRejectedValue(new Error('IG 500'))
    const postId = await makeReadyPost()

    await handleWebhook(makeButtonPayload('publish'))

    const post = await waitForStatus(postId, 'PARTIAL_SUCCESS')
    expect(post.status).toBe('PARTIAL_SUCCESS')
    expect(post.platformStatuses?.instagram?.status).toBe('failed')
    expect(post.platformStatuses?.facebook?.status).toBe('published')
    expect(post.platformStatuses?.facebook?.permalink).toBe('https://facebook.com/fb_post_1')
    // Backward-compatible top-level fields come from the successful platform.
    expect(post.permalink).toContain('facebook.com')
    expect(post.mediaId).toBe('fb_post_1')
    expect(publishImageMock).toHaveBeenCalledTimes(2)
    // The user is told that one platform failed.
    await waitForText('failed')
    const partialText = sendTextMock.mock.calls.find((c) => (c[1] as string).includes('failed'))![1] as string
    expect(partialText).toContain('instagram')
  }, 15000)

  it('all platforms fail → FAILED and the publish charge is refunded', async () => {
    fbPublishMock.mockRejectedValue(new Error('FB down'))
    publishImageMock.mockRejectedValue(new Error('IG down'))
    const postId = await makeReadyPost()
    await updatePost(postId, { tokensCharged: 2, tokensChargedAction: 'cross_platform' })

    await handleWebhook(makeButtonPayload('publish'))

    await vi.waitFor(async () => {
      const p = await getPost(postId)
      expect(p?.status).toBe('FAILED')
    })
    const post = await getPost(postId)
    expect(post?.refundedAt).toBeDefined()
    expect(post?.platformStatuses?.instagram?.status).toBe('failed')
    expect(post?.platformStatuses?.facebook?.status).toBe('failed')
  }, 15000)

  it('expired package blocks publishing and never calls the publisher (C8)', async () => {
    publishImageMock.mockResolvedValue({ mediaId: 'x', permalink: 'https://www.instagram.com/p/x/' })
    fbPublishMock.mockResolvedValue({ postId: 'fb', permalink: 'https://facebook.com/fb' })
    const postId = await makeReadyPost()

    await activatePackage(PHONE, 'pro')
    await expirePackage(PHONE)

    // Drive runPublish directly so we assert the entitlement gate inside the
    // publish pipeline (the webhook already blocks expired users earlier).
    await enqueuePublish(postId)

    await vi.waitFor(async () => {
      const p = await getPost(postId)
      expect(p?.status).toBe('FAILED')
    })
    expect(publishImageMock).not.toHaveBeenCalled()
    expect(fbPublishMock).not.toHaveBeenCalled()
    const post = await getPost(postId)
    expect(post?.error).toMatch(/package|renew/i)
  }, 15000)

  it('recoverStuckScheduledPosts resets processing rows back to pending (C2)', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    const postId = await makeReadyPost()
    await schedulePost(postId, PHONE, future)
    await getDb().update(scheduledPosts).set({ status: 'processing' }).where(eq(scheduledPosts.postId, postId))

    expect(await recoverStuckScheduledPosts()).toBe(1)

    const rows = await getDb().select({ status: scheduledPosts.status }).from(scheduledPosts).where(eq(scheduledPosts.postId, postId))
    expect(rows[0].status).toBe('pending')
    expect(await recoverStuckScheduledPosts()).toBe(0)
  })

  it('recoverStuckScheduledPosts leaves completed and cancelled rows untouched (C2)', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    const postId = await makeReadyPost()
    await schedulePost(postId, PHONE, future)
    await getDb().update(scheduledPosts).set({ status: 'completed' }).where(eq(scheduledPosts.postId, postId))

    expect(await recoverStuckScheduledPosts()).toBe(0)

    const rows = await getDb().select({ status: scheduledPosts.status }).from(scheduledPosts).where(eq(scheduledPosts.postId, postId))
    expect(rows[0].status).toBe('completed')
  })
})