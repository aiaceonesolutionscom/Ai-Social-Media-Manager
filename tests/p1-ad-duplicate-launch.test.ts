import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createAdCampaign, updateAdCampaign, getAdCampaign, claimAdCampaignForLaunch } from '../src/store.js'
import { launchAdCampaign } from '../src/pipeline/adConversation.js'
import { sendText } from '../src/lib/whatsapp.js'
import { config } from '../src/config.js'
import { PHONE, registerTestUser } from './helpers.js'

const sendTextMock = vi.mocked(sendText)

async function makeCampaign(status?: string): Promise<string> {
  const campaign = await createAdCampaign({
    phone: PHONE,
    name: 'Race campaign',
    objective: 'OUTCOME_ENGAGEMENT',
    adContent: { headline: 'H', primaryText: 'P', description: 'D', callToAction: 'Learn More', linkUrl: 'https://example.com' },
    targeting: { ageMin: 18, ageMax: 40, genders: ['all'], locations: ['US'] },
    budgetCents: 100,
    budgetType: 'daily',
    currency: 'USD',
    imageUrl: 'https://img.example.com/ad.png',
  })
  if (status) {
    await updateAdCampaign(campaign.id, { status: status as never })
  }
  return campaign.id
}

describe('P1-20 — ad launch is claimed atomically (no duplicate Meta campaigns)', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
  })

  it('claims a pending campaign and transitions it to creating', async () => {
    const id = await makeCampaign()
    expect(await claimAdCampaignForLaunch(id)).toBe(true)
    expect((await getAdCampaign(id))!.status).toBe('creating')
  })

  it('claims a scheduled campaign too', async () => {
    const id = await makeCampaign('scheduled')
    expect(await claimAdCampaignForLaunch(id)).toBe(true)
    expect((await getAdCampaign(id))!.status).toBe('creating')
  })

  it('refuses to claim a campaign already being launched or in a terminal state', async () => {
    for (const status of ['creating', 'active', 'paused', 'stopped', 'cancelled', 'failed']) {
      const id = await makeCampaign(status)
      expect(await claimAdCampaignForLaunch(id)).toBe(false)
      expect((await getAdCampaign(id))!.status).toBe(status)
    }
  })

  it('only one of two concurrent claim attempts wins', async () => {
    const id = await makeCampaign()
    const results = await Promise.all([claimAdCampaignForLaunch(id), claimAdCampaignForLaunch(id)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await getAdCampaign(id))!.status).toBe('creating')
  })

  it('two concurrent launches produce exactly one active campaign and one DEV message', async () => {
    const prev = config.dev.enabled
    config.dev.enabled = true
    try {
      const id = await makeCampaign()
      await Promise.all([launchAdCampaign(id), launchAdCampaign(id)])

      const after = await getAdCampaign(id)
      expect(after!.status).toBe('active')
      const devMessages = sendTextMock.mock.calls.filter((c) => String(c[1]).includes('DEV MODE'))
      expect(devMessages).toHaveLength(1)
    } finally {
      config.dev.enabled = prev
    }
  })
})