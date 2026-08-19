import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, listPosts, getConversation, getPost, getEdits, getMessages, updateUser, getUser } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { publishImage } from '../src/lib/instagram.js'
import { chatJson } from '../src/lib/llm.js'
import { generateFullDraft, brandCheck, generateImagePrompt, planEdit } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import { sendImage, sendText, sendReplyButtons } from '../src/lib/whatsapp.js'
import { transcribeAudio } from '../src/lib/stt.js'
import type { AgentDecision, WrittenContent } from '../src/types.js'
import { PHONE, IMAGE_BUFFER, makeTextPayload, makeButtonPayload, makeAudioPayload, waitForStatus, registerTestUser } from './helpers.js'

const chatJsonMock = vi.mocked(chatJson)
const generateFullDraftMock = vi.mocked(generateFullDraft)
const brandCheckMock = vi.mocked(brandCheck)
const generateImagePromptMock = vi.mocked(generateImagePrompt)
const planEditMock = vi.mocked(planEdit)
const generateImageMock = vi.mocked(generateImage)
const publishImageMock = vi.mocked(publishImage)
const sendTextMock = vi.mocked(sendText)
const sendImageMock = vi.mocked(sendImage)
const sendReplyButtonsMock = vi.mocked(sendReplyButtons)
const transcribeAudioMock = vi.mocked(transcribeAudio)

const ORIGINAL: WrittenContent = {
  hook: 'Boost your mornings!',
  caption: '3 simple tips for a better morning routine that will transform your day.',
  cta: 'Save this post and share your best morning tip in the comments!',
  emojis: '🌅 💧 ✨',
  hashtags: '#MorningRoutine #Wellness #Productivity #DailyHabits',
  seoKeywords: ['morning routine', 'productivity tips'],
}

const SHORTER: WrittenContent = {
  hook: 'Better mornings!',
  caption: 'Start with hydration and one clear intention.',
  cta: 'Save this for later!',
  emojis: '✨',
  hashtags: '#MorningRoutine #Wellness',
  seoKeywords: ['morning routine'],
}

const URDU: WrittenContent = {
  hook: 'صبح بہتر بنائیں!',
  caption: 'صبح کی شروعات پانی سے کریں اور ایک واضح مقصد رکھیں۔',
  cta: 'اسے محفوظ کریں!',
  emojis: '✨ 💧',
  hashtags: '#صبح #روٹین',
  seoKeywords: ['morning routine urdu'],
}

const IMAGE_PROMPT = 'A vibrant morning scene with coffee and sunlight'

function draft(intentPartial: Record<string, unknown> = {}) {
  return {
    id: 'post-x',
    phone: PHONE,
    status: 'WRITTEN',
    transcript: 'Today I want to share how to improve your morning routine with 3 simple tips.',
    intent: {
      topic: 'morning routine',
      audience: 'health-conscious',
      tone: 'friendly',
      goal: 'educate',
      language: 'English',
      emotion: 'positive',
      ...intentPartial,
    },
    plan: { positioning: 'Boost mornings', angle: 'Simple science-backed tips', suggestedTime: '7am' },
    content: ORIGINAL,
    imagePrompt: IMAGE_PROMPT,
  }
}

function useClassifier(decider: (latest: string) => AgentDecision): void {
  chatJsonMock.mockImplementation(async (messages: unknown[]) => {
    const latest = String((messages[1] as { content: string }).content)
    return decider(latest)
  })
}

