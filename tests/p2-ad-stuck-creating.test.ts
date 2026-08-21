import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createAdCampaign, updateAdCampaign, getAdCampaign, claimAdCampaignForLaunch, recoverStuckAdCampaigns } from '../src/store.js'
import { getDb } from '../src/db.js'
import { adCampaigns } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { launchAdCampaign } from '../src/pipeline/adConversation.js'
import { sendText } from '../src/lib/whatsapp.js'
import { config } from '../src/config.js'
import { PHONE, registerTestUser } from './helpers.js'

const sendTextMock = vi.mocked(sendText)

async function makeCampaign(): Promise<string> {
  const campaign = await createAdCampaign({
    phone: PHONE,
    name: 'Stuck campaign',
    objective: 'OUTCOME_ENGAGEMENT',
    adContent: { headline: 'H', primaryText: 'P', description: 'D', callToAction: 'Learn More', linkUrl: 'https://example.com' },
    targeting: { ageMin: 18, ageMax: 40, genders: ['all'], locations: ['US'] },
    budgetCents: 100,
    budgetType: 'daily',
    currency: 'USD',
    imageUrl: 'https://img.example.com/ad.png',
  })
  return campaign.id
}

async function forceCreating(id: string, launchedAt: string | null, updatedAt?: string): Promise<void> {
  await getDb().update(adCampaigns)
    .set({ status: 'creating', launchStartedAt: launchedAt, updatedAt: updatedAt ?? new Date().toISOString() })
    .where(eq(adCampaigns.id, id))
}

describe('P2-21 — ad campaigns stuck in creating are recovered, not wedged forever', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
    sendTextMock.mockResolvedValue(undefined)
  })

  it('recovers a stale creating campaign back to pending', async () => {
    const id = await makeCampaign()
    await forceCreating(id, new Date(Date.now() - 60 * 60 * 1000).toISOString())

    const recovered = await recoverStuckAdCampaigns()
    expect(recovered).toBe(1)
    const campaign = await getAdCampaign(id)
    expect(campaign!.status).toBe('pending')
  })

  it('does not touch a freshly claimed creating campaign', async () => {
    const id = await makeCampaign()
    await claimAdCampaignForLaunch(id)

    const recovered = await recoverStuckAdCampaigns()
    expect(recovered).toBe(0)
    expect((await getAdCampaign(id))!.status).toBe('creating')
  })

  it('recovers a creating campaign that has no claim timestamp (legacy crash)', async () => {
    const id = await makeCampaign()
    await forceCreating(id, null, new Date(Date.now() - 60 * 60 * 1000).toISOString())

    const recovered = await recoverStuckAdCampaigns()
    expect(recovered).toBe(1)
    expect((await getAdCampaign(id))!.status).toBe('pending')
  })

  it('leaves a fresh creating campaign with no claim timestamp alone (mid-creation)', async () => {
    const id = await makeCampaign()
    await forceCreating(id, null)

    const recovered = await recoverStuckAdCampaigns()
    expect(recovered).toBe(0)
    expect((await getAdCampaign(id))!.status).toBe('creating')
  })

  it('launchAdCampaign self-heals a stale creating campaign', async () => {
    const prev = config.dev.enabled
    config.dev.enabled = true
    try {
      const id = await makeCampaign()
      await forceCreating(id, new Date(Date.now() - 60 * 60 * 1000).toISOString())

      await launchAdCampaign(id)

      expect((await getAdCampaign(id))!.status).toBe('active')
      const devMessages = sendTextMock.mock.calls.filter((c) => String(c[1]).includes('DEV MODE'))
      expect(devMessages).toHaveLength(1)
    } finally {
      config.dev.enabled = prev
    }
  }, 15000)

  it('launchAdCampaign leaves a fresh creating campaign alone (concurrent launch)', async () => {
    const prev = config.dev.enabled
    config.dev.enabled = true
    try {
      const id = await makeCampaign()
      await claimAdCampaignForLaunch(id)

      await launchAdCampaign(id)

      expect((await getAdCampaign(id))!.status).toBe('creating')
    } finally {
      config.dev.enabled = prev
    }
  }, 15000)
})