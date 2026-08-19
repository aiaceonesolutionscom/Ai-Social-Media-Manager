import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import {
  initStore,
  resetStore,
  createPackage,
  getUser,
  getConversation,
  getPost,
  createPost,
  setStage,
} from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { sendText } from '../src/lib/whatsapp.js'
import { publishImage } from '../src/lib/instagram.js'
import { generateFullDraft, brandCheck, generateImagePrompt } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import { getDb } from '../src/db.js'
import { adCampaigns, scheduledPosts, posts } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import { PHONE, IMAGE_BUFFER, makeTextPayload, registerTestUser } from './helpers.js'

const chatJsonMock = vi.mocked(chatJson)
const sendTextMock = vi.mocked(sendText)
const publishImageMock = vi.mocked(publishImage)
const generateFullDraftMock = vi.mocked(generateFullDraft)
const brandCheckMock = vi.mocked(brandCheck)
const generateImagePromptMock = vi.mocked(generateImagePrompt)
const generateImageMock = vi.mocked(generateImage)

const DRAFT = {
  id: 'post-x',
  phone: PHONE,
  status: 'WRITTEN',
  transcript: 'Post about the gym.',
  intent: { topic: 'Gym', audience: 'young adults', tone: 'motivational', goal: 'promote', language: 'English', emotion: 'exciting' },
  plan: { positioning: 'Gym', angle: 'fitness', suggestedTime: '7am' },
  content: { hook: 'H', caption: 'C', cta: 'X', emojis: '✨', hashtags: '#Gym', seoKeywords: ['gym'] },
  imagePrompt: 'gym scene',
}

function mockPipeline(): void {
  generateFullDraftMock.mockResolvedValue(DRAFT as never)
  brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
  generateImagePromptMock.mockResolvedValue('gym scene')
  generateImageMock.mockResolvedValue(IMAGE_BUFFER)
}

async function createPackageWith(slug: string, features: Record<string, boolean>): Promise<void> {
  await createPackage({
    name: slug,
    slug,
    description: 'test',
    priceCents: 100,
    includedTokens: 1000,
    features,
  })
}

async function makeAwaitingApproval(): Promise<string> {
  chatJsonMock.mockResolvedValueOnce({
    action: 'generate_post',
    intent: { topic: 'Gym', audience: 'young adults', tone: 'motivational', language: 'English', goal: 'promote', emotion: 'exciting' },
  })
  await handleWebhook(makeTextPayload('Mere gym ki post bana do', 'wamid.make1'))
  const conv = await getConversation(PHONE)
  expect(conv.kind).toBe('awaiting_approval')
  return conv.postId!
}

