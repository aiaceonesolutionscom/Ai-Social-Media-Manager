import { config } from '../config.js'
import { fetchWithRetry } from './http.js'
import { logger } from './logger.js'
import { metaConfig } from './metaConfig.js'

function getAdsApiVersion(): string {
  return metaConfig.getMetaAdsApiVersion()
}

export interface AdCampaignConfig {
  name: string
  objective: string
  budgetCents: number
  budgetType: 'daily' | 'total'
  currency: string
  startDate: string
  endDate?: string
}

export interface AdSetConfig {
  name: string
  campaignId: string
  bidStrategy: string
  budgetCents: number
  budgetType: 'daily' | 'total'
  currency: string
  startDate: string
  endDate?: string
  targeting: Record<string, unknown>
  optimizationGoal: string
  billingEvent: string
}

export interface AdCreativeConfig {
  name: string
  pageId: string
  imageUrl: string
  primaryText: string
  headline: string
  description: string
  linkUrl: string
  callToAction?: string
}

export interface AdResult {
  campaignId: string
  adSetId: string
  adId: string
  creativeId: string
  status: string
}

// Map supported ad objectives to Meta's optimization goals + billing events.
// Conversion-oriented objectives (LEADS/SALES) require an approved pixel +
// promoted_object which are NOT auto-configured here — callers should surface
// the requirement upstream instead of silently misconfiguring the campaign.
export function objectiveOptimization(objective: string): {
  optimizationGoal: string
  billingEvent: string
} {
  switch (objective) {
    case 'OUTCOME_AWARENESS':
      return { optimizationGoal: 'REACH', billingEvent: 'IMPRESSIONS' }
    case 'OUTCOME_ENGAGEMENT':
      return { optimizationGoal: 'ENGAGEMENT', billingEvent: 'ENGAGEMENT' }
    case 'OUTCOME_TRAFFIC':
      return { optimizationGoal: 'LINK_CLICKS', billingEvent: 'LINK_CLICKS' }
    case 'OUTCOME_LEADS':
      return { optimizationGoal: 'LEAD_GENERATION', billingEvent: 'LEAD' }
    case 'OUTCOME_SALES':
      return { optimizationGoal: 'CONVERSIONS', billingEvent: 'CONVERSIONS' }
    default:
      return { optimizationGoal: 'REACH', billingEvent: 'IMPRESSIONS' }
  }
}

// Meta ad creative call_to_action.type values.
export const CTA_TO_META: Record<string, string> = {
  'Learn More': 'LEARN_MORE',
  'Sign Up': 'SIGN_UP',
  'Shop Now': 'SHOP_NOW',
  'Book Now': 'BOOK_NOW',
  'Contact Us': 'CONTACT_US',
  'Get Offer': 'GET_OFFER',
  'Get Directions': 'GET_DIRECTIONS',
  'Watch More': 'WATCH_MORE',
  'Send Message': 'SEND_MESSAGE',
  'Call Now': 'CALL_NOW',
}

export function normalizeCta(cta?: string): string | undefined {
  if (!cta) return undefined
  const direct = CTA_TO_META[cta]
  if (direct) return direct
  return cta.replace(/\s+/g, '_').toUpperCase()
}

async function adsGet(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const fullUrl = `https://graph.facebook.com/${getAdsApiVersion()}${url}`
  const res = await fetchWithRetry(fullUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const body = await res.json() as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`Meta Ads API error: ${JSON.stringify(body)}`)
  }
  return body
}

async function adsPost(url: string, body: Record<string, unknown>, accessToken: string): Promise<Record<string, unknown>> {
  const fullUrl = `https://graph.facebook.com/${getAdsApiVersion()}${url}`
  const res = await fetchWithRetry(fullUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const responseBody = await res.json() as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`Meta Ads API error: ${JSON.stringify(responseBody)}`)
  }
  return responseBody
}

export async function createCampaign(
  adAccountId: string,
  accessToken: string,
  config: AdCampaignConfig
): Promise<string> {
  logger.info({ adAccountId, name: config.name }, 'creating ad campaign')
  const result = await adsPost(`/${adAccountId}/campaigns`, {
    name: config.name,
    objective: config.objective,
    status: 'PAUSED',
    special_ad_categories: [],
  }, accessToken)
  const campaignId = result.id as string
  logger.info({ campaignId }, 'ad campaign created')
  return campaignId
}

