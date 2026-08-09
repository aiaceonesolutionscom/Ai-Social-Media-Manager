import { logger } from '../lib/logger.js'
import { sendImage, sendReplyButtons, sendText } from '../lib/whatsapp.js'
import { generateImage } from '../lib/image.js'
import { saveImageBuffer } from '../storage.js'
import { localFileUrl } from '../lib/whatsapp.js'
import { generateAdContent, generateAdTargeting, suggestAdObjective } from './adGenerate.js'
import { createAdCampaign, updateAdCampaign, getAdCampaign, getUser, getPackage, setConversation, getConversation, resolveUserPhone, getAccountByPlatform } from '../store.js'
import { createCampaign, createAdSet, createAdCreative, createAd, boostPost } from '../lib/metaAds.js'
import { deductTokens } from '../lib/tokens.js'
import { parseScheduleTime } from './publish.js'
import type { AdCampaign, AdContent, AdTargeting, ConversationState, Intent } from '../types.js'

interface AdConversationState {
  kind: 'ad_idle' | 'ad_gathering' | 'ad_generating' | 'ad_preview' | 'ad_creating'
  campaignId?: string
  step?: string
  data?: {
    topic?: string
    intent?: Intent
    budget?: number
    websiteUrl?: string
  }
}

const AD_GATHERING_QUESTIONS: Record<string, string> = {
  topic: "What would you like to advertise? (e.g., your clinic, a product, a service)",
  website: "Do you have a website URL? (Type 'skip' if none)",
  budget: "What's your daily budget in dollars? (e.g., 10, 25, 50)",
}

export async function handleAdConversation(
  phone: string,
  content: string,
  convState: AdConversationState,
): Promise<void> {
  const pi = await getPackageInfo(phone)

  if (!pi.hasAdCampaigns) {
    await sendText(phone, '❌ Meta Ads is not included in your current plan. Please upgrade your package to use this feature.\n\nYou can check available packages by saying "show packages" or visit your dashboard.')
    return
  }

  if (convState.kind === 'ad_gathering') {
    await handleAdGathering(phone, content, convState)
    return
  }

  if (convState.kind === 'ad_preview') {
    await handleAdPreview(phone, content, convState)
    return
  }

  if (convState.kind === 'ad_creating') {
    await sendText(phone, '⏳ Your ad campaign is being created. Please wait...')
    return
  }
}

async function getPackageInfo(phone: string) {
  const userPhone = await resolveUserPhone(phone)
  const user = await getUser(userPhone)
  const pkg = user?.packageId ? await getPackage(user.packageId) : null
  const features = (pkg?.features || {}) as Record<string, boolean>
  return { hasAdCampaigns: features.ad_campaigns === true }
}

async function handleAdGathering(phone: string, content: string, convState: AdConversationState): Promise<void> {
  const data = convState.data || {}
  const step = convState.step || 'topic'

  if (step === 'topic') {
    data.topic = content
    await setConversation(phone, { kind: 'ad_gathering', postId: convState.campaignId || crypto.randomUUID(), step: 'website', data } as ConversationState)
    await sendText(phone, AD_GATHERING_QUESTIONS.website)
    return
  }

  if (step === 'website') {
    data.websiteUrl = content.toLowerCase() === 'skip' ? undefined : content
    await setConversation(phone, { kind: 'ad_gathering', postId: convState.campaignId || crypto.randomUUID(), step: 'budget', data } as ConversationState)
    await sendText(phone, AD_GATHERING_QUESTIONS.budget)
    return
  }

  if (step === 'budget') {
    const budget = parseInt(content.replace(/[^0-9]/g, ''), 10)
    if (isNaN(budget) || budget < 1) {
      await sendText(phone, 'Please enter a valid budget amount (minimum $1/day).')
      return
    }
    data.budget = budget
    await generateAndPreviewAd(phone, data, convState)
    return
  }
}

function looksLikeScheduleRequest(text: string): boolean {
  return /\b(schedule|scheduling|later|tomorrow|tonight|kal|today at|in \d+ (min|minute|minutes|hour|hours|hr|hrs|day|days)|at \d|\d{1,2}(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.))\b/i.test(text)
}