describe('Entitlement gates — backend enforcement', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    chatJsonMock.mockReset()
    clearFeatureCache(PHONE)
    await resetStore()
    await getDb().delete(adCampaigns)
    mockPipeline()
  })

  it('user without ad_campaigns → "create ad" creates nothing, deducts nothing, explains naturally', async () => {
    await createPackageWith('no-ads', {
      whatsapp_broadcast: true,
      facebook_publishing: true,
      instagram_publishing: true,
      image_generation: true,
    })
    await registerTestUser({ packageId: 'no-ads' })

    chatJsonMock.mockResolvedValue({ action: 'create_ad', adData: { product: 'my gym' } })
    const balanceBefore = (await getUser(PHONE))!.tokensRemaining

    await handleWebhook(makeTextPayload('create ad for my gym', 'wamid.ad1'))

    const ads = await getDb().select().from(adCampaigns)
    expect(ads).toHaveLength(0)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(balanceBefore)
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('not included'))
  })

  it('user without scheduled_publishing → "kal 7 baje" schedules nothing', async () => {
    await createPackageWith('no-sched', {
      whatsapp_broadcast: true,
      facebook_publishing: true,
      instagram_publishing: true,
      image_generation: true,
      // scheduled_publishing intentionally absent
    })
    await registerTestUser({ packageId: 'no-sched' })

    await makeAwaitingApproval()
    sendTextMock.mockClear()

    chatJsonMock.mockResolvedValueOnce({ action: 'schedule_post', scheduleAt: 'in 2 hours' })
    await handleWebhook(makeTextPayload('kal 7 baje kar dena', 'wamid.sched1'))

    const scheduled = await getDb().select().from(scheduledPosts)
    expect(scheduled).toHaveLength(0)
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('not included'))
  })

  it('negation "don\'t publish" in awaiting_approval cancels — never publishes', async () => {
    await registerTestUser()
    await makeAwaitingApproval()

    const callsBefore = chatJsonMock.mock.calls.length
    publishImageMock.mockClear()
    await handleWebhook(makeTextPayload("don't publish", 'wamid.neg1'))

    expect(chatJsonMock).toHaveBeenCalledTimes(callsBefore) // negation short-circuits before LLM
    expect(publishImageMock).not.toHaveBeenCalled()
    const conv = await getConversation(PHONE)
    expect(['idle', 'awaiting_approval']).toContain(conv.kind)
  })

  it('user without image_generation → post proceeds text-only (no image call)', async () => {
    await createPackageWith('no-img', {
      whatsapp_broadcast: true,
      facebook_publishing: true,
      instagram_publishing: true,
      // image_generation intentionally absent
    })
    await registerTestUser({ packageId: 'no-img' })

    chatJsonMock.mockResolvedValue({
      action: 'generate_post',
      intent: { topic: 'Gym', audience: 'young adults', tone: 'motivational', language: 'English', goal: 'promote', emotion: 'exciting' },
    })

    await handleWebhook(makeTextPayload('Mere gym ki post bana do', 'wamid.noimg1'))

    expect(generateImageMock).not.toHaveBeenCalled()
    const postRow = await getDb().select().from(posts).where(eq(posts.phone, PHONE)).limit(1)
    expect(postRow[0]).toBeDefined()
    expect(postRow[0]!.stage).toBe('AWAITING_APPROVAL')
    expect((postRow[0]!.data as { imageUrl?: string }).imageUrl).toBe('')
    const saved = await getPost(postRow[0]!.id)
    expect(saved?.status).toBe('AWAITING_APPROVAL')
    expect(saved?.imageUrl).toBe('')
  })
})

describe('Entity resolution — use_post_as_ad targets the referenced post', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    chatJsonMock.mockReset()
    clearFeatureCache(PHONE)
    await resetStore()
    await getDb().delete(adCampaigns)
    mockPipeline()
    await registerTestUser()
  })

  it('LLM targetPostId resolves the OLDER post, not the most recent one', async () => {
    // Air Runner is created first (older); Jackets second (most recent).
    const airRunner = (await createPost(PHONE)).id
    await setStage(airRunner, 'AWAITING_APPROVAL', { intent: { topic: '' } })
    const jackets = (await createPost(PHONE)).id
    await setStage(jackets, 'AWAITING_APPROVAL', { intent: { topic: '' } })

    // The LLM resolved "Air Runner wali post ki ad" to the older post's id.
    chatJsonMock.mockResolvedValue({ action: 'use_post_as_ad', targetPostId: airRunner })

    await handleWebhook(makeTextPayload('Air Runner wali post ki ad bana do', 'wamid.ent1'))

    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('ad_gathering')
    const adData = (conv as { adData?: { existingPostId?: string } }).adData
    expect(adData?.existingPostId).toBe(airRunner)
    expect(adData?.existingPostId).not.toBe(jackets)
  })

  it('foreign post id is rejected — ownership validated', async () => {
    const otherUser = (await createPost('9999999998')).id
    await setStage(otherUser, 'AWAITING_APPROVAL', { intent: { topic: '' } })

    chatJsonMock.mockResolvedValue({ action: 'use_post_as_ad', targetPostId: otherUser })

    await handleWebhook(makeTextPayload('uski post ki ad bana do', 'wamid.ent2'))

    // The foreign post is rejected; with no owned posts to fall back to the
    // assistant refuses naturally and stays in idle (nothing was created).
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('idle')
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining("don't have a recent post"))
  })
})