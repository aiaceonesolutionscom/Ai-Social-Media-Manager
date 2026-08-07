import { chatJson } from '../lib/llm.js'
import { logger } from '../lib/logger.js'
import { fullCaption, platformCaption } from '../lib/caption.js'
import { sendImage, sendReplyButtons, sendText, localFileUrl } from '../lib/whatsapp.js'
import { generateImage } from '../lib/image.js'
import { saveImageBuffer } from '../storage.js'
import { brandCheck, generateFullDraft, generateImagePrompt, planEdit } from './generate.js'
import { cancelPublish, enqueuePublish } from './publish.js'
import { handleAdConversation } from './adConversation.js'
import { isUrl, normalizeUrl, analyzeWebsite, type WebsiteAnalysis } from '../lib/urlAnalyzer.js'
import {
  createPost,
  getBrandProfile,
  getConversation,
  getMessages,
  getPost,
  getUser,
  getPackage,
  getUserPreferences,
  logMessage,
  resolveUserPhone,
  saveEdit,
  setConversation,
  setStage,
} from '../store.js'
import type { AgentDecision, ConversationState, Intent, Post } from '../types.js'

interface PlatformInfo {
  platforms: string[]
  primaryLabel: string
  allLabel: string
  hasAdCampaigns: boolean
}

async function getPlatformInfo(phone: string): Promise<PlatformInfo> {
  const userPhone = await resolveUserPhone(phone)
  const user = await getUser(userPhone)
  const pkg = user?.packageId ? await getPackage(user.packageId) : null
  const features = (pkg?.features || {}) as Record<string, boolean>

  const platforms: string[] = []
  if (features.facebook_publishing === true) platforms.push('facebook')
  if (features.instagram_publishing === true) platforms.push('instagram')

  const primary = platforms.length > 0 ? (platforms.includes('instagram') ? 'Instagram' : 'Facebook') : 'social media'
  const allLabel = platforms.length > 1 ? 'social media' : (platforms.length === 1 ? primary : 'social media')
  const hasAdCampaigns = features.ad_campaigns === true

  return { platforms, primaryLabel: primary, allLabel, hasAdCampaigns }
}

const CORE_SYSTEM = `You are a professional social media manager chatting on WhatsApp.
You help users create social media posts through natural conversation.
You are friendly, warm, and human. You ask only ONE logical question at a time.
Never overwhelm the user. Never ask for something already provided.
Write your replies in the same natural, easy tone as the user.`

async function historyBlock(phone: string, limit = 12): Promise<string> {
  const msgs = (await getMessages(phone)).slice(-limit)
  if (msgs.length === 0) return '(no prior messages)'
  return msgs
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
    .join('\n')
}

function postSummary(post?: Post): string {
  if (!post) return 'no draft yet'
  const lines = [`status: ${post.status}`]
  if (post.intent) lines.push(`intent: ${JSON.stringify(post.intent)}`)
  if (post.content) lines.push(`caption preview: ${post.content.caption.slice(0, 160)}`)
  return lines.join('\n')
}

async function assembleSystem(situation: string, phone: string, post?: Post): Promise<string> {
  const prefs = await getUserPreferences(phone)
  const pi = await getPlatformInfo(phone)
  const prefsBlock = prefs
    ? `USER PREFERENCES (apply unless user says otherwise):\n- language: ${prefs.language ?? 'not set'}\n- tone: ${prefs.tone ?? 'not set'}\n- audience: ${prefs.audience ?? 'not set'}\n- brand voice: ${prefs.brandVoice ?? 'not set'}`
    : 'USER PREFERENCES: none set'
  return `${CORE_SYSTEM}

USER'S AVAILABLE PLATFORMS: ${pi.allLabel} (connected: ${pi.platforms.join(', ')})
The user can ONLY publish to the platforms listed above. Do NOT suggest platforms they don't have access to.

CURRENT SITUATION: ${situation}

DRAFT STATE:
${postSummary(post)}

${prefsBlock}

RECENT CONVERSATION:
${await historyBlock(phone)}

Decide the user's intended action from their latest message. Return ONLY a JSON object:
{
  "action": "smalltalk" | "ask_question" | "generate_post" | "edit_request" | "approve" | "regenerate" | "cancel_publish" | "new_post" | "create_ad" | "unclear",
  "reply": "a short, natural response to send (optional)",
  "question": "the single next question to ask (only for ask_question)",
  "intent": { "topic": "", "audience": "", "tone": "", "goal": "", "language": "", "emotion": "" },
  "editRequest": "a concise paraphrase of the requested edit (only for edit_request)"
}
Use "create_ad" when the user wants to run ads, promote something, create a campaign, or boost a post.
Fill as many intent fields as you can infer from context and history. Never guess fields you cannot infer.`
}

