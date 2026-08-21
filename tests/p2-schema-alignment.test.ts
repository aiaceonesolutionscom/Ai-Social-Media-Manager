import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, getPost } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { writeContent, generatePlatformContent, planEdit, normalizeWrittenContent } from '../src/pipeline/generate.js'
import { brandCheck, generateImagePrompt, generateFullDraft } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import { sendImage, sendText, sendReplyButtons, localFileUrl } from '../src/lib/whatsapp.js'
import { saveImageBuffer } from '../src/storage.js'
import { publishImage } from '../src/lib/instagram.js'
import { publishToFacebook } from '../src/lib/facebook.js'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import type { AgentDecision } from '../src/types.js'
import { PHONE, IMAGE_BUFFER, makeTextPayload, waitForStatus, registerTestUser } from './helpers.js'

vi.mock('../src/lib/facebook.js', () => ({
  publishToFacebook: vi.fn(),
}))

const chatJsonMock = vi.mocked(chatJson)
const brandCheckMock = vi.mocked(brandCheck)
const generateImagePromptMock = vi.mocked(generateImagePrompt)
const generateFullDraftMock = vi.mocked(generateFullDraft)
const generateImageMock = vi.mocked(generateImage)
const sendImageMock = vi.mocked(sendImage)
const sendTextMock = vi.mocked(sendText)
const publishImageMock = vi.mocked(publishImage)
const publishToFacebookMock = vi.mocked(publishToFacebook)

const INTENT = { topic: 'coffee', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' }
const PLAN = { positioning: 'Position', angle: 'Angle', suggestedTime: 'Tuesday 11am local time' }

const BASE = { hook: 'H', caption: 'Base caption', cta: 'C', emojis: '😀', hashtags: '#base', seoKeywords: [] as string[] }
const IG = { hook: 'H', caption: 'IG caption', cta: 'C', emojis: '✨', hashtags: '#ig', seoKeywords: [] as string[] }
const FB = { hook: 'H', caption: 'FB caption', cta: 'C', emojis: '👍', hashtags: '#fb', seoKeywords: [] as string[] }

function draftWith(platform?: string): Record<string, unknown> {
  return {
    intent: platform ? { ...INTENT, platform } : INTENT,
    plan: PLAN,
    content: BASE,
    imagePrompt: 'A coffee scene',
    imageSize: 'square 1080x1080',
    platformContent: { instagram: IG, facebook: FB },
  }
}

describe('P2-16 — LLM arrays are normalized to the pipeline string format', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
  })

  it('normalizeWrittenContent converts arrays to space-joined strings and coerces keywords', () => {
    const out = normalizeWrittenContent({
      hook: 'Hook',
      caption: 'Body',
      cta: 'CTA',
      emojis: ['🌅', '💧'],
      hashtags: ['#a', '#b'],
      seoKeywords: 'k1, k2',
    })
    expect(out.emojis).toBe('🌅 💧')
    expect(out.hashtags).toBe('#a #b')
    expect(out.seoKeywords).toEqual(['k1', 'k2'])
  })

  it('writeContent normalizes array emojis/hashtags from the LLM', async () => {
    chatJsonMock.mockResolvedValue({ hook: 'H', caption: 'C', cta: 'CTA', emojis: ['😀', '👍'], hashtags: ['#x', '#y'] } as never)

    const content = await writeContent(INTENT, PLAN)

    expect(content.emojis).toBe('😀 👍')
    expect(content.hashtags).toBe('#x #y')
    expect(content.hashtags).not.toContain(',')
  })

  it('generatePlatformContent normalizes both per-platform writers', async () => {
    chatJsonMock
      .mockResolvedValueOnce({ hook: 'H', caption: 'FB', cta: 'C', emojis: ['👍'], hashtags: ['#fb', '#post'] } as never)
      .mockResolvedValueOnce({ hook: 'H', caption: 'IG', cta: 'C', emojis: ['✨'], hashtags: ['#ig', '#tip'] } as never)

    const pc = await generatePlatformContent(INTENT, PLAN)

    expect(pc.facebook!.hashtags).toBe('#fb #post')
    expect(pc.instagram!.hashtags).toBe('#ig #tip')
  })

  it('planEdit normalizes the replacement content from the edit LLM', async () => {
    const real = await vi.importActual<typeof import('../src/pipeline/generate.js')>('../src/pipeline/generate.js')
    chatJsonMock.mockResolvedValue({ scope: 'caption', content: { hook: 'H', caption: 'C', cta: 'CTA', emojis: ['🔥'], hashtags: ['#edit', '#me'] } } as never)

    const decision = await real.planEdit({ topic: 'coffee', caption: 'old' }, 'make it shorter')

    expect(decision.content!.hashtags).toBe('#edit #me')
  })
})

