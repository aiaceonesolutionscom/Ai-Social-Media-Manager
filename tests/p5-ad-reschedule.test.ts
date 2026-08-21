import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, getConversation, setConversation, createAdCampaign, getAdCampaign } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { sendText } from '../src/lib/whatsapp.js'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import { PHONE, makeTextPayload, registerTestUser } from './helpers.js'

const chatJsonMock = vi.mocked(chatJson)
const sendTextMock = vi.mocked(sendText)

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

describe('P5-ADSTATE — ad reschedule from idle recovers conversation state', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    chatJsonMock.mockReset()
    clearFeatureCache(PHONE)
    await resetStore()
    await registerTestUser()
  })

  it('reschedules the most recent ad when idle without targetAdId (no "which post?" dead end)', async () => {
    const campaign = await createAdCampaign({
      phone: PHONE,
      name: 'Running dog promo',
      objective: 'OUTCOME_ENGAGEMENT',
      adContent: { headline: 'H', primaryText: 'P', description: 'D', callToAction: 'Learn More', linkUrl: 'https://example.com' },
      targeting: { ageMin: 18, ageMax: 40, genders: ['all'], locations: ['US'] },
      budgetCents: 100,
      budgetType: 'daily',
      currency: 'USD',
    })
    await setConversation(PHONE, { kind: 'idle' })

    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const sys = String((messages[0] as { content: string }).content)
      if (sys.includes('ACTION')) return { action: 'schedule_post', scheduleAt: FUTURE }
      return { action: 'unclear', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('ad ko reschedule kar do 23 august 3 am', 'wamid.adresched1'))

    const after = await getAdCampaign(campaign.id)
    expect(after!.publishAt).toBe(FUTURE)
    expect(after!.status).toBe('scheduled')
    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('Ad rescheduled'))
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('idle')
  }, 20000)

  it('does not reschedule an ad when a real post matches targetPostId', async () => {
    await createAdCampaign({
      phone: PHONE,
      name: 'Running dog promo',
      objective: 'OUTCOME_ENGAGEMENT',
      adContent: { headline: 'H', primaryText: 'P', description: 'D', callToAction: 'Learn More', linkUrl: 'https://example.com' },
      targeting: { ageMin: 18, ageMax: 40, genders: ['all'], locations: ['US'] },
      budgetCents: 100,
      budgetType: 'daily',
      currency: 'USD',
    })
    await setConversation(PHONE, { kind: 'idle' })
    const { createPost, updatePost } = await import('../src/store.js')
    const post = await createPost(PHONE)
    await updatePost(post.id, { status: 'AWAITING_APPROVAL' })

    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const sys = String((messages[0] as { content: string }).content)
      if (sys.includes('ACTION')) return { action: 'schedule_post', scheduleAt: FUTURE, targetPostId: post.id }
      return { action: 'unclear', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('is post ko kal kar do', 'wamid.postsched1'))

    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('Scheduled'))
    // ad must remain untouched
    const ads = await (await import('../src/store.js')).listAdCampaignsByPhone(PHONE)
    expect(ads[0]!.status).not.toBe('scheduled')
  }, 20000)
})