async function classify(phone: string, situation: string, post: Post | undefined, latest: string): Promise<AgentDecision> {
  const messages = [
    { role: 'system' as const, content: await assembleSystem(situation, phone, post) },
    { role: 'user' as const, content: latest },
  ]
  try {
    const decision = await chatJson<AgentDecision>(messages, { temperature: 0.5 })
    if (!decision || typeof decision.action !== 'string') {
      return { action: 'unclear', reply: "Hmm, I didn't quite catch that. Could you rephrase?" }
    }
    return decision
  } catch (err) {
    logger.error({ phone, error: (err as Error).message }, 'classifier failed')
    return { action: 'unclear', reply: 'Sorry, something glitched on my side. Could you say that again?' }
  }
}

async function safeSend(phone: string, text: string | undefined): Promise<void> {
  if (text && text.trim()) {
    await sendText(phone, text)
  }
}

const REVIEW_MESSAGE_TEMPLATE = (platformLabel: string) => `I've created your ${platformLabel} post.

Please review it.

If you'd like any changes, simply tell me naturally.

For example:
• Make the caption shorter.
• Change the colors.
• Make the image realistic.
• Add more hashtags.
• Remove emojis.
• Make it professional.

If everything looks good, simply reply:

Approve`

async function safeGenerateImage(prompt: string): Promise<Buffer> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await generateImage(prompt)
    } catch (err) {
      lastErr = err
      logger.warn({ attempt, error: (err as Error).message }, 'image generation attempt failed, retrying')
    }
  }
  throw lastErr
}

export async function sendPreview(phone: string, post: Post): Promise<void> {
  const pi = await getPlatformInfo(phone)
  const url = post.imageUrl!

  // Use platform-specific caption if available, fallback to default
  if (pi.platforms.length > 1 && post.platformContent?.facebook && post.platformContent?.instagram) {
    // Show Instagram preview first (primary)
    const igCaption = platformCaption(post.platformContent.instagram, 'instagram')
    await sendImage(phone, url, igCaption)
    await sendText(phone, `📱 **Instagram version** shown above.\n\nYour Facebook version will have a different caption optimized for Facebook.\n\nBoth will be published when you approve.`)
  } else {
    const caption = fullCaption(post.content!)
    await sendImage(phone, url, caption)
  }

  await sendText(phone, REVIEW_MESSAGE_TEMPLATE(pi.allLabel))
  await sendReplyButtons(phone, 'What would you like to do?', [
    { id: 'publish', title: '✅ Publish' },
    { id: 'edit', title: '✏️ Edit' },
    { id: 'regenerate', title: '🔄 Regenerate' },
  ])
}

