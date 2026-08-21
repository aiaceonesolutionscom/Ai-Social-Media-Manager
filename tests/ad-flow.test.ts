import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import {
  initStore,
  resetStore,
  connectAccount,
  createAdCampaign,
  getAdCampaign,
  getAccountByPlatform,
  resolveUserPhone,
  updateAdCampaign,
} from '../src/store.js'
import { buildMetaTargeting, normalizeInterests } from '../src/lib/adTargeting.js'
import { getMissingAdFields } from '../src/pipeline/conversation.js'
import { launchMetaAd } from '../src/lib/metaAds.js'
import { fetchWithRetry } from '../src/lib/http.js'
import { applyAdCampaignAction, launchAdCampaign } from '../src/pipeline/adConversation.js'
import { sendText } from '../src/lib/whatsapp.js'
import { config } from '../src/config.js'
import { PHONE, registerTestUser } from './helpers.js'

vi.mock('../src/lib/http.js', () => ({
  fetchWithRetry: vi.fn(),
}))

const fetchMock = vi.mocked(fetchWithRetry)
const sendTextMock = vi.mocked(sendText)

function okResponse(id: string): any {
  return { ok: true, json: async () => ({ id }) }
}

function launchParams(overrides: Record<string, unknown> = {}): any {
  return {
    adAccountId: 'act_1',
    accessToken: 'tok',
    name: 'Test ad',
    pageId: 'pg',
    imageUrl: 'https://img.example.com/ad.png',
    primaryText: 'primary',
    headline: 'headline',
    description: 'description',
    linkUrl: 'https://example.com/landing',
    objective: 'OUTCOME_ENGAGEMENT',
    budgetCents: 500,
    budgetType: 'daily',
    currency: 'USD',
    startDate: '2026-01-01',
    targeting: { geo_locations: { countries: ['US'] } },
    ...overrides,
  }
}

describe('C3 — dynamic ad requirement collection never guesses', () => {
  it('getMissingAdFields requires product, budget, location and audience', () => {
    const missing = getMissingAdFields({} as any)
    expect(missing).toEqual([
      'product/service to advertise',
      'daily budget',
      'target location (city/country)',
      'target audience (who should see this ad)',
    ])
  })

  it('getMissingAdFields is satisfied only when all four are present', () => {
    const missing = getMissingAdFields({
      product: 'gym',
      budget: 100,
      location: 'Karachi',
      audience: 'young adults',
    })
    expect(missing).toEqual([])
  })
})

describe('H4 — targeting never invents interests', () => {
  it('buildMetaTargeting omits the hardcoded Digital Marketing interest entirely', () => {
    const t = buildMetaTargeting({
      ageMin: 18,
      ageMax: 40,
      genders: ['all'],
      locations: ['United States'],
      interests: ['Digital Marketing', 'Fitness'],
    })
    expect(t).not.toHaveProperty('interests')
  })

  it('buildMetaTargeting only emits resolved, real interest IDs', () => {
    const t = buildMetaTargeting({
      ageMin: 18,
      ageMax: 40,
      genders: ['all'],
      locations: ['US'],
      interests: ['Fitness'],
      interestIds: { fitness: '6013600000001' },
    })
    expect(t.interests).toEqual([{ id: '6013600000001', name: 'Fitness' }])
  })

  it('normalizeInterests drops names that cannot be resolved to an ID', () => {
    expect(normalizeInterests(['Digital Marketing'], undefined)).toEqual([])
    expect(normalizeInterests(['Made Up Interest'], { fitness: '6013600000001' })).toEqual([])
  })
})

