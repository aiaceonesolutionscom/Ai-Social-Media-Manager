import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, setConversation, getPost, getConversation, createPost, updatePost } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { publishImage } from '../src/lib/instagram.js'
import { sendText, sendReplyButtons } from '../src/lib/whatsapp.js'
import { waitForStatus, registerTestUser, PHONE, makeButtonPayload, makeTextPayload, IMAGE_BUFFER, wait } from './helpers.js'
import type { WrittenContent } from '../src/types.js'

const publishImageMock = vi.mocked(publishImage)
const sendTextMock = vi.mocked(sendText)
const sendReplyButtonsMock = vi.mocked(sendReplyButtons)

const DRAFT: WrittenContent = {
  hook: 'Join our team!',
  caption: 'We are hiring an AI intern. Build real products, learn from experts.',
  cta: 'Apply now',
  emojis: '🚀',
  hashtags: '#Hiring #AI',
  seoKeywords: ['AI internship'],
}

// Polls sendTextMock for a call whose 2nd arg contains `needle`.
async function waitForSendText(needle: string, ms = 8000): Promise<string> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const call = (sendTextMock.mock.calls as unknown[]).find((c) => Array.isArray(c) && (c[1] as string)?.includes(needle))
    if (call) return call[1] as string
    await wait(20)
  }
  throw new Error(`sendText(..., "${needle}") was never called`)
}

async function makeReadyPost(): Promise<string> {
  const post = await createPost(PHONE)
  await updatePost(post.id, {
    transcript: 'hiring ai intern',
    intent: { topic: 'AI internship', audience: 'developers', tone: 'professional', goal: 'hire', language: 'English', emotion: 'exciting' },
    content: DRAFT,
    imagePrompt: 'AI intern promo',
    imagePath: 'images/test.png',
    imageUrl: 'http://mock/media/test.png',
    status: 'AWAITING_APPROVAL',
  })
  await setConversation(PHONE, { kind: 'awaiting_approval', postId: post.id })
  return post.id
}

describe('P3 — boost with Meta Ads after publish', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.resetAllMocks()
    publishImageMock.mockResolvedValue({ mediaId: 'ig_123', permalink: 'https://instagram.com/p/ig_123' })
    sendTextMock.mockResolvedValue({ messages: [{ id: 'msg' }] })
    sendReplyButtonsMock.mockResolvedValue({ messages: [{ id: 'btn' }] })
    await resetStore()
    await registerTestUser()
  })

  it('offers a "Boost with Meta Ads" button once the post is live', async () => {
    const postId = await makeReadyPost()

    await handleWebhook(makeButtonPayload('publish'))
    const done = await waitForStatus(postId, 'DONE')
    expect(done.status).toBe('DONE')

    const boostCall = sendReplyButtonsMock.mock.calls.find((c) => (c[2] as { id: string }[]).some((b) => b.id === 'boost_ad'))
    expect(boostCall).toBeTruthy()
  })

  it('tapping the boost button hands off to ad-gathering using the post as creative', async () => {
    const postId = await makeReadyPost()

    await handleWebhook(makeButtonPayload('publish'))
    await waitForStatus(postId, 'DONE')

    await handleWebhook(makeButtonPayload('boost_ad'))

    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('ad_gathering')
    expect((conv as any).adData?.existingPostId).toBe(postId)
    // Bot asks for budget first — no ad is launched yet.
    const budgetMsg = await waitForSendText('daily budget')
    expect(budgetMsg).toContain('Meta Ad')
    expect(sendTextMock).not.toHaveBeenCalledWith(PHONE, expect.stringContaining('ACTIVE'))
  })
})