describe('Scenario 1 — natural WhatsApp conversation to published Instagram post', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
    generateFullDraftMock.mockResolvedValue(draft() as never)
    brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
    generateImagePromptMock.mockResolvedValue(IMAGE_PROMPT)
    generateImageMock.mockResolvedValue(IMAGE_BUFFER)
    publishImageMock.mockResolvedValue({ mediaId: '17912345678901234', permalink: 'https://www.instagram.com/p/C0OL1dRF9pN/' })
  })

  it('greets, gathers intent one question at a time, previews with image, edits, approves and publishes', async () => {
    useClassifier((latest) => {
      if (latest === 'Hi') return { action: 'smalltalk', reply: 'Hi! 👋 How are you? What would you like to create today?' }
      if (latest.includes('dental clinic'))
        return { action: 'ask_question', question: 'What is the post about?', intent: { topic: 'dental clinic' } }
      if (latest.includes('teeth whitening'))
        return {
          action: 'generate_post',
          intent: { topic: 'teeth whitening', audience: 'dental patients', tone: 'professional', goal: 'promote offer', language: 'English', emotion: 'exciting' },
        }
      if (latest.includes('shorter'))
        return { action: 'edit_request', editRequest: 'make the caption shorter' }
      if (latest === 'Approve') return { action: 'approve' }
      return { action: 'smalltalk', reply: 'Got it!' }
    })

    await handleWebhook(makeTextPayload('Hi', 'wamid.g1'))
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('What would you like to create today?'))

    await handleWebhook(makeTextPayload('I need an Instagram post for my dental clinic.', 'wamid.g2'))
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('gathering')
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('What is the post about?'))

    await handleWebhook(makeTextPayload('It is about our new teeth whitening offer.', 'wamid.g3'))
    const posts = await listPosts()
    const postId = posts[posts.length - 1].id
    const draftPost = await waitForStatus(postId, 'AWAITING_APPROVAL')

    expect(generateFullDraftMock).toHaveBeenCalled()
    expect(brandCheckMock).toHaveBeenCalled()
    expect(generateImageMock).toHaveBeenCalledWith(IMAGE_PROMPT, PHONE, undefined)
    expect(draftPost.imageUrl).toBe('http://mock/media/test.png')
    expect(draftPost.intent?.language).toBe('English')

    expect(sendImageMock).toHaveBeenCalledWith(PHONE, 'http://mock/media/test.png', expect.stringContaining('Boost your mornings!'))
    const buttons = sendReplyButtonsMock.mock.calls.map((c) => (c[2] as { id: string }[]).map((b) => b.id))
    expect(buttons).toContainEqual(['publish', 'edit', 'regenerate'])

    planEditMock.mockResolvedValue({ scope: 'caption', content: SHORTER })
    await handleWebhook(makeTextPayload('make the caption shorter', 'wamid.g4'))
    const edited = await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect(edited.content!.caption).toBe('Start with hydration and one clear intention.')
    const edits = await getEdits(postId)
    expect(edits).toHaveLength(1)
    expect(generateImageMock).toHaveBeenCalledTimes(1)

    await handleWebhook(makeTextPayload('Approve', 'wamid.g5'))
    const done = await waitForStatus(postId, 'DONE')
    expect(done.status).toBe('DONE')
    expect(done.mediaId).toBeDefined()
    expect(done.permalink).toContain('instagram.com')
    expect(done.publishedAt).toBeDefined()
    const confirm = sendTextMock.mock.calls.find((c) => (c[1] as string).includes('Published'))
    expect(confirm).toBeDefined()
  }, 20000)

})

