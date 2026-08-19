import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, listPosts, getPost, getConversation, createPackage, createUser, connectAccount, saveBrandProfile, saveUserPreferences } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { generateFullDraft, brandCheck, generateImagePrompt, planEdit } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import { sendReplyButtons } from '../src/lib/whatsapp.js'
import type { AgentDecision, WrittenContent } from '../src/types.js'
import { PHONE, IMAGE_BUFFER, makeTextPayload, makeButtonPayload, waitForStatus } from './helpers.js'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'

const chatJsonMock = vi.mocked(chatJson)
const generateFullDraftMock = vi.mocked(generateFullDraft)
const brandCheckMock = vi.mocked(brandCheck)
const generateImagePromptMock = vi.mocked(generateImagePrompt)
const planEditMock = vi.mocked(planEdit)
const generateImageMock = vi.mocked(generateImage)
const sendReplyButtonsMock = vi.mocked(sendReplyButtons)

const CONTENT: WrittenContent = {
  hook: 'Boost your mornings!',
  caption: '3 simple tips for a better morning routine that will transform your day.',
  cta: 'Save this post and share your best morning tip in the comments!',
  emojis: '🌅 💧 ✨',
  hashtags: '#MorningRoutine #Wellness #Productivity #DailyHabits',
  seoKeywords: ['morning routine', 'productivity tips'],
}

const IMAGE_PROMPT = 'A vibrant morning scene with coffee and sunlight'

function useClassifier(decider: (latest: string) => AgentDecision): void {
  chatJsonMock.mockImplementation(async (messages: unknown[]) => {
    const latest = String((messages[1] as { content: string }).content)
    return decider(latest)
  })
}

async function registerBrandedUser(): Promise<void> {
  await createPackage({
    name: 'Brand Pro',
    slug: 'brand-pro',
    description: 'Package with custom branding',
    priceCents: 100,
    includedTokens: 1000,
    features: {
      facebook_publishing: true,
      instagram_publishing: true,
      whatsapp_broadcast: true,
      web_chat: true,
      voice_transcription: true,
      scheduled_publishing: true,
      custom_branding: true,
    },
  })
  await createUser({ phone: PHONE, name: 'Branded User', email: 'branded@example.com', tokensRemaining: 1000, packageId: 'brand-pro' })
  await connectAccount({ phone: PHONE, platform: 'instagram', accountId: '17841400000000000', accountName: 'Test IG', accessToken: 'mock-ig-token' })
  await saveBrandProfile(PHONE, {
    brandName: 'Morning Co',
    tagline: 'Better mornings, better days',
    voice: 'friendly and energizing',
    toneGuidelines: 'encouraging, simple, warm',
    colors: ['#F97316', '#FFFFFF'],
  })
  await saveUserPreferences(PHONE, { language: 'English', tone: 'friendly', brandingEnabled: true })
}

async function startPost(): Promise<string> {
  useClassifier((latest) => {
    if (latest.includes('dental clinic')) return { action: 'generate_post', intent: { topic: 'dental clinic', audience: 'patients', tone: 'friendly', goal: 'promote', language: 'English', emotion: 'warm' } }
    return { action: 'smalltalk', reply: 'ok' }
  })
  await handleWebhook(makeTextPayload('I need an Instagram post for my dental clinic.', 'wamid.b1'))
  const posts = await listPosts()
  return posts[posts.length - 1].id
}

