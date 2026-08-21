import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createPost, updatePost, getPost } from '../src/store.js'
import { getDb } from '../src/db.js'
import { schedulePost, rescheduleScheduledPost, restoreScheduledSnapshot, resetPublishJobs } from '../src/pipeline/publish.js'
import { enqueuePublish } from '../src/pipeline/publish.js'
import { publishImage } from '../src/lib/instagram.js'
import { publishToFacebook } from '../src/lib/facebook.js'
import { sendText, sendImage, sendReplyButtons } from '../src/lib/whatsapp.js'
import { saveImageBuffer } from '../src/storage.js'
import { scheduledPosts } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import type { WrittenContent } from '../src/types.js'
import { PHONE, registerTestUser } from './helpers.js'

vi.mock('../src/lib/facebook.js', () => ({
  publishToFacebook: vi.fn(),
}))

const publishImageMock = vi.mocked(publishImage)
const publishToFacebookMock = vi.mocked(publishToFacebook)
const sendTextMock = vi.mocked(sendText)
const sendImageMock = vi.mocked(sendImage)
const sendReplyButtonsMock = vi.mocked(sendReplyButtons)
const saveImageBufferMock = vi.mocked(saveImageBuffer)

const ORIGINAL: WrittenContent = {
  hook: 'Boost your mornings!',
  caption: 'SCHEDULED caption that must win at publish time.',
  cta: 'Save and share!',
  emojis: '🌅',
  hashtags: '#MorningRoutine',
  seoKeywords: ['morning'],
}

const EDITED: WrittenContent = {
  ...ORIGINAL,
  caption: 'EDITED caption that must never be published.',
}

async function makeSchedulablePost(content: WrittenContent): Promise<string> {
  const post = await createPost(PHONE)
  await updatePost(post.id, {
    transcript: 'I want a morning routine post.',
    intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' },
    content,
    imagePrompt: 'Morning scene',
    imagePath: 'images/test.png',
    imageUrl: 'http://mock/media/test.png',
    status: 'AWAITING_APPROVAL',
    platforms: ['instagram'],
  })
  return post.id
}

describe('P2-8 — scheduled posts publish the content captured at scheduling time', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    resetPublishJobs()
    clearFeatureCache(PHONE)
    await resetStore()
    await registerTestUser()
    publishImageMock.mockResolvedValue({ mediaId: '17912345678901234', permalink: 'https://www.instagram.com/p/C0OL1dRF9pN/' })
    publishToFacebookMock.mockResolvedValue({ mediaId: 'fb_post_1', permalink: 'https://facebook.com/fb_post_1' })
    saveImageBufferMock.mockResolvedValue({ localFileUrl: 'http://mock/media/test.png', filePath: 'images/test.png' })
    sendTextMock.mockResolvedValue(undefined)
    sendImageMock.mockResolvedValue(undefined)
    sendReplyButtonsMock.mockResolvedValue(undefined)
  })

  async function rowSnapshot(postId: string): Promise<unknown> {
    const rows = await getDb().select({ contentSnapshot: scheduledPosts.contentSnapshot }).from(scheduledPosts)
      .where(eq(scheduledPosts.postId, postId))
    return rows[0]?.contentSnapshot ?? null
  }

  it('schedulePost stores a snapshot of the content at scheduling time', async () => {
    const postId = await makeSchedulablePost(ORIGINAL)
    await schedulePost(postId, PHONE, new Date(Date.now() + 3_600_000).toISOString())

    const snapshot = await rowSnapshot(postId)
    expect(snapshot).toBeDefined()
    expect((snapshot as { content: WrittenContent }).content.caption).toBe(ORIGINAL.caption)
  }, 15000)

  it('an edit made after scheduling does not change the scheduled snapshot', async () => {
    const postId = await makeSchedulablePost(ORIGINAL)
    await schedulePost(postId, PHONE, new Date(Date.now() + 3_600_000).toISOString())

    await updatePost(postId, { content: EDITED })

    const snapshot = await rowSnapshot(postId)
    expect((snapshot as { content: WrittenContent }).content.caption).toBe(ORIGINAL.caption)
    expect((await getPost(postId))!.content.caption).toBe(EDITED.caption)
  }, 15000)

  it('restoreScheduledSnapshot rewinds the post to its scheduled content before publish', async () => {
    const postId = await makeSchedulablePost(ORIGINAL)
    await schedulePost(postId, PHONE, new Date(Date.now() + 3_600_000).toISOString())
    await updatePost(postId, { content: EDITED })

    await restoreScheduledSnapshot(postId, (await rowSnapshot(postId)) as never)

    expect((await getPost(postId))!.content.caption).toBe(ORIGINAL.caption)
  }, 15000)

  it('enqueuePublish publishes the scheduled caption, not the later edit', async () => {
    const postId = await makeSchedulablePost(ORIGINAL)
    await schedulePost(postId, PHONE, new Date(Date.now() + 3_600_000).toISOString())
    await updatePost(postId, { content: EDITED })

    await restoreScheduledSnapshot(postId, (await rowSnapshot(postId)) as never)
    const finalStatus = await enqueuePublish(postId)

    expect(finalStatus).toBe('DONE')
    expect(publishImageMock.mock.calls[0][1]).toContain('SCHEDULED caption that must win at publish time.')
    expect(publishImageMock.mock.calls[0][1]).not.toContain('EDITED caption that must never be published.')
  }, 15000)

  it('rescheduleScheduledPost refreshes the snapshot to the current content', async () => {
    const postId = await makeSchedulablePost(ORIGINAL)
    await schedulePost(postId, PHONE, new Date(Date.now() + 3_600_000).toISOString())
    await updatePost(postId, { content: EDITED })

    const rows = await getDb().select({ id: scheduledPosts.id }).from(scheduledPosts).where(eq(scheduledPosts.phone, PHONE))
    const row = rows[0]
    const ok = await rescheduleScheduledPost(row.id, PHONE, new Date(Date.now() + 7_200_000).toISOString())
    expect(ok).toBe(true)

    const snapshot = await rowSnapshot(postId)
    expect((snapshot as { content: WrittenContent }).content.caption).toBe(EDITED.caption)
  }, 15000)
})