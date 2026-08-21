import { FastifyInstance } from 'fastify'
import { verifySession } from '../lib/userAuth.js'
import { requireFeature, FeatureNotIncludedError } from '../lib/packagePermissions.js'
import {
  createAdCampaign,
  getAdCampaignByPhone,
  listScheduledAdCampaigns,
  updateAdCampaign,
  cancelAdCampaign,
  mutateAdCampaignStatus,
  listAdCampaignsByPhone,
} from '../store.js'
import { normalizeScheduleTime } from '../pipeline/publish.js'
import { resolveUserTimezone } from '../lib/timezone.js'
import { logger } from '../lib/logger.js'
import { config } from '../config.js'
import type { AdContent, AdTargeting, AdConversationData } from '../types.js'
import { validateBudget, validateScheduleDates } from '../pipeline/adConversation.js'
import { buildMetaTargeting } from '../lib/adTargeting.js'

// Targeting is never auto-guessed: the caller must supply explicit locations.
// Age/gender default to neutral universal values (18-65, all genders) and are
// shown back to the user; geographic targeting (which spends real money) is
// always required.
function parseTargeting(targeting: any, audience: string): AdTargeting {
  return {
    ageMin: typeof targeting?.ageMin === 'number' ? targeting.ageMin : 18,
    ageMax: typeof targeting?.ageMax === 'number' ? targeting.ageMax : 65,
    genders: Array.isArray(targeting?.genders) ? targeting.genders : ['all'],
    locations: Array.isArray(targeting?.locations) ? targeting.locations : [],
    interests: Array.isArray(targeting?.interests)
      ? targeting.interests
      : audience
        ? [audience]
        : [],
  }
}

function parseAdContent(creative_data: any): AdContent {
  return {
    headline: typeof creative_data?.headline === 'string' ? creative_data.headline : 'Special Offer',
    primaryText: typeof creative_data?.primaryText === 'string' ? creative_data.primaryText : 'Discover more with us today.',
    description: typeof creative_data?.description === 'string' ? creative_data.description : '',
    callToAction: typeof creative_data?.callToAction === 'string' ? creative_data.callToAction : 'Learn More',
    linkUrl:
      typeof creative_data?.linkUrl === 'string' && creative_data.linkUrl
        ? creative_data.linkUrl
        : typeof creative_data?.websiteUrl === 'string' && creative_data.websiteUrl
          ? creative_data.websiteUrl
          : undefined,
  }
}

async function authAndOwn(req: any, reply: any): Promise<{ phone: string } | null> {
  const token = req.headers['authorization']?.replace('Bearer ', '') || ''
  if (!token) {
    reply.status(401).send({ error: 'No token provided' })
    return null
  }
  const session = await verifySession(token)
  if (!session) {
    reply.status(401).send({ error: 'Invalid or expired session' })
    return null
  }
  try {
    await requireFeature(session.phone, 'ad_campaigns')
  } catch (err) {
    if (err instanceof FeatureNotIncludedError) {
      reply.status(403).send({ error: err.message })
      return null
    }
    throw err
  }
  return session
}

