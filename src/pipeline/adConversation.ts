import { logger } from '../lib/logger.js'
import { sendImage, sendReplyButtons, sendText, localFileUrl } from '../lib/whatsapp.js'
import { detectLanguage } from '../lib/language.js'
import { generateImage } from '../lib/image.js'
import { saveImageBuffer } from '../storage.js'
import { generateAdContent, generateAdTargeting, suggestAdObjective } from './adGenerate.js'
import { isValidImageUrl } from '../lib/urlAnalyzer.js'
import {
  createAdCampaign,
  updateAdCampaign,
  getAdCampaign,
  claimAdCampaignForLaunch,
  recoverStuckAdCampaigns,
  getUser,
  getPackage,
  setConversation,
  resolveUserPhone,
  getAccountByPlatform,
} from '../store.js'
import { launchMetaAd, setMetaCampaignStatus } from '../lib/metaAds.js'
import { buildMetaTargeting } from '../lib/adTargeting.js'
import { getTokenCost } from '../lib/tokens.js'
import { config } from '../config.js'
import { refundTokens } from '../lib/tokens.js'
import type { AdConversationData, ConversationState, Intent } from '../types.js'

export interface AdValidationError extends Error {
  code: 'NO_ACCOUNT' | 'NO_WEBSITE' | 'NO_PAGE' | 'NO_IMAGE' | 'INVALID_BUDGET' | 'INVALID_DATES'
}

export function createAdError(code: AdValidationError['code'], message: string): AdValidationError {
  const err = new Error(message) as AdValidationError
  err.code = code
  return err
}

async function getPackageInfo(phone: string) {
  const userPhone = await resolveUserPhone(phone)
  const user = await getUser(userPhone)
  const pkg = user?.packageId ? await getPackage(user.packageId) : null
  const features = (pkg?.features || {}) as Record<string, boolean>
  return { hasAdCampaigns: features.ad_campaigns === true, userPhone }
}

const MIN_DAILY_BUDGET_CENTS = 100 // $1/day minimum
const MIN_LIFETIME_BUDGET_CENTS = 100

export function validateBudget(adData: AdConversationData): { budgetCents: number; budgetType: 'daily' | 'total'; currency: string; error?: string } {
  const budget = adData.budget || 0
  const budgetType = adData.budgetType || 'daily'
  const currency = (adData.currency || 'USD').toUpperCase()
  const budgetCents = Math.round(budget * 100)

  if (!budget || budgetCents <= 0) {
    return { budgetCents, budgetType, currency, error: 'Budget must be greater than 0.' }
  }
  const min = budgetType === 'total' ? MIN_LIFETIME_BUDGET_CENTS : MIN_DAILY_BUDGET_CENTS
  if (budgetCents < min) {
    return { budgetCents, budgetType, currency, error: `Budget is below Meta's minimum (${min / 100} ${currency}/day).` }
  }
  return { budgetCents, budgetType, currency }
}

export function validateScheduleDates(adData: AdConversationData): { startDate: string; endDate?: string; error?: string } {
  const startDate = adData.startDate ? new Date(adData.startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
  let endDate: string | undefined
  if (adData.endDate) {
    const end = new Date(adData.endDate)
    const start = new Date(startDate)
    if (Number.isNaN(end.getTime())) return { startDate, error: 'Invalid end date.' }
    if (end <= start) return { startDate, error: 'End date must be after the start date.' }
    endDate = end.toISOString().split('T')[0]
  }
  return { startDate, endDate }
}

function moneyLabel(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount)
}