async function handleAdPreview(phone: string, content: string, convState: AdConversationState): Promise<void> {
  const lower = content.toLowerCase().trim()

  // Scheduling: "schedule for tomorrow 5pm", "kal 5 baje", "in 2 hours", etc.
  if (looksLikeScheduleRequest(lower)) {
    const iso = parseScheduleTime(lower)
    if (iso) {
      const campaignId = convState.campaignId
      if (!campaignId) {
        await sendText(phone, '❌ No ad campaign to schedule.')
        return
      }
      await updateAdCampaign(campaignId, { status: 'scheduled', publishAt: iso })
      await setConversation(phone, { kind: 'idle' })
      await sendText(phone, `✅ Ad scheduled! Your ad campaign will launch on ${new Date(iso).toLocaleString()}.`)
      return
    }
    await sendText(phone, '🕐 Sure! What time should the ad launch? For example: "tomorrow at 5pm", "in 2 hours", or "6:00 PM".')
    return
  }

  if (lower === 'approve' || lower === 'yes' || lower === 'publish') {
    await createAdCampaignOnMeta(phone, convState)
    return
  }

  if (lower === 'edit' || lower === 'change') {
    await sendText(phone, '✏️ What would you like to change?\n• Headline\n• Text\n• Targeting\n• Budget\n• Image')
    const campaignId = convState.campaignId || crypto.randomUUID()
    await setConversation(phone, { kind: 'ad_gathering', postId: campaignId, step: 'edit', data: convState.data || {} } as ConversationState)
    return
  }

  if (lower === 'cancel') {
    await sendText(phone, '❌ Ad campaign cancelled.')
    await setConversation(phone, { kind: 'idle' })
    return
  }

  await sendText(phone, 'Please reply: Approve, Edit, or Cancel')
}

async function generateAndPreviewAd(
  phone: string,
  data: { topic?: string; budget?: number; websiteUrl?: string; intent?: Intent },
  convState: AdConversationState,
): Promise<void> {
  await setConversation(phone, { kind: 'generating', postId: convState.campaignId || '' })
  await sendText(phone, '🎨 Generating your ad content...')

  try {
    const topic = data.topic || 'social media post'
    const intent: Intent = {
      topic,
      audience: 'general audience',
      tone: 'professional',
      goal: 'promote business',
      language: 'English',
      emotion: 'trustworthy',
    }

    // Generate ad content and targeting in parallel
    const [adContent, targeting, objective] = await Promise.all([
      generateAdContent(topic, intent),
      generateAdTargeting(topic, intent.audience),
      suggestAdObjective(topic, intent.goal),
    ])

    // Generate image
    const imagePrompt = `Professional social media ad image for ${topic}. Clean, modern design with vibrant colors. No text in the image.`
    const imageBuffer = await generateImage(imagePrompt)
    const relPath = saveImageBuffer(imageBuffer, `ad_${Date.now()}`)
    const imageUrl = localFileUrl(relPath)

    // Create campaign in DB
    const campaign = await createAdCampaign({
      phone,
      name: `${topic} - Ad Campaign`,
      objective,
      adContent,
      targeting,
      budgetCents: (data.budget || 10) * 100,
      imageUrl,
    })

    convState.campaignId = campaign.id
    convState.data = data

    // Send preview
    await sendImage(phone, imageUrl, `**${adContent.headline}**\n\n${adContent.primaryText}\n\n${adContent.description}\n\nCTA: ${adContent.callToAction}`)

    const targetingSummary = `🎯 **Targeting:**\n• Age: ${targeting.ageMin}-${targeting.ageMax}\n• Genders: ${targeting.genders.join(', ')}\n• Locations: ${targeting.locations.join(', ')}\n• Interests: ${targeting.interests.join(', ')}`

    await sendText(phone, targetingSummary)
    await sendText(phone, `💰 **Budget:** $${data.budget}/day\n📋 **Objective:** ${objective.replace('OUTCOME_', '')}`)

    await sendText(phone, 'Would you like to approve this ad campaign?')
    await sendReplyButtons(phone, 'Action:', [
      { id: 'ad_approve', title: '✅ Approve' },
      { id: 'ad_edit', title: '✏️ Edit' },
      { id: 'ad_cancel', title: '❌ Cancel' },
    ])

    await setConversation(phone, { kind: 'ad_preview', postId: campaign.id } as any)
  } catch (err) {
    logger.error({ phone, error: (err as Error).message }, 'ad generation failed')
    await sendText(phone, `❌ Failed to generate ad: ${(err as Error).message}`)
    await setConversation(phone, { kind: 'idle' })
  }
}

async function createAdCampaignOnMeta(phone: string, convState: AdConversationState): Promise<void> {
  if (!convState.campaignId) {
    await sendText(phone, '❌ No campaign to publish.')
    return
  }
  await launchAdCampaign(convState.campaignId)
}

