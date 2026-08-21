import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, getConversation, getPost, setConversation, createPost, updatePost, createAdCampaign, getAdCampaign, getUserPreferences, setUserTimezone, detectCityTimezone } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { sendText } from '../src/lib/whatsapp.js'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import { PHONE, makeTextPayload, registerTestUser } from './helpers.js'

const chatJsonMock = vi.mocked(chatJson)
const sendTextMock = vi.mocked(sendText)

describe('P5-TZ — timezone detection & capture', () => {
  beforeAll(() => initStore())
  beforeEach(async () => {
    vi.clearAllMocks()
    chatJsonMock.mockReset()
    clearFeatureCache(PHONE)
    await resetStore()
    await registerTestUser()
  })

  it('detects a city/country from a message and stores the IANA timezone', async () => {
    expect(detectCityTimezone('india nnad owners')).toBe('Asia/Kolkata')
    expect(detectCityTimezone('Karachi time')).toBe('Asia/Karachi')
    expect(detectCityTimezone('hello')).toBeUndefined()
    await setUserTimezone(PHONE, 'Asia/Karachi')
    const prefs = await getUserPreferences(PHONE)
    expect(prefs?.timezone).toBe('Asia/Karachi')
  })
})

describe('P5-EDITAD — edit from idle re-shows the existing ad preview (no re-gather)', () => {
  beforeAll(() => initStore())
  beforeEach(async () => {
    vi.clearAllMocks()
    chatJsonMock.mockReset()
    clearFeatureCache(PHONE)
    await resetStore()
    await registerTestUser()
  })

  it('idle edit_ad shows the current preview and enters ad_preview instead of re-asking fields', async () => {
    await createAdCampaign({
      phone: PHONE,
      name: 'Email agent promo',
      objective: 'OUTCOME_LEADS',
      adContent: { headline: 'H', primaryText: 'P', description: 'D', callToAction: 'Learn More', linkUrl: 'https://aceonesolutions.com/' },
      targeting: { ageMin: 25, ageMax: 55, genders: ['all'], locations: ['India'], interests: ['Email marketing'] },
      budgetCents: 2300,
      budgetType: 'daily',
      currency: 'USD',
    })
    await setConversation(PHONE, { kind: 'idle' })

    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const sys = String((messages[0] as { content: string }).content)
      if (sys.includes('ACTION')) return { action: 'edit_ad' }
      return { action: 'unclear', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('my ad edit karna hai', 'wamid.editad1'))

    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('ad_preview')
    const allText = sendTextMock.mock.calls.map((c) => c[1]).join('\n')
    // Preview is shown (current creative + action buttons), NOT a fresh gather prompt.
    expect(allText).toContain('Yeh ad ka current preview hai')
    expect(allText).not.toContain('What is your website URL?')
    expect(allText).not.toContain('What daily budget would you like to use?')
  }, 20000)
})

describe('P5-PUBLISHNOW — publish most-recent post directly from idle', () => {
  beforeAll(() => initStore())
  beforeEach(async () => {
    vi.clearAllMocks()
    chatJsonMock.mockReset()
    clearFeatureCache(PHONE)
    await resetStore()
    await registerTestUser({ tokens: 1000 })
  })

  it('idle approve + publishNow publishes the latest ready post immediately', async () => {
    const post = await createPost(PHONE)
    await updatePost(post.id, {
      status: 'AWAITING_APPROVAL',
      content: { hook: 'h', caption: 'Buy our stuff', cta: 'DM', emojis: '', hashtags: '#sale', seoKeywords: [] },
      imageUrl: 'http://mock/media/x.png',
      platforms: ['instagram', 'facebook'],
    })
    await setConversation(PHONE, { kind: 'idle' })

    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const sys = String((messages[0] as { content: string }).content)
      if (sys.includes('ACTION')) return { action: 'approve', publishNow: true }
      return { action: 'unclear', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('abhi publish kar do', 'wamid.pubnow1'))

    const after = await getConversation(PHONE)
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('Publishing now'))
    const direct = await getPost(post.id)
    // setStage(APPROVED) runs synchronously before the async publish; status must
    // have advanced past NEW/AWAITING_APPROVAL.
    expect(['APPROVED', 'PREPARING_TO_PUBLISH', 'PUBLISHING', 'DONE', 'PARTIAL_SUCCESS']).toContain(direct!.status)
    void after
  }, 20000)
})