// Generate ad preview using structured AdConversationData.
// Called from conversation.ts when all required ad fields are collected.
export async function generateAndPreviewAd(
  phone: string,
  adData: AdConversationData,
  convState: any,
): Promise<void> {
  const pi = await getPackageInfo(phone)
  if (!pi.hasAdCampaigns) {
    await sendText(phone, '❌ Meta Ads is not included in your current plan. Please upgrade your package to use this feature.')
    return
  }

  // Validate budget / dates up front — never silently convert to a default.
  const budgetCheck = validateBudget(adData)
  if (budgetCheck.error) {
    await sendText(phone, `❌ ${budgetCheck.error}`)
    return
  }
  const dateCheck = validateScheduleDates(adData)
  if (dateCheck.error) {
    await sendText(phone, `❌ ${dateCheck.error}`)
    return
  }
  // A website URL is mandatory — without it Meta rejects the creative.
  if (!adData.websiteUrl) {
    await setConversation(phone, { kind: 'ad_gathering', postId: adData.existingPostId || '', step: 'website', data: {}, adData } as any)
    await askMissingAdField(phone, adData, 'website')
    return
  }

  const postId = adData.existingPostId || convState.postId || ''
  await setConversation(phone, { kind: 'generating', postId } as ConversationState)

  const lang = detectLanguage(adData.product || '')
  const generatingMsg = lang === 'ur' ? '🎨 Aapka ad bana raha hoon...' : lang === 'hi' ? '🎨 Aapka ad bana raha hoon...' : '🎨 Generating your ad content...'
  await sendText(phone, generatingMsg)

  try {
    const topic = adData.product || 'social media post'
    const intent: Intent = {
      topic,
      audience: adData.audience || 'general audience',
      tone: 'professional',
      goal: 'promote business',
      language: detectLanguage(topic),
      emotion: 'trustworthy',
    }

    // Generate ad content and targeting in parallel
    const [generatedContent, targeting, objective] = await Promise.all([
      generateAdContent(topic, intent),
      generateAdTargeting(topic, intent.audience, adData.location),
      suggestAdObjective(topic, intent.goal),
    ])
    // P2-18 — the user's website is the source of truth for the landing URL.
    // The LLM writer cannot know the business URL, so it must be injected here;
    // without this the campaign was rejected at launch ("website URL is required").
    const adContent = { ...generatedContent, linkUrl: adData.websiteUrl || generatedContent.linkUrl }

    // Generate image (or use existing post image)
    let imageUrl = ''
    if (adData.existingPostId) {
      const { getPost } = await import('../store.js')
      const existingPost = await getPost(adData.existingPostId)
      if (existingPost?.imageUrl) {
        imageUrl = existingPost.imageUrl
      }
    }
    if (!imageUrl) {
      const imagePrompt = `Professional social media ad image for ${topic}. Clean, modern design with vibrant colors. No text in the image.`
      const imageBuffer = await generateImage(imagePrompt, phone)
      const relPath = saveImageBuffer(imageBuffer, `ad_${Date.now()}`)
      imageUrl = localFileUrl(relPath)
    }

    // Reuse an existing preview campaign row if present (avoid orphan pending rows).
    const existing = convState.kind === 'ad_preview' && convState.postId
      ? await getAdCampaign(convState.postId)
      : undefined
    let campaign: any
    if (existing) {
      await updateAdCampaign(existing.id, {
        objective: objective || existing.objective,
        adContent,
        targeting,
        budgetCents: budgetCheck.budgetCents,
        budgetType: budgetCheck.budgetType as 'daily' | 'total',
        currency: budgetCheck.currency,
        startDate: dateCheck.startDate,
        endDate: dateCheck.endDate,
        imageUrl,
      })
      campaign = await getAdCampaign(existing.id)
    } else {
      campaign = await createAdCampaign({
        phone,
        name: `${topic} - Ad Campaign`,
        objective: objective || 'OUTCOME_ENGAGEMENT',
        adContent,
        targeting,
        budgetCents: budgetCheck.budgetCents,
        budgetType: budgetCheck.budgetType as 'daily' | 'total',
        currency: budgetCheck.currency,
        startDate: dateCheck.startDate,
        endDate: dateCheck.endDate,
        imageUrl,
        postId: adData.existingPostId,
      })
    }

    await sendPreview(phone, campaign, adContent, targeting, budgetCheck, dateCheck, objective)
    await setConversation(phone, {
      kind: 'ad_preview',
      postId: campaign.id,
      adData: { ...adData, websiteUrl: adContent.linkUrl || adData.websiteUrl },
    } as any)
  } catch (err) {
    logger.error({ phone, error: (err as Error).message }, 'ad generation failed')
    await sendText(phone, `❌ Failed to generate ad: ${(err as Error).message}`)
    await setConversation(phone, { kind: 'idle' })
  }
}

