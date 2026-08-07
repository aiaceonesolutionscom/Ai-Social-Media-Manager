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
  startDate: string
  endDate?: string
}

export interface AdSetConfig {
  name: string
  campaignId: string
  bidStrategy: string
  budgetCents: number
  targeting: Record<string, unknown>
}

export interface AdResult {
  campaignId: string
  adSetId: string
  adId: string
  status: string
}

async function adsGet(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const fullUrl = `https://graph.facebook.com/${getAdsApiVersion()}${url}`

  const res = await fetchWithRetry(fullUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
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
      'Authorization': `Bearer ${accessToken}`,
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

  const result = await adsPost(`/${adAccountId}/adsets`, {
    name: config.name,
    campaign_id: config.campaignId,
    bid_strategy: config.bidStrategy,
    daily_budget: config.budgetCents,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'REACH',
    targeting: config.targeting,
    status: 'PAUSED',
  }, accessToken)

  const adSetId = result.id as string
  logger.info({ adSetId }, 'ad set created')
  return adSetId
}

export async function createAdCreative(
  adAccountId: string,
  accessToken: string,
  config: {
    name: string
    pageId: string
    imageUrl: string
    caption: string
    linkUrl?: string
  }
): Promise<string> {
  logger.info({ adAccountId, name: config.name }, 'creating ad creative')

  const objectStorySpec = {
    page_id: config.pageId,
    link_data: {
      image_url: config.imageUrl,
      message: config.caption,
      link: config.linkUrl || 'https://example.com',
    },
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
  config: {
    name: string
    adSetId: string
    creativeId: string
  }
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

export async function getAdInsights(
  adId: string,
  accessToken: string
): Promise<Record<string, unknown>> {
  const result = await adsGet(`/${adId}/insights?fields=impressions,clicks,reach,spent,actions`, accessToken)
  return result
}

export async function boostPost(
  adAccountId: string,
  accessToken: string,
  config: {
    name: string
    pageId: string
    imageUrl: string
    caption: string
    budgetCents: number
    targeting: Record<string, unknown>
  }
): Promise<AdResult> {
  const campaignId = await createCampaign(adAccountId, accessToken, {
    name: `${config.name} - Campaign`,
    objective: 'OUTCOME_ENGAGEMENT',
    budgetCents: config.budgetCents,
    startDate: new Date().toISOString().split('T')[0],
  })

  const adSetId = await createAdSet(adAccountId, accessToken, {
    name: `${config.name} - Ad Set`,
    campaignId,
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    budgetCents: config.budgetCents,
    targeting: config.targeting,
  })

  const creativeId = await createAdCreative(adAccountId, accessToken, {
    name: `${config.name} - Creative`,
    pageId: config.pageId,
    imageUrl: config.imageUrl,
    caption: config.caption,
  })

  const adId = await createAd(adAccountId, accessToken, {
    name: config.name,
    adSetId,
    creativeId,
  })

  return {
    campaignId,
    adSetId,
    adId,
    status: 'PAUSED',
  }
}

export function validateAdsConfig(): boolean {
  return !!(config.metaAds.adAccountId && config.metaAds.accessToken)
}