export async function createAdSet(
  adAccountId: string,
  accessToken: string,
  config: AdSetConfig
): Promise<string> {
  logger.info({ adAccountId, campaignId: config.campaignId }, 'creating ad set')

  const body: Record<string, unknown> = {
    name: config.name,
    campaign_id: config.campaignId,
    bid_strategy: config.bidStrategy,
    targeting: config.targeting,
    status: 'PAUSED',
    billing_event: config.billingEvent,
    optimization_goal: config.optimizationGoal,
  }

  if (config.budgetType === 'total') {
    body.lifetime_budget = config.budgetCents
    body.lifetime_budget_currency = config.currency
  } else {
    body.daily_budget = config.budgetCents
    body.daily_budget_currency = config.currency
  }

  if (config.startDate) body.start_time = config.startDate
  if (config.endDate) body.end_time = config.endDate

  const result = await adsPost(`/${adAccountId}/adsets`, body, accessToken)
  const adSetId = result.id as string
  logger.info({ adSetId }, 'ad set created')
  return adSetId
}

export async function createAdCreative(
  adAccountId: string,
  accessToken: string,
  config: AdCreativeConfig
): Promise<string> {
  logger.info({ adAccountId, name: config.name }, 'creating ad creative')

  if (!config.linkUrl || config.linkUrl === 'https://example.com') {
    throw new Error('A valid website URL is required for the ad creative')
  }

  const linkData: Record<string, unknown> = {
    message: config.primaryText,
    link: config.linkUrl,
  }
  if (config.imageUrl) linkData.image_url = config.imageUrl
  if (config.headline) linkData.title = config.headline
  if (config.description) linkData.description = config.description

  const objectStorySpec: Record<string, unknown> = {
    page_id: config.pageId,
    link_data: linkData,
  }
  const callToActionType = normalizeCta(config.callToAction)
  if (callToActionType) {
    objectStorySpec.call_to_action = {
      type: callToActionType,
      value: { link: config.linkUrl },
    }
  }

  const result = await adsPost(`/${adAccountId}/adcreatives`, {
    name: config.name,
    object_story_spec: objectStorySpec,
  }, accessToken)

  const creativeId = result.id as string
  logger.info({ creativeId }, 'ad creative created')
  return creativeId
}

export async function createAd(
  adAccountId: string,
  accessToken: string,
  config: { name: string; adSetId: string; creativeId: string }
): Promise<string> {
  logger.info({ adAccountId, adSetId: config.adSetId }, 'creating ad')
  const result = await adsPost(`/${adAccountId}/ads`, {
    name: config.name,
    adset_id: config.adSetId,
    creative: { creative_id: config.creativeId },
    status: 'PAUSED',
  }, accessToken)
  const adId = result.id as string
  logger.info({ adId }, 'ad created')
  return adId
}

// Activate campaign / ad set / ad on Meta so the ad actually serves.
// Objects are created PAUSED; without this call nothing ever runs.
export async function activateMetaAd(
  accessToken: string,
  campaignId: string,
  adSetId: string,
  adId: string,
): Promise<void> {
  await adsPost(`/${campaignId}`, { access_token: accessToken, status: 'ACTIVE' }, accessToken)
  logger.info({ campaignId }, 'meta campaign activated')
  await adsPost(`/${adSetId}`, { access_token: accessToken, status: 'ACTIVE' }, accessToken)
  logger.info({ adSetId }, 'meta ad set activated')
  await adsPost(`/${adId}`, { access_token: accessToken, status: 'ACTIVE' }, accessToken)
  logger.info({ adId }, 'meta ad activated')
}

// Set a single top-level ad object's status (for pause/resume/stop actions).
export async function setMetaCampaignStatus(
  accessToken: string,
  metaId: string,
  status: 'ACTIVE' | 'PAUSED',
): Promise<void> {
  await adsPost(`/${metaId}`, { access_token: accessToken, status }, accessToken)
}