async function askMissingAdField(phone: string, adData: AdConversationData, missing: string): Promise<void> {
  const questions: Record<string, string> = {
    website: 'What is your website URL? (e.g. https://mybusiness.com)',
    product: 'Sure! What product or service would you like to advertise?',
    budget: 'Great — what daily budget would you like to use? (e.g. $5/day or $50 total)',
  }
  await sendText(phone, questions[missing] || `What ${missing} would you like to use?`)
}

async function sendPreview(
  phone: string,
  campaign: any,
  adContent: { headline: string; primaryText: string; description: string; callToAction: string; linkUrl?: string },
  targeting: { ageMin: number; ageMax: number; genders: string[]; locations: string[]; interests: string[] },
  budgetCheck: { budgetCents: number; budgetType: 'daily' | 'total'; currency: string },
  dateCheck: { startDate: string; endDate?: string },
  objective: string,
): Promise<void> {
  const budgetLabel = budgetCheck.budgetType === 'total'
    ? `${moneyLabel(budgetCheck.budgetCents / 100, budgetCheck.currency)} total`
    : `${moneyLabel(budgetCheck.budgetCents / 100, budgetCheck.currency)}/day`
  const lang = detectLanguage(adContent.primaryText || '')

  await sendImage(phone, campaign.imageUrl || '', `**${adContent.headline}**\n\n${adContent.primaryText}\n\n${adContent.description}\n\nCTA: ${adContent.callToAction}`)

  const targetingSummary = `🎯 **Targeting:**\n• Age: ${targeting.ageMin}-${targeting.ageMax}\n• Locations: ${targeting.locations.join(', ')}\n• Interests: ${targeting.interests.join(', ')}`
  await sendText(phone, targetingSummary)
  await sendText(phone, `💰 **Budget:** ${budgetLabel} (${budgetCheck.budgetType === 'total' ? 'lifetime' : 'daily'})\n📋 **Objective:** ${objective.replace('OUTCOME_', '')}\n🌐 **Website:** ${adContent.linkUrl || 'not set'}`)
  await sendText(phone, `📅 **Runs:** ${dateCheck.startDate}${dateCheck.endDate ? ` → ${dateCheck.endDate}` : ''}`)

  const approveMsg = lang === 'ur' || lang === 'hi' ? 'Kya aap yeh ad launch karna chahenge?' : 'Would you like to launch this ad campaign?'
  await sendText(phone, approveMsg)
  await sendReplyButtons(phone, 'Action:', [
    { id: 'ad_approve', title: '✅ Approve' },
    { id: 'ad_edit', title: '✏️ Edit' },
    { id: 'ad_schedule', title: '📅 Schedule' },
    { id: 'ad_cancel', title: '❌ Cancel' },
  ])
}