describe('P2-13 — an explicit platform choice is extracted and honored', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    clearFeatureCache()
    await resetStore()
    await registerTestUser()
    vi.mocked(saveImageBuffer).mockReturnValue('images/test.png')
    vi.mocked(localFileUrl).mockReturnValue('http://mock/media/test.png')
    vi.mocked(sendText).mockResolvedValue({ messages: [{ id: 'msg' }] })
    vi.mocked(sendImage).mockResolvedValue({ messages: [{ id: 'img' }] })
    vi.mocked(sendReplyButtons).mockResolvedValue({ messages: [{ id: 'btn' }] })
    brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
    generateImagePromptMock.mockResolvedValue('A coffee scene')
    generateImageMock.mockResolvedValue(IMAGE_BUFFER)
    publishImageMock.mockResolvedValue({ mediaId: '17912345678901234', permalink: 'https://www.instagram.com/p/C0OL1dRF9pN/' })
    publishToFacebookMock.mockResolvedValue({ postId: 'fb_123', permalink: 'https://facebook.com/fb_123' })
  })

  function classifyCreate(): void {
    chatJsonMock.mockImplementation(async (messages) => {
      const latest = String((messages[1] as { content: string }).content)
      if (latest.includes('Create a Facebook post about coffee')) {
        return { action: 'generate_post', intent: { ...INTENT, platform: 'facebook' } } satisfies AgentDecision
      }
      if (latest.includes('Create a post about coffee')) {
        return { action: 'generate_post', intent: INTENT } satisfies AgentDecision
      }
      return { action: 'smalltalk', reply: 'ok' }
    })
  }

  it('persists the explicit platform and previews that platform version', async () => {
    classifyCreate()
    generateFullDraftMock.mockResolvedValue(draftWith('facebook') as never)

    await handleWebhook(makeTextPayload('Create a Facebook post about coffee', 'wamid.u1'))

    const list = (await import('../src/store.js')).listPostsForUser
    const posts = await list(PHONE)
    const post = (await getPost(posts[0].id))!
    await waitForStatus(post.id, 'AWAITING_APPROVAL')

    const refreshed = (await getPost(post.id))!
    expect(refreshed.platforms).toEqual(['facebook'])
    expect(refreshed.intent!.platform).toBe('facebook')

    const shown = sendImageMock.mock.calls.at(-1)?.[2]
    expect(shown).toContain('FB caption')
    expect(shown).not.toContain('IG caption')
  }, 20000)

  it('leaves platforms unset when the user names no platform', async () => {
    classifyCreate()
    generateFullDraftMock.mockResolvedValue(draftWith(undefined) as never)

    await handleWebhook(makeTextPayload('Create a post about coffee', 'wamid.u2'))

    const list = (await import('../src/store.js')).listPostsForUser
    const posts = await list(PHONE)
    const post = (await getPost(posts[0].id))!
    await waitForStatus(post.id, 'AWAITING_APPROVAL')

    const refreshed = (await getPost(post.id))!
    expect(refreshed.platforms).toBeUndefined()
  }, 20000)

  it('surfaces the suggested posting time in the preview', async () => {
    classifyCreate()
    generateFullDraftMock.mockResolvedValue(draftWith('facebook') as never)

    await handleWebhook(makeTextPayload('Create a Facebook post about coffee', 'wamid.u3'))

    const list = (await import('../src/store.js')).listPostsForUser
    const posts = await list(PHONE)
    const post = (await getPost(posts[0].id))!
    await waitForStatus(post.id, 'AWAITING_APPROVAL')

    const texts = sendTextMock.mock.calls.map((c) => String(c[1]))
    expect(texts.some((t) => t.includes('Suggested posting time') && t.includes('Tuesday 11am local time'))).toBe(true)
  }, 20000)
})