describe('H3 — promoted_object is required for conversion objectives', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('OUTCOME_SALES without a pixel fails BEFORE any Meta call with clear guidance', async () => {
    fetchMock.mockResolvedValue(okResponse('fake'))
    await expect(
      launchMetaAd(launchParams({ objective: 'OUTCOME_SALES' })),
    ).rejects.toThrow(/META_ADS_PIXEL_ID/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('OUTCOME_LEADS creates the ad set with promoted_object { page_id }', async () => {
    fetchMock.mockResolvedValue(okResponse('fake'))
    await launchMetaAd(launchParams({ objective: 'OUTCOME_LEADS' }))
    const adsetCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/adsets'))
    expect(adsetCall).toBeDefined()
    const body = JSON.parse((adsetCall as [string, any])[1].body)
    expect(body.promoted_object).toEqual({ page_id: 'pg' })
  })

  it('OUTCOME_SALES with a pixelId sets promoted_object { pixel_id }', async () => {
    fetchMock.mockResolvedValue(okResponse('fake'))
    await launchMetaAd(launchParams({ objective: 'OUTCOME_SALES', pixelId: 'PIX123' }))
    const adsetCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/adsets'))
    expect(adsetCall).toBeDefined()
    const body = JSON.parse((adsetCall as [string, any])[1].body)
    expect(body.promoted_object).toEqual({ pixel_id: 'PIX123' })
  })
})

describe('H2 — campaign actions resolve WhatsApp alias before the meta_ads lookup', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(okResponse('ok'))
    await resetStore()
    await registerTestUser()
  })

  it('account lookup resolves a WhatsApp alias before the meta_ads lookup (H2)', async () => {
    const ALIAS = '923001112223'
    await connectAccount({ phone: PHONE, platform: 'whatsapp', accountId: ALIAS, accountName: 'Alias', accessToken: 'wa-token' })
    await connectAccount({ phone: PHONE, platform: 'meta_ads', accountId: 'act_alias', accountName: 'Ads', accessToken: 'meta-token' })

    // Raw alias lookup misses (the account lives under the canonical phone)…
    expect(await getAccountByPlatform(ALIAS, 'meta_ads')).toBeUndefined()
    // …but the resolved canonical phone finds it — exactly what applyAdCampaignAction now does.
    expect((await getAccountByPlatform(await resolveUserPhone(ALIAS), 'meta_ads'))?.accessToken).toBe('meta-token')
  })

  it('applyAdCampaignAction works end-to-end (no "account not connected" throw)', async () => {
    await connectAccount({ phone: PHONE, platform: 'meta_ads', accountId: 'act_alias', accountName: 'Ads', accessToken: 'meta-token' })

    const campaign = await createAdCampaign({
      phone: PHONE,
      name: 'H2 campaign',
      objective: 'OUTCOME_ENGAGEMENT',
      adContent: { headline: 'H', primaryText: 'P', description: 'D', callToAction: 'Learn More', linkUrl: 'https://example.com' },
      targeting: { ageMin: 18, ageMax: 40, genders: ['all'], locations: ['US'] },
      budgetCents: 100,
      budgetType: 'daily',
      currency: 'USD',
    })
    await updateAdCampaign(campaign.id, { campaignId: 'REAL_camp_1' }, { phone: PHONE })

    const prev = config.dev.enabled
    config.dev.enabled = false
    try {
      await applyAdCampaignAction(campaign.id, 'pause')
    } finally {
      config.dev.enabled = prev
    }

    const after = await getAdCampaign(campaign.id)
    expect(after!.status).toBe('paused')
  })
})

describe('H5 — no cancel/double-launch state drift', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    sendTextMock.mockClear()
    await resetStore()
    await registerTestUser()
  })

  it('launchAdCampaign refuses to re-launch a campaign that is mid-creation', async () => {
    const campaign = await createAdCampaign({
      phone: PHONE,
      name: 'H5 campaign',
      objective: 'OUTCOME_ENGAGEMENT',
      adContent: { headline: 'H', primaryText: 'P', description: 'D', callToAction: 'Learn More', linkUrl: 'https://example.com' },
      targeting: { ageMin: 18, ageMax: 40, genders: ['all'], locations: ['US'] },
      budgetCents: 100,
      budgetType: 'daily',
      currency: 'USD',
    })
    await updateAdCampaign(campaign.id, { status: 'creating' }, { phone: PHONE })

    await launchAdCampaign(campaign.id)

    const after = await getAdCampaign(campaign.id)
    expect(after!.status).toBe('creating')
    expect(sendTextMock).not.toHaveBeenCalled()
  })
})