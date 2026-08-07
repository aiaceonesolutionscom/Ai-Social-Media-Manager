import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, listPosts } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { generateFullDraft, brandCheck } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import type { AgentDecision, WrittenContent } from '../src/types.js'
import { IMAGE_BUFFER, PHONE, makeTextPayload, waitForStatus, registerTestUser } from './helpers.js'

const chatJsonMock = vi.mocked(chatJson)
const generateFullDraftMock = vi.mocked(generateFullDraft)
const brandCheckMock = vi.mocked(brandCheck)
const generateImageMock = vi.mocked(generateImage)

const ORIGINAL: WrittenContent = {
  hook: 'Boost your mornings!',
  caption: '3 simple tips for a better morning routine that will transform your day.',
  cta: 'Save this post and share your best morning tip in the comments!',
  emojis: '🌅 💧 ✨',
  hashtags: '#MorningRoutine #Wellness #Productivity',
  seoKeywords: ['morning routine'],
}

describe('Scenario 3 — image generation failure is retried and produces a new preview', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
    brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
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

  it('first image call fails, retry succeeds, preview arrives with the image', async () => {
    chatJsonMock.mockResolvedValue({
      action: 'generate_post',
      intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' },
    } as AgentDecision)
    generateImageMock.mockRejectedValueOnce(new Error('OpenAI 500'))
    generateImageMock.mockResolvedValueOnce(IMAGE_BUFFER)

    await handleWebhook(makeTextPayload('Create a morning routine post', 'wamid.i1'))
    const posts = await listPosts()
    const postId = posts[posts.length - 1].id

    const post = await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect(generateImageMock).toHaveBeenCalledTimes(2)
    expect(post.status).toBe('AWAITING_APPROVAL')
    expect(post.imageUrl).toBeDefined()
  }, 15000)

  it('consecutive image failures end in a FAILED post with a user-facing error', async () => {
    chatJsonMock.mockResolvedValue({
      action: 'generate_post',
      intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' },
    } as AgentDecision)
    generateImageMock.mockRejectedValue(new Error('OpenAI quota exceeded'))

    await handleWebhook(makeTextPayload('Create a morning routine post', 'wamid.i2'))
    const posts = await listPosts()
    const postId = posts[posts.length - 1].id

    const post = await waitForStatus(postId, 'FAILED')
    expect(post.error).toContain('OpenAI quota exceeded')
    expect(generateImageMock).toHaveBeenCalledTimes(3)
  }, 15000)
})
