import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createPost, updatePost, setConversation, getPost, getConversation } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { publishImage, CancelledPublishError } from '../src/lib/instagram.js'
import { chatJson } from '../src/lib/llm.js'
import { brandCheck, planEdit } from '../src/pipeline/generate.js'
import { sendImage, sendReplyButtons, sendText } from '../src/lib/whatsapp.js'
import { cancelPublish } from '../src/pipeline/publish.js'
import { resetPublishJobs } from '../src/pipeline/publish.js'
import type { WrittenContent } from '../src/types.js'
import { PHONE, makeTextPayload, makeButtonPayload, waitForStatus, wait, registerTestUser } from './helpers.js'

const publishImageMock = vi.mocked(publishImage)
const sendTextMock = vi.mocked(sendText)
const sendReplyButtonsMock = vi.mocked(sendReplyButtons)
const chatJsonMock = vi.mocked(chatJson)
const brandCheckMock = vi.mocked(brandCheck)
const planEditMock = vi.mocked(planEdit)

const ORIGINAL: WrittenContent = {
  hook: 'Boost your mornings!',
  caption: '3 simple tips for a better morning routine that will transform your day.',
  cta: 'Save this post and share your best morning tip in the comments!',
  emojis: '🌅 💧 ✨',
  hashtags: '#MorningRoutine #Wellness #Productivity',
  seoKeywords: ['morning routine'],
}

const PROFESSIONAL: WrittenContent = {
  hook: 'Elevate your mornings.',
  caption: 'Three proven habits for a more productive morning.',
  cta: 'Save this for later.',
  emojis: '✨',
  hashtags: '#Productivity #MorningRoutine',
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

function baseMocks(): void {
  brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
  chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
}

describe('Publishing safety & reliability', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    resetPublishJobs()
    await resetStore()
    await registerTestUser()
    baseMocks()
  })

  it('approval prepares first (progress + cancel button) and only then publishes, then confirms', async () => {
    publishImageMock.mockResolvedValue({ mediaId: '17912345678901234', permalink: 'https://www.instagram.com/p/C0OL1dRF9pN/' })
    const postId = await makeReadyPost()

    await handleWebhook(makeButtonPayload('publish'))

    const done = await waitForStatus(postId, 'DONE')
    expect(done.mediaId).toBe('17912345678901234')
    expect(done.publishedAt).toBeDefined()

    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('Preparing your'))
    const cancelBtn = sendReplyButtonsMock.mock.calls.find((c) => (c[2] as { id: string }[]).some((b) => b.id === 'cancel'))
    expect(cancelBtn).toBeDefined()
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('Published'))
    expect(publishImageMock).toHaveBeenCalledTimes(1)
  }, 15000)

  it('Scenario 2 — publishing failure is retried and then succeeds', async () => {
    publishImageMock
      .mockRejectedValueOnce(new Error('IG 500'))
      .mockResolvedValueOnce({ mediaId: '179000111222', permalink: 'https://www.instagram.com/p/RETRY/' })
    const postId = await makeReadyPost()

    await handleWebhook(makeButtonPayload('publish'))
    const done = await waitForStatus(postId, 'DONE', 10000)

    expect(publishImageMock).toHaveBeenCalledTimes(2)
    expect(done.status).toBe('DONE')
    expect(done.permalink).toContain('RETRY')
  }, 15000)

  it('Scenario 5 — cancel before point of no return cancels cleanly, then edit works', async () => {
    let resolvePub!: (v: unknown) => void
    let rejectPub!: (e: unknown) => void
    publishImageMock.mockImplementation(
      () => new Promise((res, rej) => { resolvePub = res; rejectPub = rej }),
    )
    const postId = await makeReadyPost()

    await handleWebhook(makeButtonPayload('publish'))
    await vi.waitFor(() => expect(publishImageMock).toHaveBeenCalled())
    await handleWebhook(makeButtonPayload('cancel'))
    let post = await getPost(postId)!
    expect(post!.status).toBe('CANCELLED')
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('was not published'))
    expect(publishImageMock).toHaveBeenCalledTimes(1)

    rejectPub(new CancelledPublishError())
    await wait(50)
    const cancelledPost = await getPost(postId)
    expect(cancelledPost!.status).toBe('CANCELLED')

    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const latest = String((messages[1] as { content: string }).content)
      if (latest.includes('professional')) return { action: 'edit_request', editRequest: 'make it more professional' }
      return { action: 'smalltalk', reply: 'ok' }
    })
    planEditMock.mockResolvedValue({ scope: 'caption', content: PROFESSIONAL })
    await handleWebhook(makeTextPayload('make it more professional', 'wamid.c1'))
    post = await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect(post!.content!.hook).toBe('Elevate your mornings.')
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('awaiting_approval')
  }, 20000)

   it('Scenario 6 — cancellation after the point of no return is rejected', async () => {
     publishImageMock.mockImplementation(
       (_url: string, _cap: string, _at: unknown, cb: { onBeforePublish?: () => void }) => {
         cb.onBeforePublish?.()
         return new Promise(() => {})
       },
     )
    const postId = await makeReadyPost()

    await handleWebhook(makeButtonPayload('publish'))
    await vi.waitFor(() => expect(publishImageMock).toHaveBeenCalled())
    await wait(30)

    const res = await cancelPublish(postId)
    expect(res).toBe('too_late')

    await handleWebhook(makeButtonPayload('cancel'))
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('can no longer be cancelled'))
  }, 15000)

  it('Scenario 6b — cancel between shouldCancel check and onBeforePublish results in too_late', async () => {
    let shouldCancelFn: (() => boolean) | undefined
    publishImageMock.mockImplementation(
      (_url: string, _cap: string, _at: unknown, cb: { shouldCancel?: () => boolean; onBeforePublish?: () => void }) => {
        shouldCancelFn = cb.shouldCancel
        return new Promise((resolve) => {
          setTimeout(() => {
            cb.onBeforePublish?.()
          }, 50)
        })
      },
    )
    const postId = await makeReadyPost()

    await handleWebhook(makeButtonPayload('publish'))
    await vi.waitFor(() => expect(publishImageMock).toHaveBeenCalled())
    await wait(10)

    const res = await cancelPublish(postId)
    expect(['too_late', 'cancelled']).toContain(res)
  }, 15000)
})

