import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createPost, updatePost, getConversation, listPostsForUser, createAdCampaign, listAdCampaignsByPhone } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { generateFullDraft, brandCheck, generateImagePrompt } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import { sendText, sendImage, sendReplyButtons } from '../src/lib/whatsapp.js'
import { registerTestUser, PHONE, makeTextPayload } from './helpers.js'
import type { WrittenContent } from '../src/types.js'

const chatJsonMock = vi.mocked(chatJson)
const sendTextMock = vi.mocked(sendText)
const sendImageMock = vi.mocked(sendImage)
const sendReplyButtonsMock = vi.mocked(sendReplyButtons)

const CONTENT: WrittenContent = {
  hook: 'Morning!',
  caption: '3 tips for a better morning routine.',
  cta: 'Save this',
  emojis: '🌅',
  hashtags: '#Morning',
  seoKeywords: ['morning'],
}

describe('P4 — reuse a past post / past ad as a new draft', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.resetAllMocks()
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'ok' })
    generateFullDraft.mockResolvedValue({ ...CONTENT, language: 'English' } as never)
    brandCheck.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
    generateImagePrompt.mockResolvedValue('scene')
    generateImage.mockResolvedValue(Buffer.from('img'))
    sendTextMock.mockResolvedValue(undefined)
    sendImageMock.mockResolvedValue(undefined)
    sendReplyButtonsMock.mockResolvedValue(undefined)
    await resetStore()
    await registerTestUser()
  })

  it('creates a new post seeded from a previous one (original untouched)', async () => {
    const source = await createPost(PHONE)
    await updatePost(source.id, {
      transcript: 'morning post',
      intent: { topic: 'morning', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' },
      content: CONTENT,
      imageUrl: 'http://mock/media/src.png',
      status: 'DONE',
    })

    chatJsonMock.mockResolvedValue({ action: 'reuse_post', targetPostId: source.id })
    await handleWebhook(makeTextPayload('make a new post like my last one', 'wamid.r1'))

    const posts = await listPostsForUser(PHONE)
    expect(posts.length).toBe(2)
    const created = posts.find((p) => p.id !== source.id)!
    expect(created.content?.caption).toBe(CONTENT.caption)
    expect(created.imageUrl).toBe('http://mock/media/src.png')
    expect(created.status).toBe('AWAITING_APPROVAL')

    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('awaiting_approval')
    expect(conv.postId).toBe(created.id)

    // original must be unchanged
    const refreshed = (await listPostsForUser(PHONE)).find((p) => p.id === source.id)!
    expect(refreshed.status).toBe('DONE')
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('prepared a new post'))
  })

  it('creates a new draft ad seeded from a previous ad (original untouched, not launched)', async () => {
    const src = await createAdCampaign({
      phone: PHONE,
      name: 'Dog Ad',
      objective: 'OUTCOME_ENGAGEMENT',
      adContent: { headline: 'Adopt a dog', primaryText: 'Find your best friend', description: 'd', callToAction: 'LEARN_MORE', linkUrl: 'https://x.com' },
      targeting: { ageMin: 18, ageMax: 65, genders: ['all'], locations: ['Karachi'], interests: [] },
      budgetCents: 500,
      budgetType: 'daily',
      currency: 'USD',
      imageUrl: 'http://mock/media/ad.png',
    })

    chatJsonMock.mockResolvedValue({ action: 'reuse_ad', targetAdId: src.id })
    await handleWebhook(makeTextPayload('reuse this ad', 'wamid.r2'))

    const ads = await listAdCampaignsByPhone(PHONE)
    expect(ads.length).toBe(2)
    const copy = ads.find((a) => a.id !== src.id)!
    expect(copy.name).toBe('Dog Ad (copy)')
    expect(copy.adContent.headline).toBe('Adopt a dog')
    expect(copy.status).toBe('pending')

    // original untouched + still pending (not launched)
    const refreshed = (await listAdCampaignsByPhone(PHONE)).find((a) => a.id === src.id)!
    expect(refreshed.status).toBe('pending')

    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('ad_preview')
    expect(conv.postId).toBe(copy.id)
    const boostBtns = sendReplyButtonsMock.mock.calls.find((c) => (c[2] as { id: string }[]).some((b) => b.id === 'ad_approve'))
    expect(boostBtns).toBeTruthy()
  })
})