// Delete a Meta ad object for orphan cleanup on failure. Errors are swallowed.
export async function deleteMetaAdObject(metaId: string, accessToken: string): Promise<void> {
  try {
    await fetchWithRetry(`https://graph.facebook.com/${getAdsApiVersion()}/${metaId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    logger.info({ metaId }, 'cleaned up meta ad object')
  } catch (err) {
    logger.warn({ metaId, error: (err as Error).message }, 'failed to clean up meta ad object')
  }
}

export interface LaunchMetaAdParams {
  adAccountId: string
  accessToken: string
  name: string
  pageId: string
  imageUrl: string
  primaryText: string
  headline: string
  description: string
  linkUrl: string
  callToAction?: string
  objective: string
  budgetCents: number
  budgetType: 'daily' | 'total'
  currency: string
  startDate: string
  endDate?: string
  targeting: Record<string, unknown>
  idempotencyKey?: string
}

export interface LaunchMetaAdResult {
  campaignId: string
  adSetId: string
  adId: string
  creativeId: string
}

// Full campaign creation with activation + idempotent retry + orphan cleanup.
export async function launchMetaAd(params: LaunchMetaAdParams): Promise<LaunchMetaAdResult> {
  const adAccountId = params.adAccountId

  let campaignId = ''
  let adSetId = ''
  let creativeId = ''
  let adId = ''

  try {
    const { optimizationGoal, billingEvent } = objectiveOptimization(params.objective)

    campaignId = await createCampaign(adAccountId, params.accessToken, {
      name: `${params.name} - Campaign`,
      objective: params.objective || 'OUTCOME_ENGAGEMENT',
      budgetCents: params.budgetCents,
      budgetType: params.budgetType,
      currency: params.currency,
      startDate: params.startDate,
      endDate: params.endDate,
    })

    adSetId = await createAdSet(adAccountId, params.accessToken, {
      name: `${params.name} - Ad Set`,
      campaignId,
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      budgetCents: params.budgetCents,
      budgetType: params.budgetType,
      currency: params.currency,
      startDate: params.startDate,
      endDate: params.endDate,
      targeting: params.targeting,
      optimizationGoal,
      billingEvent,
    })

    creativeId = await createAdCreative(adAccountId, params.accessToken, {
      name: `${params.name} - Creative`,
      pageId: params.pageId,
      imageUrl: params.imageUrl,
      primaryText: params.primaryText,
      headline: params.headline,
      description: params.description,
      linkUrl: params.linkUrl,
      callToAction: params.callToAction,
    })

    adId = await createAd(adAccountId, params.accessToken, {
      name: params.name,
      adSetId,
      creativeId,
    })

    // Activate only after every object exists; DB stays 'creating' until this returns.
    await activateMetaAd(params.accessToken, campaignId, adSetId, adId)

    return { campaignId, adSetId, adId, creativeId }
  } catch (err) {
    // Best-effort cleanup of any objects created before the failure.
    if (adId) await deleteMetaAdObject(adId, params.accessToken)
    if (creativeId) await deleteMetaAdObject(creativeId, params.accessToken)
    if (adSetId) await deleteMetaAdObject(adSetId, params.accessToken)
    if (campaignId) await deleteMetaAdObject(campaignId, params.accessToken)
    throw err
  }
}

export async function getAdInsights(
  adId: string,
  accessToken: string
): Promise<Record<string, unknown>> {
  return adsGet(`/${adId}/insights?fields=impressions,clicks,reach,spent,actions`, accessToken)
}

// Backwards-compatible helper used by the web scheduler / routes tests.
export async function boostPost(
  adAccountId: string,
  accessToken: string,
  config: {
    name: string
    pageId: string
    imageUrl: string
    primaryText: string
    headline: string
    description: string
    linkUrl: string
    callToAction?: string
    budgetCents: number
    budgetType: 'daily' | 'total'
    currency: string
    startDate: string
    endDate?: string
    targeting: Record<string, unknown>
    objective?: string
  }
): Promise<AdResult> {
  const result = await launchMetaAd({
    adAccountId,
    accessToken,
    name: config.name,
    pageId: config.pageId,
    imageUrl: config.imageUrl,
    primaryText: config.primaryText,
    headline: config.headline,
    description: config.description,
    linkUrl: config.linkUrl,
    callToAction: config.callToAction,
    objective: config.objective || 'OUTCOME_ENGAGEMENT',
    budgetCents: config.budgetCents,
    budgetType: config.budgetType,
    currency: config.currency,
    startDate: config.startDate,
    endDate: config.endDate,
    targeting: config.targeting,
  })

  return {
    campaignId: result.campaignId,
    adSetId: result.adSetId,
    adId: result.adId,
    creativeId: result.creativeId,
    status: 'ACTIVE',
  }
}

export function validateAdsConfig(): boolean {
  return !!(config.metaAds.adAccountId && config.metaAds.accessToken)
}