describe('Scenario 4 — multiple edits keep conversation context', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
    generateFullDraftMock.mockResolvedValue(draft() as never)
    brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
    generateImagePromptMock.mockResolvedValue(IMAGE_PROMPT)
    generateImageMock.mockResolvedValue(IMAGE_BUFFER)
  })

  it('handles caption-only, image-only, and language edits without losing context', async () => {
    useClassifier((latest) => {
      if (latest === 'Create a post about coffee')
        return { action: 'generate_post', intent: { topic: 'coffee', audience: 'coffee lovers', tone: 'cozy', goal: 'educate', language: 'English', emotion: 'warm' } }
      if (latest.includes('shorter')) return { action: 'edit_request', editRequest: 'make it shorter' }
      if (latest.includes('colors')) return { action: 'edit_request', editRequest: 'change the colors to luxury gold' }
      if (latest.includes('Urdu')) return { action: 'edit_request', editRequest: 'use Urdu' }
      return { action: 'smalltalk', reply: 'ok' }
    })

    planEditMock.mockImplementation(async (_ctx: unknown, editReq: string) => {
      if (editReq.includes('colors'))
        return { scope: 'image', imagePrompt: 'Luxury gold coffee scene, dark elegant' }
      if (editReq.includes('Urdu')) return { scope: 'caption', content: URDU }
      return { scope: 'caption', content: SHORTER }
    })

    await handleWebhook(makeTextPayload('Create a post about coffee', 'wamid.m1'))
    const posts = await listPosts()
    const postId = posts[posts.length - 1].id
    await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect(generateImageMock).toHaveBeenCalledTimes(1)

    await handleWebhook(makeTextPayload('make it shorter', 'wamid.m2'))
    let p = await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect(p.content!.caption).toBe('Start with hydration and one clear intention.')
    expect(generateImageMock).toHaveBeenCalledTimes(1)
    const conv1 = await getConversation(PHONE)
    expect(conv1.kind).toBe('awaiting_approval')

    await handleWebhook(makeTextPayload('change the colors to luxury gold', 'wamid.m3'))
    p = await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect(generateImageMock).toHaveBeenCalledTimes(2)
    expect(p.content!.caption).toBe('Start with hydration and one clear intention.')

    await handleWebhook(makeTextPayload('use Urdu', 'wamid.m4'))
    p = await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect(p.content!.caption).toBe('صبح کی شروعات پانی سے کریں اور ایک واضح مقصد رکھیں۔')
    expect(generateImageMock).toHaveBeenCalledTimes(2)

    const edits = await getEdits(postId)
    expect(edits).toHaveLength(3)
    const conv2 = await getConversation(PHONE)
    expect(conv2.kind).toBe('awaiting_approval')
    const currentPost = await getPost(postId)
    expect(currentPost!.id).toBe(postId)
  }, 20000)

  it('regenerate creates a brand new version and returns to preview', async () => {
    useClassifier((latest) => {
      if (latest === 'Create a post about coffee')
        return { action: 'generate_post', intent: { topic: 'coffee', audience: 'all', tone: 'fun', goal: 'engage', language: 'English', emotion: 'playful' } }
      if (latest.includes('regenerate')) return { action: 'regenerate' }
      return { action: 'smalltalk', reply: 'ok' }
    })
    generateFullDraftMock.mockResolvedValueOnce(draft() as never)

    await handleWebhook(makeTextPayload('Create a post about coffee', 'wamid.r1'))
    const posts = await listPosts()
    const postId = posts[posts.length - 1].id
    await waitForStatus(postId, 'AWAITING_APPROVAL')

    await handleWebhook(makeTextPayload('regenerate', 'wamid.r2'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect(generateFullDraftMock).toHaveBeenCalledTimes(2)
  }, 20000)
})

describe('Token charging — charged at generation, not at publish', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
    generateFullDraftMock.mockResolvedValue(draft() as never)
    brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
    generateImagePromptMock.mockResolvedValue(IMAGE_PROMPT)
    generateImageMock.mockResolvedValue(IMAGE_BUFFER)
    publishImageMock.mockResolvedValue({ mediaId: 'x', permalink: 'y' })
  })

  it('charges tokens when a post is generated and NOT on plain chat', async () => {
    await updateUser(PHONE, { tokensRemaining: 10 })
    useClassifier((latest) => {
      if (latest === 'Hi') return { action: 'smalltalk', reply: 'Hi!' }
      if (latest.includes('teeth whitening'))
        return { action: 'generate_post', intent: { topic: 'teeth whitening', audience: 'all', tone: 'friendly', goal: 'promote', language: 'English', emotion: 'positive' } }
      return { action: 'smalltalk', reply: 'ok' }
    })

    // Plain chat must not consume tokens
    await handleWebhook(makeTextPayload('Hi', 'w1'))
    expect((await getUser(PHONE))!.tokensUsed).toBe(0)

    // Generating a post must consume exactly one token action's cost.
    // The test user is on the pro package with both IG+FB connected -> cross_platform (cost 2).
    await handleWebhook(makeTextPayload('Create a post about our teeth whitening offer', 'w2'))
    const postId = (await listPosts())[0].id
    await waitForStatus(postId, 'AWAITING_APPROVAL')

    const u = await getUser(PHONE)
    expect(u!.tokensUsed).toBe(2)
    expect(u!.tokensRemaining).toBe(8)
  })

  it('blocks generation with insufficient tokens and charges nothing', async () => {
    // 1 token left: the message-access guard (<=0) passes, but a cross_platform
    // generation (cost 2) must be blocked by the generation-time charge check.
    await updateUser(PHONE, { tokensRemaining: 1 })
    useClassifier((latest) => {
      if (latest.includes('teeth whitening'))
        return { action: 'generate_post', intent: { topic: 'teeth whitening' } }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('Create a post about our teeth whitening offer', 'w1'))
    const u = await getUser(PHONE)
    expect(u!.tokensUsed).toBe(0)
    expect(u!.tokensRemaining).toBe(1)
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('need 2 tokens'))
  })
})