// Launch ad campaign on Meta. Called from conversation.ts when user approves.
export async function launchAdCampaign(campaignId: string): Promise<void> {
  // P2-21 — self-heal: any campaign stuck 'creating' from a crashed launch is
  // reset to 'pending' so it can be launched (or retried) instead of being
  // permanently wedged. Freshly-claimed rows are untouched.
  try {
    await recoverStuckAdCampaigns()
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'recoverStuckAdCampaigns failed during launch')
  }
  // P1-20 — claim the campaign atomically FIRST. The conditional update ensures
  // only one of any concurrent launch attempts wins; the rest see 'creating'
  // and return without creating a duplicate campaign on Meta.
  const claimed = await claimAdCampaignForLaunch(campaignId)
  const campaign = await getAdCampaign(campaignId)
  if (!campaign) {
    throw new Error('Campaign not found')
  }
  if (!claimed) {
    // Already being launched ('creating') or already in a terminal state.
    return
  }

  const phone = campaign.phone

  // Idempotency: never double-charge tokens for the same campaign.
  const userPhone = await resolveUserPhone(phone)
  const user = await getUser(userPhone)

  // In dev / no-real-account mode: mock but never charge tokens.
  const devMode = config.dev.enabled === true
  const userAdAccount = await getAccountByPlatform(userPhone, 'meta_ads')
  const userFbPage = await getAccountByPlatform(userPhone, 'facebook')
  const metaAdsToken = userAdAccount?.accessToken
  const adAccountId = userAdAccount?.accountId

  if (!adAccountId || !metaAdsToken) {
    if (devMode) {
      await updateAdCampaign(campaign.id, { status: 'active', campaignId: `DEV_camp_${Date.now()}`, adSetId: `DEV_adset_${Date.now()}`, adId: `DEV_ad_${Date.now()}`, creativeId: `DEV_creative_${Date.now()}` })
      await sendText(phone, `⚠️ **DEV MODE / MOCK (not a real Meta campaign)**\n\nSimulated campaign created. No real ad spend and no tokens charged. Connect a Meta Ads account to run real campaigns.`)
      await setConversation(phone, { kind: 'idle' })
      return
    }
    await updateAdCampaign(campaign.id, { status: 'failed' })
    await sendText(phone, '❌ No Meta Ads account is connected. Connect one in your dashboard to launch a paid campaign.')
    await setConversation(phone, { kind: 'idle' })
    return
  }

  // Real Meta path: charge tokens first (once), then call Meta.
  if (user) {
    const adCost = await getTokenCost('ad_campaign')
    const { tokenEngine } = await import('../lib/TokenEngine.js')
    const charge = await tokenEngine.chargeAdOnce(campaign.id, userPhone, adCost, 'Ad campaign creation')
    if (!charge.success && !charge.alreadyCharged) {
      await sendText(phone, `❌ Insufficient tokens for ad campaign. Each campaign costs ${adCost} tokens.`)
      await updateAdCampaign(campaign.id, { status: 'failed' })
      return
    }
  }

  // Validate creative requirements before touching Meta.
  if (!campaign.imageUrl) {
    await updateAdCampaign(campaign.id, { status: 'failed' })
    await sendText(phone, '❌ Failed to create ad campaign: ad image is missing.')
    await setConversation(phone, { kind: 'idle' })
    return
  }
  if (!isValidImageUrl(campaign.imageUrl) && !campaign.imageUrl.startsWith('https://')) {
    await updateAdCampaign(campaign.id, { status: 'failed' })
    await sendText(phone, '❌ Failed to create ad campaign: the ad image URL is not publicly accessible for Meta.')
    await setConversation(phone, { kind: 'idle' })
    return
  }
  // P2-18 — the landing URL comes from the ad content; the confusing ternary
  // `linkUrl || callToAction ? linkUrl : undefined` collapsed to just linkUrl
  // and could drop the URL when callToAction was set but linkUrl empty.
  const linkUrl = campaign.adContent.linkUrl || undefined
  if (!linkUrl) {
    await updateAdCampaign(campaign.id, { status: 'failed' })
    await sendText(phone, '❌ Failed to create ad campaign: a website URL is required. Please provide a website in the ad details.')
    await setConversation(phone, { kind: 'idle' })
    return
  }
  const pageId = userFbPage?.accountId || config.facebook.pageId || ''
  if (!pageId) {
    await updateAdCampaign(campaign.id, { status: 'failed' })
    await sendText(phone, '❌ Failed to create ad campaign: a connected Facebook Page is required. Connect one in your dashboard.')
    await setConversation(phone, { kind: 'idle' })
    return
  }

  await sendText(phone, '⏳ Creating your ad campaign on Meta...')

  try {
    const t = campaign.targeting
    const metaTargeting = buildMetaTargeting({
      ageMin: t.ageMin,
      ageMax: t.ageMax,
      genders: t.genders,
      locations: t.locations,
      interests: t.interests,
    })

    const startDate = campaign.startDate || new Date().toISOString().split('T')[0]
    const result = await launchMetaAd({
      adAccountId,
      accessToken: metaAdsToken,
      name: campaign.name,
      pageId,
      imageUrl: campaign.imageUrl,
      primaryText: campaign.adContent.primaryText,
      headline: campaign.adContent.headline,
      description: campaign.adContent.description,
      linkUrl: linkUrl,
      callToAction: campaign.adContent.callToAction,
      objective: campaign.objective,
      budgetCents: campaign.budgetCents,
      budgetType: campaign.budgetType,
      currency: campaign.currency,
      startDate,
      endDate: campaign.endDate,
      targeting: metaTargeting,
      pixelId: config.metaAds.pixelId || undefined,
    })

    // Meta confirmed creation + activation → only now mark DB active.
    await updateAdCampaign(campaign.id, {
      status: 'active',
      campaignId: result.campaignId,
      adSetId: result.adSetId,
      adId: result.adId,
      creativeId: result.creativeId,
    })

    await sendText(phone, `✅ Your ad is now **ACTIVE** on Meta and will serve immediately (subject to review).\n\nCampaign ID: ${result.campaignId}\nAd Set ID: ${result.adSetId}\nAd ID: ${result.adId}\nStatus: ACTIVE\n\nTrack it in Meta Ads Manager.`)
    await setConversation(phone, { kind: 'idle' })
  } catch (err) {
    logger.error({ phone, error: (err as Error).message }, 'Meta Ads creation failed')
    await updateAdCampaign(campaign.id, { status: 'failed' })
    await sendText(phone, `❌ Failed to create ad campaign: ${(err as Error).message}\n\nYour tokens have been refunded.`)
    if (user) {
      const adCost = await getTokenCost('ad_campaign')
      try {
        await refundTokens(userPhone, adCost, campaign.id, 'Ad campaign failed - refund', `refund:campaign:${campaign.id}`)
      } catch (refundErr) {
        logger.error({ phone, error: (refundErr as Error).message }, 'token refund failed')
      }
    }
    await setConversation(phone, { kind: 'idle' })
  }
}

