import { chat, chatJson } from '../lib/llm.js'
import { buildBrandContext } from '../lib/branding.js'
import type {
  BrandCheck,
  BrandProfile,
  EditDecision,
  Intent,
  PlannedContent,
  PlatformContent,
  Post,
  UserPreferences,
  WrittenContent,
} from '../types.js'

const SYSTEM_INTENT = `You are an AI assistant that analyzes social media content ideas.
Extract from the user's text:
- topic: what the post is about (1-3 words)
- audience: who this post is for
- tone: the writing tone (e.g. playful, professional, inspirational, educational, funny, luxury, casual)
- goal: the objective (e.g. promote product, educate, drive engagement, build brand awareness, announce offer)
- language: the language the user wants the post written in (e.g. English, Urdu, Spanish). Default to the language of the user's message.
- emotion: the emotional feel (e.g. exciting, calm, urgent, joyful, trustworthy)

User preferences (apply as defaults unless user explicitly overrides):
- preferred language: {{language}}
- preferred tone: {{tone}}
- preferred audience: {{audience}}

Return ONLY a valid JSON object with keys: topic, audience, tone, goal, language, emotion.`

const SYSTEM_PLAN = `You are a content strategist for social media. Given a topic, audience, tone, goal, and emotion, propose:
- positioning: a short positioning statement for this post
- angle: the specific angle/approach to take
- suggestedTime: a suggested publish time window (e.g. "Tuesday 11am EST")
Return ONLY a valid JSON object with keys: positioning, angle, suggestedTime.`

const SYSTEM_WRITER = `You are a creative social media copywriter. Write a complete social media post given the content brief.
Rules:
- Hook: a bold, attention-grabbing first line (max 100 chars).
- Caption: the main body text.
- CTA: a clear call-to-action (e.g. "Save this for later", "Share with a friend", "Comment your thoughts").
- Emojis: use 3-8 relevant emojis naturally in the caption.
- Hashtags: 15-25 relevant hashtags on a single line at the end.
- SEO Keywords: list 5-8 SEO keywords as a JSON array of strings.
- Write the caption, hook, CTA in the requested language. Keep hashtags in a widely understood form.
- Match the requested tone and emotion exactly.
Return ONLY a valid JSON object with keys: hook, caption, cta, emojis, hashtags, seoKeywords (array of strings).`

const SYSTEM_WRITER_FACEBOOK = `You are a Facebook copywriter. Write a Facebook-optimized post given the content brief.
Facebook-specific rules:
- Hook: a bold, attention-grabbing first line (max 100 chars) that encourages clicks and shares.
- Caption: longer, conversational body text (100-300 words). Facebook favors storytelling and longer posts.
- CTA: encourage engagement (e.g. "Tag a friend who needs this", "Share your thoughts below", "Click the link to learn more").
- Emojis: use 2-5 emojis sparingly for emphasis.
- Hashtags: 3-5 relevant hashtags only (Facebook doesn't need many).
- Tone: conversational, community-focused, story-driven.
- Include a question to drive comments.
Return ONLY a valid JSON object with keys: hook, caption, cta, emojis, hashtags, seoKeywords (array of strings).`

const SYSTEM_WRITER_INSTAGRAM = `You are an Instagram copywriter. Write an Instagram-optimized post given the content brief.
Instagram-specific rules:
- Hook: a bold, scroll-stopping first line (max 100 chars).
- Caption: medium-length body text (50-150 words). Balance visual appeal with readability.
- CTA: encourage saves and shares (e.g. "Save this for later 💾", "Share with someone who needs this", "Drop a 🔥 if you agree").
- Emojis: use 5-10 emojis naturally throughout.
- Hashtags: 15-25 relevant hashtags on a single line at the end (Instagram relies on hashtags for discovery).
- Tone: visual, trendy, aspirational.
- Use line breaks for readability.
Return ONLY a valid JSON object with keys: hook, caption, cta, emojis, hashtags, seoKeywords (array of strings).`

const SYSTEM_BRAND_CHECK = `You are a brand and policy checker for social media posts. Review the following caption and check:
1. Grammar: any spelling, grammar, or punctuation errors.
2. Brand voice: does it sound consistent (friendly, professional, clear)?
3. Copyright: does it contain any copyrighted quotes, claims, or content that could be problematic?
4. Policy: does it violate Instagram's community guidelines (spam, misleading, prohibited content)?

Brand profile (if provided):
{{brandProfile}}

For each check, return "PASS" or "FAIL" with a brief explanation. If grammar fails, provide a corrected version of the caption.
Return ONLY a valid JSON object with keys: passed (boolean), grammar (string), brandVoice (string), copyright (string), policy (string), fixedCaption (string, only if grammar failed and you can fix it).`

const SYSTEM_IMAGE_PROMPT = `You are an image prompt engineer. Given an Instagram post caption and topic, write a concise, vivid text-to-image prompt for generating a square 1080x1080 social media image. The image should be visually striking, on-theme, and suitable for an Instagram feed post. Do NOT include any text in the image description. Return ONLY the image prompt string (no JSON, no quotes).`