describe('Chat-driven branding toggle (custom branding ON)', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    clearFeatureCache()
    await resetStore()
    await registerBrandedUser()
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
    generateFullDraftMock.mockResolvedValue({
      intent: { topic: 'dental clinic', audience: 'patients', tone: 'friendly', goal: 'promote', language: 'English', emotion: 'warm' },
      plan: { positioning: 'Friendly care', angle: 'Simple tips', suggestedTime: '9am' },
      content: CONTENT,
      imagePrompt: IMAGE_PROMPT,
      id: 'post-x',
      phone: PHONE,
    } as never)
    brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
    generateImagePromptMock.mockResolvedValue(IMAGE_PROMPT)
    generateImageMock.mockResolvedValue(IMAGE_BUFFER)
    planEditMock.mockResolvedValue({ scope: 'caption', content: CONTENT })
  })

  it('asks for confirmation when user says "meri branding bhi dal dena", then applies branding after yes', async () => {
    const postId = await startPost()
    expect((await getConversation(PHONE)).kind).toBe('awaiting_branding')
    await handleWebhook(makeButtonPayload('branding_no'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')

    useClassifier((latest) => {
      if (latest.includes('branding bhi dal')) return { action: 'toggle_branding', brandingOn: true }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('meri branding bhi dal dena', 'wamid.b2'))
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('awaiting_branding')
    const buttons = sendReplyButtonsMock.mock.calls.map((c) => (c[2] as { id: string }[]).map((b) => b.id))
    expect(buttons).toContainEqual(['branding_yes', 'branding_no'])

    await handleWebhook(makeButtonPayload('branding_yes'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')
    const post = await getPost(postId)
    expect(post!.skipBranding).toBe(false)
    const last = generateFullDraftMock.mock.calls[generateFullDraftMock.mock.calls.length - 1]
    expect((last![2] as { brandProfile: { brandName: string } }).brandProfile.brandName).toBe('Morning Co')
  }, 20000)

  it('confirms add, but declining keeps branding off (skipBranding true)', async () => {
    const postId = await startPost()
    await handleWebhook(makeButtonPayload('branding_no'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')

    useClassifier((latest) => {
      if (latest.includes('branding bhi dal')) return { action: 'toggle_branding', brandingOn: true }
      return { action: 'smalltalk', reply: 'ok' }
    })
    await handleWebhook(makeTextPayload('meri branding bhi dal dena', 'wamid.b3'))
    expect((await getConversation(PHONE)).kind).toBe('awaiting_branding')

    await handleWebhook(makeButtonPayload('branding_no'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')
    const post = await getPost(postId)
    expect(post!.skipBranding).toBe(true)
    const last = generateFullDraftMock.mock.calls[generateFullDraftMock.mock.calls.length - 1]
    expect((last![2] as { brandProfile?: unknown }).brandProfile).toBeUndefined()
  }, 20000)

  it('removes branding when user says "branding hata do"', async () => {
    const postId = await startPost()
    await handleWebhook(makeButtonPayload('branding_yes'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')
    expect((await getPost(postId))!.skipBranding).toBe(false)

    useClassifier((latest) => {
      if (latest.includes('branding hata do')) return { action: 'toggle_branding', brandingOn: false }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('branding hata do', 'wamid.b4'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')
    const post = await getPost(postId)
    expect(post!.skipBranding).toBe(true)
    const last = generateFullDraftMock.mock.calls[generateFullDraftMock.mock.calls.length - 1]
    expect((last![2] as { brandProfile?: unknown }).brandProfile).toBeUndefined()
  }, 20000)

  it('tells user to upgrade when custom_branding feature is not in package', async () => {
    await resetStore()
    await createPackage({
      name: 'Basic',
      slug: 'basic',
      description: 'No branding',
      priceCents: 100,
      includedTokens: 1000,
      features: { instagram_publishing: true, whatsapp_broadcast: true },
    })
    await createUser({ phone: PHONE, name: 'Basic User', email: 'basic@example.com', tokensRemaining: 1000, packageId: 'basic' })
    await connectAccount({ phone: PHONE, platform: 'instagram', accountId: '17841400000000000', accountName: 'Test IG', accessToken: 'mock-ig-token' })
    await saveUserPreferences(PHONE, { brandingEnabled: true })

    const postId = await startPost()
    await waitForStatus(postId, 'AWAITING_APPROVAL')

    useClassifier((latest) => {
      if (latest.includes('branding bhi dal')) return { action: 'toggle_branding', brandingOn: true }
      return { action: 'smalltalk', reply: 'ok' }
    })
    await handleWebhook(makeTextPayload('meri branding bhi dal dena', 'wamid.b5'))
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('awaiting_approval')
    const brandingButtons = sendReplyButtonsMock.mock.calls.filter((c) =>
      (c[2] as { id: string }[]).some((b) => b.id === 'branding_yes' || b.id === 'branding_no'),
    )
    expect(brandingButtons.length).toBe(0)
    const post = await getPost(postId)
    expect(post!.status).toBe('AWAITING_APPROVAL')
  }, 20000)

  it('does not re-ask branding after user answered (no infinite loop)', async () => {
    const postId = await startPost()
    await handleWebhook(makeButtonPayload('branding_yes'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')

    const brandingCalls = () =>
      sendReplyButtonsMock.mock.calls.filter((c) =>
        (c[2] as { id: string }[]).some((b) => b.id === 'branding_yes' || b.id === 'branding_no'),
      ).length

    expect(brandingCalls()).toBe(1)

    useClassifier((latest) => {
      if (latest.includes('regenerate')) return { action: 'regenerate' }
      return { action: 'smalltalk', reply: 'ok' }
    })
    await handleWebhook(makeTextPayload('regenerate', 'wamid.b6'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')

    expect(brandingCalls()).toBe(1)
  }, 20000)
})