export async function registerAdSchedulerRoutes(server: FastifyInstance): Promise<void> {

  // Schedule new ad campaign
  server.post('/api/ads/schedule', async (req: any, reply: any) => {
    const session = await authAndOwn(req, reply)
    if (!session) return

    const {
      objective,
      audience,
      targeting,
      budget,
      budgetType,
      currency,
      startDate,
      endDate,
      schedule_time,
      creative_data,
    } = req.body as {
      objective?: string
      audience?: string
      targeting?: { ageMin?: number; ageMax?: number; genders?: string[]; locations?: string[]; interests?: string[] }
      budget?: number
      budgetType?: 'daily' | 'total'
      currency?: string
      startDate?: string
      endDate?: string
      schedule_time?: string
      creative_data?: any
    }

    if (!objective) {
      return reply.status(400).send({ error: 'objective is required' })
    }

    // Geographic targeting is a hard requirement — Meta spends real money per
    // impression, so the location is never invented.
    if (!targeting || !Array.isArray(targeting.locations) || targeting.locations.length === 0) {
      return reply.status(400).send({ error: 'targeting.locations is required — choose at least one country or city. Targeting is never auto-guessed.' })
    }

    const adData: AdConversationData = {
      budget,
      budgetType,
      currency,
      startDate,
      endDate,
      websiteUrl: creative_data?.linkUrl || creative_data?.websiteUrl,
    }
    const budgetCheck = validateBudget(adData)
    if (budgetCheck.error) {
      return reply.status(400).send({ error: budgetCheck.error })
    }
    const dateCheck = validateScheduleDates(adData)
    if (dateCheck.error) {
      return reply.status(400).send({ error: dateCheck.error })
    }
    const linkUrl = creative_data?.linkUrl || creative_data?.websiteUrl
    if (!linkUrl) {
      return reply.status(400).send({ error: 'A website URL is required to create the ad creative' })
    }

    const publishAt = schedule_time ? await normalizeScheduleTime(schedule_time, await resolveUserTimezone(session.phone)) : undefined
    if (schedule_time && !publishAt) {
      return reply.status(400).send({ error: 'schedule_time must be a valid future time (e.g. ISO date, "in 2 hours", "tomorrow at 5pm", "15 August at 9am")' })
    }

    try {
      const campaign = await createAdCampaign({
        phone: session.phone,
        name: typeof creative_data?.name === 'string' && creative_data.name ? creative_data.name : `${objective.replace('OUTCOME_', '')} - Ad Campaign`,
        objective,
        adContent: parseAdContent(creative_data),
        targeting: parseTargeting(targeting, audience || ''),
        budgetCents: budgetCheck.budgetCents,
        budgetType: budgetCheck.budgetType as 'daily' | 'total',
        currency: budgetCheck.currency,
        startDate: dateCheck.startDate,
        endDate: dateCheck.endDate,
        imageUrl: typeof creative_data?.imageUrl === 'string' ? creative_data.imageUrl : undefined,
        publishAt: publishAt || undefined,
      })
      logger.info({ phone: session.phone, adId: campaign.id, publishAt }, 'ad campaign scheduled')
      return reply.send({
        success: true,
        adId: campaign.id,
        scheduledAt: publishAt,
        budget: budgetCheck.budgetCents / 100,
        budgetType: budgetCheck.budgetType,
        currency: budgetCheck.currency,
        startDate: dateCheck.startDate,
        endDate: dateCheck.endDate || null,
        message: publishAt ? 'Ad campaign scheduled successfully' : 'Ad campaign created (not scheduled)',
      })
    } catch (err: any) {
      logger.error({ phone: session.phone, error: (err as Error).message }, 'Failed to schedule ad campaign')
      return reply.status(500).send({ error: `Failed to schedule ad: ${err.message}` })
    }
  })

  // Get user's ad campaigns (all statuses)
  server.get('/api/ads', async (req: any, reply: any) => {
    const session = await authAndOwn(req, reply)
    if (!session) return
    const campaigns = await listAdCampaignsByPhone(session.phone)
    return reply.send({ campaigns })
  })

  // Get user's scheduled ad campaigns
  server.get('/api/ads/scheduled', async (req: any, reply: any) => {
    const session = await authAndOwn(req, reply)
    if (!session) return
    const campaigns = await listScheduledAdCampaigns(session.phone)
    return reply.send({ campaigns })
  })

  // Edit scheduled ad (ownership-scoped)
  server.post('/api/ads/scheduled/:id/edit', async (req: any, reply: any) => {
    const session = await authAndOwn(req, reply)
    if (!session) return

    const { id } = req.params as { id: string }
    const { schedule_time, budget, budgetType, currency, creative_data } = req.body as {
      schedule_time?: string
      budget?: number
      budgetType?: 'daily' | 'total'
      currency?: string
      creative_data?: any
    }

    // Ownership check: must be the owner.
    const existing = await getAdCampaignByPhone(id, session.phone)
    if (!existing) return reply.status(404).send({ error: 'Scheduled ad not found' })

    const patch: Partial<import('../types.js').AdCampaign> = {}
    if (schedule_time) {
      const publishAt = await normalizeScheduleTime(schedule_time, await resolveUserTimezone(session.phone))
      if (!publishAt) {
        return reply.status(400).send({ error: 'schedule_time must be a valid future time' })
      }
      patch.publishAt = publishAt || undefined
    }
    if (budget !== undefined) {
      const adData: AdConversationData = { budget, budgetType, currency }
      const budgetCheck = validateBudget(adData)
      if (budgetCheck.error) return reply.status(400).send({ error: budgetCheck.error })
      patch.budgetCents = budgetCheck.budgetCents
      patch.budgetType = budgetCheck.budgetType as 'daily' | 'total'
      patch.currency = budgetCheck.currency
    }
    if (creative_data) {
      patch.adContent = parseAdContent(creative_data)
      if (creative_data.targeting) {
        patch.targeting = buildMetaTargeting({
          ageMin: creative_data.targeting.ageMin,
          ageMax: creative_data.targeting.ageMax,
          genders: creative_data.targeting.genders,
          locations: creative_data.targeting.locations,
          interests: creative_data.targeting.interests,
        }) as any
      }
    }

    try {
      const ad = await updateAdCampaign(id, patch, { phone: session.phone })
      return reply.send({ success: true, ad })
    } catch (err: any) {
      logger.error({ phone: session.phone, adId: id, error: (err as Error).message }, 'Failed to edit scheduled ad')
      return reply.status(404).send({ error: `Failed to edit scheduled ad: ${err.message}` })
    }
  })

  // Pause a campaign (ownership-scoped)
  server.post('/api/ads/:id/pause', async (req: any, reply: any) => {
    const session = await authAndOwn(req, reply)
    if (!session) return
    const { id } = req.params as { id: string }
    const ok = await mutateAdCampaignStatus(id, session.phone, 'pause')
    if (!ok) return reply.status(404).send({ error: 'Cannot pause this campaign (invalid id/status/ownership)' })
    await syncMetaStatus(id, session.phone, 'PAUSED')
    return reply.send({ success: true, id, status: 'paused' })
  })

  // Resume a campaign (ownership-scoped)
  server.post('/api/ads/:id/resume', async (req: any, reply: any) => {
    const session = await authAndOwn(req, reply)
    if (!session) return
    const { id } = req.params as { id: string }
    const ok = await mutateAdCampaignStatus(id, session.phone, 'resume')
    if (!ok) return reply.status(404).send({ error: 'Cannot resume this campaign (invalid id/status/ownership)' })
    await syncMetaStatus(id, session.phone, 'ACTIVE')
    return reply.send({ success: true, id, status: 'active' })
  })

  // Stop a campaign (ownership-scoped, best-effort Meta deactivation)
  server.post('/api/ads/:id/stop', async (req: any, reply: any) => {
    const session = await authAndOwn(req, reply)
    if (!session) return
    const { id } = req.params as { id: string }
    const ok = await mutateAdCampaignStatus(id, session.phone, 'stop')
    if (!ok) return reply.status(404).send({ error: 'Cannot stop this campaign (invalid id/status/ownership)' })
    await syncMetaStatus(id, session.phone, 'PAUSED')
    return reply.send({ success: true, id, status: 'stopped' })
  })

  // Best-effort sync of the DB-managed status change to Meta. Swallowed on error
  // so the UI always reflects the user's intent. Dev/null Meta IDs are skipped.
  async function syncMetaStatus(id: string, phone: string, metaStatus: 'ACTIVE' | 'PAUSED'): Promise<void> {
    const campaign = await getAdCampaignByPhone(id, phone)
    if (!campaign || !campaign.campaignId || campaign.campaignId.startsWith('DEV_')) return
    if (config.dev.enabled) return
    const { getAccountByPlatform } = await import('../store.js')
    const account = await getAccountByPlatform(phone, 'meta_ads')
    if (!account?.accessToken) return
    const { setMetaCampaignStatus } = await import('../lib/metaAds.js')
    const metaId = campaign.campaignId || campaign.adSetId
    if (!metaId) return
    try {
      await setMetaCampaignStatus(account.accessToken, metaId, metaStatus)
    } catch (err) {
      logger.warn({ adId: id, error: (err as Error).message }, 'meta status sync failed (db updated)')
    }
  }

  // Cancel ad (ownership-scoped; works for scheduled/creating/paused/active)
  server.post('/api/ads/scheduled/:id/cancel', async (req: any, reply: any) => {
    const session = await authAndOwn(req, reply)
    if (!session) return
    const { id } = req.params as { id: string }
    const cancelled = await cancelAdCampaign(id, session.phone)
    if (!cancelled) return reply.status(404).send({ error: 'Ad not found or cannot be cancelled in its current state' })
    await syncMetaStatus(id, session.phone, 'PAUSED')
    return reply.send({ success: true })
  })
}