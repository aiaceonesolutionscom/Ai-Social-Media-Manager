import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createPost, updatePost, setConversation, getPost, getConversation } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { enqueuePublish } from '../src/pipeline/publish.js'
import { chatJson } from '../src/lib/llm.js'
import { generateFullDraft, brandCheck, generateImagePrompt } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import { sendText, sendImage, localFileUrl, sendReplyButtons } from '../src/lib/whatsapp.js'
import { saveImageBuffer } from '../src/storage.js'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import type { AgentDecision, WrittenContent } from '../src/types.js'
import { PHONE, IMAGE_BUFFER, makeTextPayload, waitForStatus, registerTestUser } from './helpers.js'

const chatJsonMock = vi.mocked(chatJson)
const generateFullDraftMock = vi.mocked(generateFullDraft)
const brandCheckMock = vi.mocked(brandCheck)
const generateImagePromptMock = vi.mocked(generateImagePrompt)
const generateImageMock = vi.mocked(generateImage)
const sendTextMock = vi.mocked(sendText)
const sendImageMock = vi.mocked(sendImage)

const ORIGINAL: WrittenContent = {
  hook: 'Boost your mornings!',
  caption: '3 simple tips for a better morning routine.',
  cta: 'Save this post!',
  emojis: '🌅 ✨',
  hashtags: '#MorningRoutine',
  seoKeywords: ['morning routine'],
}

function useClassifier(decider: (latest: string) => AgentDecision): void {
  chatJsonMock.mockImplementation(async (messages: unknown[]) => {
    const latest = String((messages[1] as { content: string }).content)
    return decider(latest)
  })
}

describe('P1 — image failure gate (#14)', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.resetAllMocks()
    await resetStore()
    await registerTestUser()
    clearFeatureCache()
    vi.mocked(saveImageBuffer).mockReturnValue('images/test.png')
    vi.mocked(localFileUrl).mockReturnValue('http://mock/media/test.png')
    vi.mocked(sendText).mockResolvedValue({ messages: [{ id: 'msg' }] })
    vi.mocked(sendImage).mockResolvedValue({ messages: [{ id: 'img' }] })
    vi.mocked(sendReplyButtons).mockResolvedValue({ messages: [{ id: 'btn' }] })
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
    brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
    generateImagePromptMock.mockResolvedValue('Morning scene')
    generateFullDraftMock.mockResolvedValue({
      id: 'post-x',
      phone: PHONE,
      status: 'WRITTEN',
      transcript: 'A post about morning routines.',
      intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' },
      plan: { positioning: 'P', angle: 'A', suggestedTime: '7am' },
      content: ORIGINAL,
      imagePrompt: 'Morning scene',
    } as never)
  })

  it('image failure holds the draft in IMAGE_FAILED instead of reaching approval', async () => {
    generateImageMock.mockRejectedValue(new Error('OpenAI quota exceeded'))
    useClassifier((latest) => {
      if (latest.includes('morning')) return { action: 'generate_post', intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' } }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('Create a morning routine post', 'wamid.g1'))
    const { listPosts } = await import('../src/store.js')
    const posts = await listPosts()
    const postId = posts[posts.length - 1].id

    const held = await waitForStatus(postId, 'IMAGE_FAILED')
    expect(held.imageUrl).toBe('')
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('image_retry')
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('retry'))
    expect(held.status).not.toBe('AWAITING_APPROVAL')
  }, 15000)

  it('retry with a successful image reaches approval with the image', async () => {
    generateImageMock.mockRejectedValue(new Error('OpenAI quota exceeded'))
    useClassifier((latest) => {
      if (latest.includes('morning')) return { action: 'generate_post', intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' } }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('Create a morning routine post', 'wamid.g2'))
    const { listPosts } = await import('../src/store.js')
    const posts = await listPosts()
    const postId = posts[posts.length - 1].id
    await waitForStatus(postId, 'IMAGE_FAILED')

    generateImageMock.mockResolvedValue(IMAGE_BUFFER)
    await handleWebhook(makeTextPayload('retry', 'wamid.g3'))

    const ready = await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect(ready.imageUrl).toBeDefined()
    expect(ready.imageUrl).not.toBe('')
    expect(sendImageMock).toHaveBeenCalled()
  }, 15000)

  it('retry that keeps failing stays in IMAGE_FAILED and the user is offered another retry', async () => {
    generateImageMock.mockRejectedValue(new Error('OpenAI quota exceeded'))
    useClassifier((latest) => {
      if (latest.includes('morning')) return { action: 'generate_post', intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' } }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('Create a morning routine post', 'wamid.g4'))
    const { listPosts } = await import('../src/store.js')
    const posts = await listPosts()
    const postId = posts[posts.length - 1].id
    await waitForStatus(postId, 'IMAGE_FAILED')

    await handleWebhook(makeTextPayload('retry', 'wamid.g5'))

    const stillHeld = await waitForStatus(postId, 'IMAGE_FAILED')
    expect(stillHeld.imageUrl).toBe('')
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('image_retry')
  }, 15000)

  it('cancel during image retry cancels the post cleanly', async () => {
    generateImageMock.mockRejectedValue(new Error('OpenAI quota exceeded'))
    useClassifier((latest) => {
      if (latest.includes('morning')) return { action: 'generate_post', intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' } }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('Create a morning routine post', 'wamid.g6'))
    const { listPosts } = await import('../src/store.js')
    const posts = await listPosts()
    const postId = posts[posts.length - 1].id
    await waitForStatus(postId, 'IMAGE_FAILED')

    await handleWebhook(makeTextPayload('cancel', 'wamid.g7'))

    const cancelled = await getPost(postId)
    expect(cancelled!.status).toBe('CANCELLED')
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('idle')
  }, 15000)

  it('enqueuePublish rejects a post that has no image (defense in depth)', async () => {
    const post = await createPost(PHONE)
    await updatePost(post.id, {
      transcript: 'A caption-only post that somehow reached approval.',
      content: ORIGINAL,
      status: 'AWAITING_APPROVAL',
    })
    await setConversation(PHONE, { kind: 'awaiting_approval', postId: post.id })

    await expect(enqueuePublish(post.id)).rejects.toThrow(/no image/i)
    const after = await getPost(post.id)
    expect(after!.status).toBe('AWAITING_APPROVAL')
  })
})