async function runPipeline(phone: string, postId: string, sourceText: string, intentOverride?: Partial<Intent> | Intent): Promise<void> {
  const post = (await getPost(postId))!
  const prefs = await getUserPreferences(phone)
  const brand = await getBrandProfile(phone)
  await setConversation(phone, { kind: 'generating', postId })
  try {
    const fullIntent = intentOverride && intentOverride.topic ? (intentOverride as unknown as Intent) : undefined
    await setStage(postId, 'INTENT')
    const draft = await generateFullDraft(post, sourceText, fullIntent ? { intent: fullIntent, preferences: prefs } : { preferences: prefs })
    await setStage(postId, 'WRITTEN', {
      transcript: sourceText,
      intent: draft.intent,
      plan: draft.plan,
      content: draft.content,
      imagePrompt: draft.imagePrompt,
    })

    await setStage(postId, 'CHECKED')
    const draftPost = (await getPost(postId))!
    const bc = await brandCheck(draftPost.content!.caption, brand)
    let finalContent = draftPost.content!
    if (bc.fixedCaption) finalContent = { ...finalContent, caption: bc.fixedCaption }
    if (!bc.passed) throw new Error('Brand check failed — post violates guidelines')
    await setStage(postId, 'CHECKED', { content: finalContent, brandCheck: bc })

    await setStage(postId, 'IMAGE')
    const imgPost = (await getPost(postId))!
    const imageBuffer = await safeGenerateImage(imgPost.imagePrompt!)
    const relPath = saveImageBuffer(imageBuffer, postId)
    const url = localFileUrl(relPath)
    await setStage(postId, 'IMAGE', { imagePath: relPath, imageUrl: url })

    await setStage(postId, 'AWAITING_APPROVAL')
    await setConversation(phone, { kind: 'awaiting_approval', postId })
    await sendPreview(phone, (await getPost(postId))!)
  } catch (err) {
    try {
      await setStage(postId, 'FAILED', { error: (err as Error).message })
      await setConversation(phone, { kind: 'idle', postId })
    } catch {
      // Post may have been removed (e.g. during test cleanup)
    }
    await safeSend(phone, `❌ Failed to create your post: ${(err as Error).message}`)
  }
}

async function handleEdit(phone: string, postId: string, editRequest: string): Promise<void> {
  const post = await getPost(postId)
  if (!post || !post.content) {
    await safeSend(phone, "I don't have a draft to edit yet. Tell me what to create first.")
    return
  }
  const brand = await getBrandProfile(phone)
  await setConversation(phone, { kind: 'generating', postId })
  await safeSend(phone, '✏️ Applying your edit...')
  try {
    const decision = await planEdit(
      { topic: post.intent?.topic ?? '', caption: post.content.caption },
      editRequest,
    )

    if (decision.scope === 'full') {
      await setStage(postId, 'INTENT')
      await runPipeline(phone, postId, post.transcript ?? post.content.caption, undefined)
      return
    }

    let content = post.content
    if (decision.content) {
      content = decision.content
      await setStage(postId, 'WRITTEN', { content })
    }

    const bc = await brandCheck(content.caption, brand)
    let finalContent = content
    if (bc.fixedCaption) finalContent = { ...content, caption: bc.fixedCaption }
    if (!bc.passed) throw new Error('Edit rejected by brand check: ' + bc.policy)
    await setStage(postId, 'CHECKED', { content: finalContent, brandCheck: bc })

    if (decision.scope === 'image' || decision.imagePrompt) {
      const prompt = decision.imagePrompt ?? (await generateImagePrompt(post.intent?.topic ?? '', finalContent.caption))
      await setStage(postId, 'IMAGE')
      const imageBuffer = await safeGenerateImage(prompt)
      const relPath = saveImageBuffer(imageBuffer, postId)
      const url = localFileUrl(relPath)
      await setStage(postId, 'IMAGE', { imagePath: relPath, imageUrl: url, imagePrompt: prompt })
    }

    await saveEdit(postId, editRequest, JSON.stringify(finalContent))
    await setStage(postId, 'AWAITING_APPROVAL')
    await setConversation(phone, { kind: 'awaiting_approval', postId })
    await sendPreview(phone, (await getPost(postId))!)
  } catch (err) {
    await setStage(postId, 'FAILED', { error: (err as Error).message })
    await setConversation(phone, { kind: 'idle', postId })
    await safeSend(phone, `❌ Could not apply that edit: ${(err as Error).message}`)
  }
}