const SYSTEM_EDIT = `You are a social media post editor. Given the current post and the user's edit request, decide what needs to change and produce the changed pieces.
Scope values:
- "caption": only text changes (hook/caption/cta/emojis/hashtags/seo). The image stays the same.
- "image": only the image changes. The text stays the same.
- "both": both text and image change.
- "full": regenerate everything from scratch.
When text changes, provide a full "content" object: {hook, caption, cta, emojis, hashtags, seoKeywords (array)} that fully replaces the current one, applying the edit while keeping the original structure and topic.
When the image changes, provide a new "imagePrompt" string (no text in the image).
Return ONLY a valid JSON object with keys: scope, content (object, omit if not changing text), imagePrompt (string, omit if not changing image).`

export async function extractIntent(transcript: string, prefs?: UserPreferences): Promise<Intent> {
  const systemPrompt = SYSTEM_INTENT
    .replace('{{language}}', prefs?.language ?? 'not set')
    .replace('{{tone}}', prefs?.tone ?? 'not set')
    .replace('{{audience}}', prefs?.audience ?? 'not set')
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: transcript },
  ]
  return chatJson<Intent>(messages)
}

export async function planContent(intent: Intent): Promise<PlannedContent> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PLAN },
    { role: 'user' as const, content: JSON.stringify(intent) },
  ]
  return chatJson<PlannedContent>(messages)
}

export async function writeContent(intent: Intent, plan: PlannedContent, prefs?: UserPreferences, brand?: BrandProfile): Promise<WrittenContent> {
  const prefsContext = prefs
    ? `\nUser preferences (respect these):\n- language: ${prefs.language}\n- tone: ${prefs.tone}\n- audience: ${prefs.audience}`
    : ''
  const messages = [
    { role: 'system' as const, content: SYSTEM_WRITER + prefsContext + buildBrandContext(brand) },
    { role: 'user' as const, content: JSON.stringify({ intent, plan }) },
  ]
  return chatJson<WrittenContent>(messages, { temperature: 0.8 })
}

export async function brandCheck(caption: string, brandProfile?: BrandProfile): Promise<BrandCheck> {
  const profileBlock = brandProfile
    ? JSON.stringify(brandProfile)
    : 'No brand profile set — use generic brand voice checks (friendly, professional, clear).'
  const systemPrompt = SYSTEM_BRAND_CHECK.replace('{{brandProfile}}', profileBlock)
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: caption },
  ]
  return chatJson<BrandCheck>(messages)
}

export async function generateImagePrompt(topic: string, caption: string): Promise<string> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_IMAGE_PROMPT },
    { role: 'user' as const, content: `Topic: ${topic}\nCaption: ${caption}` },
  ]
  return chat(messages, { temperature: 0.9 })
}

export async function planEdit(current: { topic: string; caption: string }, editRequest: string): Promise<EditDecision> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_EDIT },
    {
      role: 'user' as const,
      content: `Current topic: ${current.topic}\nCurrent caption: ${current.caption}\n\nEdit request: ${editRequest}`,
    },
  ]
  return chatJson<EditDecision>(messages, { temperature: 0.6 })
}

export interface FullDraftOptions {
  intent?: Intent
  preferences?: UserPreferences
  brandProfile?: BrandProfile
}

async function writeContentForPlatform(
  intent: Intent,
  plan: PlannedContent,
  platform: 'facebook' | 'instagram',
  prefs?: UserPreferences,
  brand?: BrandProfile,
): Promise<WrittenContent> {
  const systemPrompt = platform === 'facebook' ? SYSTEM_WRITER_FACEBOOK : SYSTEM_WRITER_INSTAGRAM
  const prefsContext = prefs
    ? `\nUser preferences (respect these):\n- language: ${prefs.language}\n- tone: ${prefs.tone}\n- audience: ${prefs.audience}`
    : ''
  const messages = [
    { role: 'system' as const, content: systemPrompt + prefsContext + buildBrandContext(brand) },
    { role: 'user' as const, content: JSON.stringify({ intent, plan }) },
  ]
  return chatJson<WrittenContent>(messages, { temperature: 0.8 })
}

export async function generatePlatformContent(
  intent: Intent,
  plan: PlannedContent,
  prefs?: UserPreferences,
  brand?: BrandProfile,
): Promise<PlatformContent> {
  const [facebook, instagram] = await Promise.all([
    writeContentForPlatform(intent, plan, 'facebook', prefs, brand),
    writeContentForPlatform(intent, plan, 'instagram', prefs, brand),
  ])
  return { facebook, instagram }
}

export async function generateFullDraft(post: Post, transcript: string, opts: FullDraftOptions = {}): Promise<Post> {
  const intent = opts.intent ?? (await extractIntent(transcript, opts.preferences))
  const plan = await planContent(intent)
  const content = await writeContent(intent, plan, opts.preferences, opts.brandProfile)
  const platformContent = await generatePlatformContent(intent, plan, opts.preferences, opts.brandProfile)
  const imagePrompt = await generateImagePrompt(intent.topic, content.caption)
  return {
    ...post,
    transcript,
    intent,
    plan,
    content,
    platformContent,
    imagePrompt,
  }
}
