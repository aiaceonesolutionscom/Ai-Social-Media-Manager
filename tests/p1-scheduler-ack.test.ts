import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createPost, updatePost, setConversation, getPost, recoverStuckScheduledPosts } from '../src/store.js'
import { getDb } from '../src/db.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { publishImage } from '../src/lib/instagram.js'
import { publishToFacebook } from '../src/lib/facebook.js'
import { chatJson } from '../src/lib/llm.js'
import { brandCheck } from '../src/pipeline/generate.js'
import { sendText, sendImage, sendReplyButtons } from '../src/lib/whatsapp.js'
import { saveImageBuffer } from '../src/storage.js'
import { enqueuePublish, getPublishJob, resetPublishJobs } from '../src/pipeline/publish.js'
import { scheduledPosts } from '../src/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import type { WrittenContent } from '../src/types.js'
import { PHONE, makeTextPayload, registerTestUser } from './helpers.js'

vi.mock('../src/lib/facebook.js', () => ({
  publishToFacebook: vi.fn(),
}))

const publishImageMock = vi.mocked(publishImage)
const publishToFacebookMock = vi.mocked(publishToFacebook)
const sendTextMock = vi.mocked(sendText)
const sendImageMock = vi.mocked(sendImage)
const sendReplyButtonsMock = vi.mocked(sendReplyButtons)
const saveImageBufferMock = vi.mocked(saveImageBuffer)
const chatJsonMock = vi.mocked(chatJson)
const brandCheckMock = vi.mocked(brandCheck)

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
    platforms: ['instagram'],
  })
  await setConversation(PHONE, { kind: 'awaiting_approval', postId: post.id })
  return post.id
}

async function insertScheduledRow(postId: string, status: string, publishAt?: string): Promise<string> {
  const db = getDb()
  const id = `sched-${status}-${postId}`
  await db.insert(scheduledPosts).values({
    id,
    postId,
    phone: PHONE,
    publishAt: publishAt ?? new Date(Date.now() + 60_000).toISOString(),
    status,
    createdAt: new Date().toISOString(),
  })
  return id
}

function baseMocks(): void {
  brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
  chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
  saveImageBufferMock.mockResolvedValue({ localFileUrl: 'http://mock/media/test.png', filePath: 'images/test.png' })
  sendTextMock.mockResolvedValue(undefined)
  sendImageMock.mockResolvedValue(undefined)
  sendReplyButtonsMock.mockResolvedValue(undefined)
  publishToFacebookMock.mockResolvedValue({ mediaId: 'fb_post_1', permalink: 'https://facebook.com/fb_post_1' })
}

describe('P1-7 — scheduler completes only after publishing finishes, with safe recovery', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    resetPublishJobs()
    clearFeatureCache(PHONE)
    await resetStore()
    await registerTestUser()
    baseMocks()
  })

  it('enqueuePublish does not resolve until the publish attempt has finished', async () => {
    let resolvePub!: (v: unknown) => void
    publishImageMock.mockImplementation(() => new Promise((res) => { resolvePub = res }))
    const postId = await makeReadyPost()

    let resolved = false
    const pending = enqueuePublish(postId).then((status) => { resolved = true; return status })
    await vi.waitFor(() => expect(publishImageMock).toHaveBeenCalled())

    // Publishing is still in flight: the enqueue must NOT have resolved yet.
    expect(resolved).toBe(false)
    expect(getPublishJob(postId)).toBeDefined()
    expect(['PREPARING_TO_PUBLISH', 'PUBLISHING']).toContain((await getPost(postId))!.status)

    resolvePub({ mediaId: '17912345678901234', permalink: 'https://www.instagram.com/p/C0OL1dRF9pN/' })
    const finalStatus = await pending
    expect(finalStatus).toBe('DONE')
    expect((await getPost(postId))!.status).toBe('DONE')
    expect(getPublishJob(postId)).toBeUndefined()
  }, 15000)

  it('enqueuePublish resolves FAILED when the publish attempt fails', async () => {
    publishImageMock.mockRejectedValue(new Error('IG 500'))
    publishToFacebookMock.mockRejectedValue(new Error('FB 500'))
    const postId = await makeReadyPost()

    const finalStatus = await enqueuePublish(postId)
    expect(finalStatus).toBe('FAILED')
    expect((await getPost(postId))!.status).toBe('FAILED')
  }, 15000)

  it('enqueuePublish never re-publishes a post already in a terminal state', async () => {
    publishImageMock.mockResolvedValue({ mediaId: '179000111222', permalink: 'https://www.instagram.com/p/DONE/' })
    const postId = await makeReadyPost()
    expect(await enqueuePublish(postId)).toBe('DONE')

    const callsAfterDone = publishImageMock.mock.calls.length
    expect(await enqueuePublish(postId)).toBe('DONE')
    expect(publishImageMock.mock.calls.length).toBe(callsAfterDone)
    expect((await getPost(postId))!.status).toBe('DONE')
  }, 15000)

  it('recovery resets a processing row to pending when the post is not published yet', async () => {
    const postId = await makeReadyPost()
    await insertScheduledRow(postId, 'processing')

    const recovered = await recoverStuckScheduledPosts()
    expect(recovered).toBe(1)
    const rows = await getDb().select().from(scheduledPosts).where(eq(scheduledPosts.postId, postId))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
    expect((await getPost(postId))!.status).toBe('AWAITING_APPROVAL')
  })

  it('recovery marks a processing row completed (never pending) when the post already published', async () => {
    const postId = await makeReadyPost()
    await updatePost(postId, { status: 'DONE' })
    await insertScheduledRow(postId, 'processing')

    const recovered = await recoverStuckScheduledPosts()
    expect(recovered).toBe(1)
    const rows = await getDb().select().from(scheduledPosts).where(eq(scheduledPosts.postId, postId))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('completed')
  })

  it('recovery marks a processing row cancelled when the post was cancelled', async () => {
    const postId = await makeReadyPost()
    await updatePost(postId, { status: 'CANCELLED' })
    await insertScheduledRow(postId, 'processing')

    const recovered = await recoverStuckScheduledPosts()
    expect(recovered).toBe(1)
    const rows = await getDb().select().from(scheduledPosts).where(eq(scheduledPosts.postId, postId))
    expect(rows[0].status).toBe('cancelled')
  })

  it('approve with scheduleAt is acknowledged and persists a pending scheduled row', async () => {
    const postId = await makeReadyPost()
    const future = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
    chatJsonMock.mockResolvedValue({ action: 'approve', scheduleAt: future } as never)

    await handleWebhook(makeTextPayload('publish it tomorrow', 'wamid.ack1'))

    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('Scheduled'))
    const rows = await getDb().select().from(scheduledPosts).where(and(eq(scheduledPosts.postId, postId), eq(scheduledPosts.status, 'pending')))
    expect(rows).toHaveLength(1)
    expect(rows[0].publishAt).toBe(future)
    expect(publishImageMock).not.toHaveBeenCalled()
  }, 15000)
})