export async function handleUserInput(
  phone: string,
  content: string,
  opts: { voice?: boolean; waMsgId?: string } = {},
): Promise<void> {
  const { isDuplicate } = await logMessage({
    phone,
    role: 'user',
    type: opts.voice ? 'voice' : 'text',
    content,
    waMsgId: opts.waMsgId,
    postId: (await getConversation(phone)).postId,
  })
  if (isDuplicate) return

  const conv = await getConversation(phone)
  const pi = await getPlatformInfo(phone)

  // Check for ad-related keywords and feature gate
  const adKeywords = /\b(ad|ads|campaign|campaigns|promote|promotion|boost|boosting|marketing ad|meta ad|facebook ad|instagram ad|run ad|advertise)\b/i
  if (adKeywords.test(content) && !pi.hasAdCampaigns) {
    await safeSend(phone, '❌ Meta Ads is not included in your current plan. Please upgrade your package to use this feature.\n\nYou can check available packages by saying "show packages" or visit your dashboard.')
    return
  }

  // Route to ad conversation if user wants to create an ad
  if (adKeywords.test(content) && pi.hasAdCampaigns) {
    await handleAdConversation(phone, content, { kind: 'ad_gathering', step: 'topic', data: {} })
    return
  }

  if (conv.kind === 'idle') {
    // Check if user sent a URL - analyze and generate content
    if (isUrl(content)) {
      const url = normalizeUrl(content)
      await safeSend(phone, '🔍 Analyzing your website... This may take a moment.')
      try {
        const analysis = await analyzeWebsite(url)
        const topic = analysis.businessName !== 'Unknown Business'
          ? `${analysis.businessName} - ${analysis.businessType}`
          : analysis.businessType
        const postId = (await createPost(phone)).id
        await setConversation(phone, { kind: 'generating', postId })
        await safeSend(phone, `Found: **${analysis.businessName}** (${analysis.businessType})\n\nServices: ${analysis.services.join(', ')}\nTone: ${analysis.brandTone}\nAudience: ${analysis.targetAudience}\n\nGenerating your post... 🎨`)

        const intent = {
          topic,
          audience: analysis.targetAudience,
          tone: analysis.brandTone,
          goal: 'promote business',
          language: 'English',
          emotion: 'trustworthy',
        }
        await runPipeline(phone, postId, `Create a social media post for ${analysis.businessName}, a ${analysis.businessType}. Services: ${analysis.services.join(', ')}. Tone: ${analysis.brandTone}. Target audience: ${analysis.targetAudience}. Key messages: ${analysis.keyMessages.join(', ')}`, intent)
      } catch (err) {
        logger.error({ phone, error: (err as Error).message }, 'URL analysis failed')
        await safeSend(phone, `❌ Could not analyze that website: ${(err as Error).message}\n\nTell me what the post should be about instead.`)
      }
      return
    }

    const d = await classify(phone, `No draft in progress. The user may want to start a new ${pi.allLabel} post or just chat.`, undefined, content)
    if (d.action === 'generate_post') {
      const postId = (await createPost(phone)).id
      await setConversation(phone, { kind: 'generating', postId })
      await safeSend(phone, 'Great! Let me create that for you. 🎨')
      await runPipeline(phone, postId, content, d.intent)
    } else if (d.action === 'ask_question') {
      const postId = (await createPost(phone)).id
      await setConversation(phone, { kind: 'gathering', postId, intent: d.intent ?? {} })
      await safeSend(phone, d.question ?? d.reply ?? 'Sure! What is the post about?')
    } else if (d.action === 'smalltalk') {
      await safeSend(phone, d.reply ?? 'Hi! 👋 How are you? What would you like to create today?')
    } else if (d.action === 'new_post') {
      await safeSend(phone, d.question ?? d.reply ?? 'Sure! What would you like to post about?')
    } else {
      await safeSend(
        phone,
        d.reply ?? `I can turn your idea into a ${pi.allLabel} post. Tell me what it's about, or send me a voice note.`,
      )
    }
    return
  }

  if (conv.kind === 'gathering') {
    const post = (await getPost(conv.postId))!
    const d = await classify(phone, 'Gathering details for a new post. Ask only if a key detail is still missing.', post, content)
    const newIntent = Object.fromEntries(
      Object.entries(d.intent ?? {}).filter(([_, v]) => v != null && v !== '')
    )
    const merged = { ...conv.intent, ...newIntent }
    if (d.action === 'generate_post') {
      await setConversation(phone, { kind: 'generating', postId: conv.postId })
      await runPipeline(phone, conv.postId, content, merged)
    } else if (d.action === 'ask_question') {
      await setConversation(phone, { kind: 'gathering', postId: conv.postId, intent: merged })
      await safeSend(phone, d.question ?? d.reply ?? 'And anything else?')
    } else if (d.action === 'smalltalk') {
      await setConversation(phone, { kind: 'gathering', postId: conv.postId, intent: merged })
      await safeSend(phone, d.reply ?? 'Got it! Anything you want to add?')
    } else {
      await safeSend(phone, d.reply ?? 'Sounds good — tell me more!')
    }
    return
  }

  if (conv.kind === 'awaiting_approval') {
    const post = (await getPost(conv.postId))!
    const d = await classify(phone, 'A draft is waiting for approval. The user can approve, edit, or regenerate it.', post, content)
    if (d.action === 'approve') {
      try {
        await setStage(conv.postId, 'APPROVED')
        await enqueuePublish(conv.postId)
      } catch (err) {
        await safeSend(phone, `❌ Could not start publishing: ${(err as Error).message}`)
      }
    } else if (d.action === 'edit_request') {
      await setConversation(phone, { kind: 'editing', postId: conv.postId })
      if (d.editRequest) {
        await handleEdit(phone, conv.postId, d.editRequest)
      } else {
        await safeSend(phone, '✏️ What would you like to change? For example: make it shorter, change the colors, use Urdu, add emojis, remove hashtags, make it funnier.')
      }
    } else if (d.action === 'regenerate') {
      await setConversation(phone, { kind: 'generating', postId: conv.postId })
      await safeSend(phone, '🔄 Regenerating your post...')
      await runPipeline(phone, conv.postId, post.transcript ?? post.content!.caption, undefined)
    } else {
      await safeSend(phone, d.reply ?? "Here's your draft. Reply Approve to publish, or tell me what to change.")
    }
    return
  }

  if (conv.kind === 'editing') {
    await handleEdit(phone, conv.postId, content)
    return
  }

  if (conv.kind === 'generating') {
    await safeSend(phone, '🤖 I am still working on your post — one moment!')
    return
  }

  if (conv.kind === 'preparing_publish' || conv.kind === 'publishing') {
    const post = (await getPost(conv.postId))!
    const d = await classify(phone, 'Publishing is in progress. The user may want to cancel before the final publish.', post, content)
    if (d.action === 'cancel_publish') {
      const res = await cancelPublish(conv.postId)
      if (res === 'too_late') {
        await safeSend(phone, 'Your post has already been sent for publishing and can no longer be cancelled.\n\nIf it has already been published, I can help you delete it later (if supported).')
      } else if (res === 'not_found') {
        await safeSend(phone, 'No publishing is currently in progress.')
      }
    } else {
      await safeSend(phone, d.reply ?? 'Just a moment while I finish publishing your post. 🚀')
    }
    return
  }

  await safeSend(phone, 'Hi! 👋 What would you like to create today?')
}

export async function handleVoiceInput(phone: string, transcript: string, opts: { waMsgId?: string } = {}): Promise<void> {
  await safeSend(phone, 'Got it — I heard you. Working on it now. 🎙️')
  await handleUserInput(phone, transcript, { voice: true, waMsgId: opts.waMsgId })
}

export async function regeneratePost(phone: string, postId: string): Promise<void> {
  const post = await getPost(postId)
  if (!post || !post.transcript) {
    await safeSend(phone, "I don't have enough to regenerate from.")
    return
  }
  await setConversation(phone, { kind: 'generating', postId })
  await safeSend(phone, '🔄 Regenerating your post...')
  await runPipeline(phone, postId, post.transcript, undefined)
}

export function resetConversationState(): void {}
