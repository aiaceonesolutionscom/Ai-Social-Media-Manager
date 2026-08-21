import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, connectAccount, createAdCampaign, getAdCampaign } from '../src/store.js'
import { generateAndPreviewAd, launchAdCampaign } from '../src/pipeline/adConversation.js'
import { generateAdContent, generateAdTargeting, suggestAdObjective } from '../src/pipeline/adGenerate.js'
import { launchMetaAd } from '../src/lib/metaAds.js'
import { generateImage } from '../src/lib/image.js'
import { sendText, sendImage, sendReplyButtons } from '../src/lib/whatsapp.js'
import { saveImageBuffer } from '../src/storage.js'
import { config } from '../src/config.js'
import type { AdContent } from '../src/types.js'
import { PHONE, IMAGE_BUFFER, registerTestUser } from './helpers.js'

vi.mock('../src/lib/metaAds.js', () => ({
  launchMetaAd: vi.fn(),
  setMetaCampaignStatus: vi.fn(),
}))

vi.mock('../src/pipeline/adGenerate.js', () => ({
  generateAdContent: vi.fn(),
  generateAdTargeting: vi.fn(),
  suggestAdObjective: vi.fn(),
}))

const generateAdContentMock = vi.mocked(generateAdContent)
const generateAdTargetingMock = vi.mocked(generateAdTargeting)
const suggestAdObjectiveMock = vi.mocked(suggestAdObjective)
const generateImageMock = vi.mocked(generateImage)
const saveImageBufferMock = vi.mocked(saveImageBuffer)
const launchMetaAdMock = vi.mocked(launchMetaAd)

const CONTENT_NO_LINK: AdContent = {
  headline: 'Boost your business',
  primaryText: 'Great offers this week.',
  description: 'Visit us today.',
  callToAction: 'Learn More',
}

describe('P2-18 — the user website becomes the ad landing URL', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
    generateAdContentMock.mockResolvedValue(CONTENT_NO_LINK)
    generateAdTargetingMock.mockResolvedValue({ ageMin: 18, ageMax: 40, genders: ['all'], locations: ['US'], interests: [] })
    suggestAdObjectiveMock.mockResolvedValue('OUTCOME_ENGAGEMENT')
    generateImageMock.mockResolvedValue(IMAGE_BUFFER)
    saveImageBufferMock.mockResolvedValue({ localFileUrl: 'http://mock/media/ad.png', filePath: 'images/ad.png' })
    sendTextMockResolved()
  })

  function sendTextMockResolved(): void {
    vi.mocked(sendText).mockResolvedValue(undefined)
    vi.mocked(sendImage).mockResolvedValue(undefined)
    vi.mocked(sendReplyButtons).mockResolvedValue(undefined)
  }

  it('generateAndPreviewAd stores the user website as the ad landing URL', async () => {
    await generateAndPreviewAd(PHONE, {
      product: 'Gym membership',
      audience: 'young adults',
      location: 'Karachi',
      budget: 20,
      budgetType: 'daily',
      currency: 'USD',
      websiteUrl: 'https://mygym.example.com',
    }, { kind: 'ad_preview', postId: '' })

    const campaigns = (await import('../src/store.js')).listAdCampaignsByPhone
    const list = await campaigns(PHONE)
    const campaign = list[0]
    expect(campaign.adContent.linkUrl).toBe('https://mygym.example.com')
  }, 15000)

  it('launchAdCampaign passes the landing URL to Meta', async () => {
    const prev = config.dev.enabled
    config.dev.enabled = false
    try {
      await connectAccount({ phone: PHONE, platform: 'meta_ads', accountId: 'act_1', accountName: 'Ads', accessToken: 'tok' })
      launchMetaAdMock.mockResolvedValue({ campaignId: 'REAL_c', adSetId: 'REAL_a', adId: 'REAL_ad', creativeId: 'REAL_cre' })

      const campaign = await createAdCampaign({
        phone: PHONE,
        name: 'URL campaign',
        objective: 'OUTCOME_ENGAGEMENT',
        adContent: { ...CONTENT_NO_LINK, linkUrl: 'https://example.com/landing' },
        targeting: { ageMin: 18, ageMax: 40, genders: ['all'], locations: ['US'] },
        budgetCents: 2000,
        budgetType: 'daily',
        currency: 'USD',
        imageUrl: 'https://img.example.com/ad.png',
      })

      await launchAdCampaign(campaign.id)

      const args = launchMetaAdMock.mock.calls[0][0] as { linkUrl: string }
      expect(args.linkUrl).toBe('https://example.com/landing')
      expect((await getAdCampaign(campaign.id))!.status).toBe('active')
    } finally {
      config.dev.enabled = prev
    }
  }, 15000)

  it('a campaign without a landing URL is rejected at launch, not silently accepted', async () => {
    const prev = config.dev.enabled
    config.dev.enabled = false
    try {
      await connectAccount({ phone: PHONE, platform: 'meta_ads', accountId: 'act_1', accountName: 'Ads', accessToken: 'tok' })
      const campaign = await createAdCampaign({
        phone: PHONE,
        name: 'No URL campaign',
        objective: 'OUTCOME_ENGAGEMENT',
        adContent: CONTENT_NO_LINK,
        targeting: { ageMin: 18, ageMax: 40, genders: ['all'], locations: ['US'] },
        budgetCents: 2000,
        budgetType: 'daily',
        currency: 'USD',
        imageUrl: 'https://img.example.com/ad.png',
      })

      await launchAdCampaign(campaign.id)

      expect(launchMetaAdMock).not.toHaveBeenCalled()
      expect((await getAdCampaign(campaign.id))!.status).toBe('failed')
    } finally {
      config.dev.enabled = prev
    }
  }, 15000)
})