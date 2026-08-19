import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, getConversation, createPost, updatePost, setConversation } from '../src/store.js'
import { getDb } from '../src/db.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { sendText } from '../src/lib/whatsapp.js'
import { generateFullDraft, brandCheck, generateImagePrompt } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import { scheduledPosts } from '../src/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import { PHONE, IMAGE_BUFFER, makeTextPayload, registerTestUser } from './helpers.js'
import type { WrittenContent } from '../src/types.js'

const chatJsonMock = vi.mocked(chatJson)
const sendTextMock = vi.mocked(sendText)
const generateFullDraftMock = vi.mocked(generateFullDraft)
const brandCheckMock = vi.mocked(brandCheck)
const generateImagePromptMock = vi.mocked(generateImagePrompt)
const generateImageMock = vi.mocked(generateImage)

const CONTENT: WrittenContent = {
  hook: 'Get fit today!',
  caption: 'Join our gym and transform your body.',
  cta: 'DM us to join.',
  emojis: '💪',
  hashtags: '#Gym',
  seoKeywords: ['gym'],
}

function mockPipeline(): void {
  generateFullDraftMock.mockResolvedValue({
    id: 'post-x',
    phone: PHONE,
    status: 'WRITTEN',
    transcript: 'Post about the gym.',
    intent: { topic: 'Gym', audience: 'all', tone: 'motivational', goal: 'promote', language: 'English', emotion: 'exciting' },
    plan: { positioning: 'Gym', angle: 'fitness', suggestedTime: '7am' },
    content: CONTENT,
    imagePrompt: 'gym scene',
  } as never)
  brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
  generateImagePromptMock.mockResolvedValue('gym scene')
  generateImageMock.mockResolvedValue(IMAGE_BUFFER)
}

async function makeReadyPost(): Promise<string> {
  const post = await createPost(PHONE)
  await updatePost(post.id, {
    transcript: 'I want a gym post.',
    intent: { topic: 'Gym', audience: 'all', tone: 'motivational', goal: 'promote', language: 'English', emotion: 'exciting' },
    content: CONTENT,
    imagePrompt: 'Gym scene',
    imagePath: 'images/test.png',
    imageUrl: 'http://mock/media/test.png',
    status: 'AWAITING_APPROVAL',
  })
  await setConversation(PHONE, { kind: 'awaiting_approval', postId: post.id })
  return post.id
}

async function countPendingScheduled(postId: string): Promise<number> {
  const rows = await getDb().select().from(scheduledPosts).where(and(eq(scheduledPosts.postId, postId), eq(scheduledPosts.status, 'pending')))
  return rows.length
}

describe('Scheduling is idempotent (reschedule updates, never duplicates)', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    chatJsonMock.mockReset()
    clearFeatureCache(PHONE)
    await resetStore()
    await registerTestUser()
    mockPipeline()
  })

  it('scheduling the same post twice keeps a single pending row and updates its time', async () => {
    const postId = await makeReadyPost()
    const future1 = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const future2 = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const sys = String((messages[0] as { content: string }).content)
      if (sys.includes('convert natural-language time')) return { iso: future1 }
      if (sys.includes('ACTION')) return { action: 'schedule_post', scheduleAt: 'in 2 hours' }
      return { action: 'unclear', reply: 'ok' }
    })
    await handleWebhook(makeTextPayload('kal 7 baje kar dena', 'wamid.sched1'))
    expect(await countPendingScheduled(postId)).toBe(1)
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('Scheduled'))

    const first = (await getDb().select().from(scheduledPosts).where(eq(scheduledPosts.postId, postId)))[0]

    sendTextMock.mockClear()
    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const sys = String((messages[0] as { content: string }).content)
      if (sys.includes('convert natural-language time')) return { iso: future2 }
      if (sys.includes('ACTION')) return { action: 'schedule_post', scheduleAt: 'in 1 week', targetPostId: postId }
      return { action: 'unclear', reply: 'ok' }
    })
    await handleWebhook(makeTextPayload('parson 9 baje kar dena', 'wamid.sched2'))
    expect(await countPendingScheduled(postId)).toBe(1)
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('Rescheduled'))

    const rows = await getDb().select().from(scheduledPosts).where(eq(scheduledPosts.postId, postId))
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(first.id)
    expect(rows[0].publishAt).toBe(future2)
  }, 20000)

  it('status_check from idle replies with a friendly summary', async () => {
    const postId = await makeReadyPost()
    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const sys = String((messages[0] as { content: string }).content)
      if (sys.includes('convert natural-language time')) return { iso: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() }
      if (sys.includes('ACTION')) return { action: 'schedule_post', scheduleAt: 'in 2 hours' }
      return { action: 'unclear', reply: 'ok' }
    })
    await handleWebhook(makeTextPayload('kal 7 baje kar dena', 'wamid.sched1'))
    await setConversation(PHONE, { kind: 'idle', postId })

    sendTextMock.mockClear()
    chatJsonMock.mockImplementation(async () => ({ action: 'status_check' }))
    await handleWebhook(makeTextPayload('mera status batao', 'wamid.status1'))

    const summaryCalls = sendTextMock.mock.calls.filter((c) => typeof c[1] === 'string' && (c[1] as string).includes('current status'))
    expect(summaryCalls.length).toBeGreaterThan(0)
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('idle')
  }, 20000)
})