// Apply a real status change (pause/resume/stop) on Meta for a live campaign.
export async function applyAdCampaignAction(
  campaignId: string,
  action: 'pause' | 'resume' | 'stop',
): Promise<void> {
  const campaign = await getAdCampaign(campaignId)
  if (!campaign) throw new Error('Campaign not found')
  if (!campaign.campaignId || campaign.campaignId.startsWith('DEV_')) return
  const devMode = config.dev.enabled === true
  if (devMode) {
    const next: Record<'pause' | 'resume' | 'stop', 'active' | 'paused' | 'stopped'> = { pause: 'paused', resume: 'active', stop: 'stopped' }
    await updateAdCampaign(
      campaign.id,
      { status: next[action] },
      { phone: campaign.phone },
    )
    return
  }
  const userAdAccount = await getAccountByPlatform(await resolveUserPhone(campaign.phone), 'meta_ads')
  const token = userAdAccount?.accessToken
  if (!token) throw new Error('Meta Ads account not connected')
  const metaStatus: Record<'pause' | 'resume', 'PAUSED' | 'ACTIVE'> = { pause: 'PAUSED', resume: 'ACTIVE' }
  const dbStatus: Record<'pause' | 'resume' | 'stop', 'paused' | 'active' | 'stopped'> = { pause: 'paused', resume: 'active', stop: 'stopped' }
  if (action === 'resume' || action === 'pause') {
    await setMetaCampaignStatus(token, campaign.campaignId || campaign.adSetId!, metaStatus[action])
  }
  // 'stop' is irreversible on Meta (delete); keep DB 'stopped' and leave Meta as-is
  // (delivery stops when budget is exhausted / campaign paused). We pause Meta so it
  // stops spending, which is the safe irreversible action.
  if (action === 'stop') {
    await setMetaCampaignStatus(token, campaign.campaignId || campaign.adSetId!, 'PAUSED')
  }
  await updateAdCampaign(campaign.id, { status: dbStatus[action] }, { phone: campaign.phone })
}