export async function launchAdCampaign(campaignId: string): Promise<void> {
  const campaign = await getAdCampaign(campaignId)
  if (!campaign) {
    throw new Error('Campaign not found')
  }
  if (campaign.status === 'active' || campaign.status === 'cancelled' || campaign.status === 'failed') {
    return
  }

  const phone = campaign.phone

  // Check tokens
  const userPhone = await resolveUserPhone(phone)
  const user = await getUser(userPhone)
  if (user) {
    const canDeduct = await deductTokens(userPhone, 5, campaign.id, 'Ad campaign creation')
    if (!canDeduct) {
      await sendText(phone, '❌ Insufficient tokens for ad campaign. Each campaign costs 5 tokens.')
      await updateAdCampaign(campaign.id, { status: 'failed' })
      return
    }
  }

  await sendText(phone, '⏳ Creating your ad campaign on Meta...')
  await updateAdCampaign(campaign.id, { status: 'creating' })

  try {
    // Prefer the user's own connected Meta Ads account, fall back to platform credentials.
    const userAdAccount = await getAccountByPlatform(userPhone, 'meta_ads')
    const userFbPage = await getAccountByPlatform(userPhone, 'facebook')
    const metaAdsToken = userAdAccount?.accessToken || process.env.META_ADS_ACCESS_TOKEN
    const adAccountId = userAdAccount?.accountId || process.env.META_ADS_ACCOUNT_ID

    if (!metaAdsToken || !adAccountId) {
      if (process.env.DEV_MODE === 'true') {
        // Mock success in dev mode
        await updateAdCampaign(campaign.id, {
          status: 'active',
          campaignId: `DEV_camp_${Date.now()}`,
          adSetId: `DEV_adset_${Date.now()}`,
          adId: `DEV_ad_${Date.now()}`,
        })
        await sendText(phone, `✅ **Ad Campaign Created!** (Dev Mode)\n\nCampaign ID: DEV_camp_${Date.now()}\nStatus: Active (mocked)\n\nIn production, this would create a real Meta ad campaign.`)
        await setConversation(phone, { kind: 'idle' })
        return
      }
      throw new Error('No Meta Ads account connected. Connect one in your dashboard, or ask admin to set META_ADS_ACCESS_TOKEN and META_ADS_ACCOUNT_ID.')
    }

    // Create real campaign on the user's own ad account
    const fbAccountId = adAccountId
    // The ad creative must belong to a Facebook Page. Prefer the user's own connected page,
    // fall back to the platform-level FACEBOOK_PAGE_ID.
    const pageId = userFbPage?.accountId || process.env.FACEBOOK_PAGE_ID || ''

    // Convert LLM targeting shape ({ageMin, ageMax, genders, locations, interests})
    // into the Meta Ads API targeting spec.
    const t = campaign.targeting
    const metaTargeting: Record<string, unknown> = {
      age_min: t.ageMin ?? 18,
      age_max: t.ageMax ?? 65,
      genders: (t.genders ?? ['all']).map((g) => (g === 'male' ? 1 : g === 'female' ? 2 : 0)),
      geo_locations: {
        countries: Array.isArray(t.locations) ? t.locations : ['US'],
      },
      interests: Array.isArray(t.interests)
        ? t.interests.slice(0, 5).map((name) => ({ name }))
        : [],
      publisher_platforms: ['facebook', 'instagram'],
    }

    const result = await boostPost(fbAccountId, metaAdsToken, {
      name: campaign.name,
      pageId,
      imageUrl: campaign.imageUrl || '',
      caption: campaign.adContent.primaryText,
      budgetCents: campaign.budgetCents,
      targeting: metaTargeting,
      objective: campaign.objective,
    })

    await updateAdCampaign(campaign.id, {
      status: 'active',
      campaignId: result.campaignId,
      adSetId: result.adSetId,
      adId: result.adId,
    })

    await sendText(phone, `✅ **Ad Campaign Created!**\n\nCampaign ID: ${result.campaignId}\nAd Set ID: ${result.adSetId}\nAd ID: ${result.adId}\nStatus: ${result.status}\n\nYour ad is created on your Meta Ads account and will start once it passes review. Track it in Meta Ads Manager.`)
    await setConversation(phone, { kind: 'idle' })
  } catch (err) {
    logger.error({ phone, error: (err as Error).message }, 'Meta Ads creation failed')
    await updateAdCampaign(campaign.id, { status: 'failed' })
    await sendText(phone, `❌ Failed to create ad campaign: ${(err as Error).message}\n\nYour tokens have been refunded.`)
    // Refund tokens
    if (user) {
      const { refundTokens } = await import('../lib/tokens.js')
      await refundTokens(userPhone, 5, campaign.id, 'Ad campaign failed - refund')
    }
    await setConversation(phone, { kind: 'idle' })
  }
}
