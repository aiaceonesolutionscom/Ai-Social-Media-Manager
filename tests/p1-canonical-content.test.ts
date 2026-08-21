import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import {
  initStore,
  resetStore,
  createPost,
  updatePost,
  setConversation,
  getPost,
  getEdits,
  createPackage,
  getPackage,
  updateUser,
} from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { publishImage } from '../src/lib/instagram.js'
import { publishToFacebook } from '../src/lib/facebook.js'
import { chatJson } from '../src/lib/llm.js'
import { generateFullDraft, brandCheck, generateImagePrompt, planEdit } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import { sendImage, sendText, sendReplyButtons, localFileUrl } from '../src/lib/whatsapp.js'
import { saveImageBuffer } from '../src/storage.js'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import { captionForPlatform } from '../src/lib/caption.js'
import { sendPreview } from '../src/pipeline/conversation.js'
import type { AgentDecision, WrittenContent } from '../src/types.js'
import { PHONE, IMAGE_BUFFER, makeTextPayload, waitForStatus, registerTestUser } from './helpers.js'

vi.mock('../src/lib/facebook.js', () => ({
  publishToFacebook: vi.fn(),
}))

const publishImageMock = vi.mocked(publishImage)
const publishToFacebookMock = vi.mocked(publishToFacebook)
const chatJsonMock = vi.mocked(chatJson)
const generateFullDraftMock = vi.mocked(generateFullDraft)
const brandCheckMock = vi.mocked(brandCheck)
const generateImagePromptMock = vi.mocked(generateImagePrompt)
const planEditMock = vi.mocked(planEdit)
const generateImageMock = vi.mocked(generateImage)
const sendImageMock = vi.mocked(sendImage)

const BASE: WrittenContent = {
  hook: 'Boost your mornings!',
  caption: '3 simple tips for a better morning routine that will transform your day.',
  cta: 'Save this post and share your best morning tip in the comments!',
  emojis: '🌅 💧 ✨',
  hashtags: '#MorningRoutine #Wellness',
  seoKeywords: ['morning routine'],
}

const IG: WrittenContent = {
  hook: 'Boost your mornings! ✨',
  caption: 'IG-only caption: hydrate before caffeine for steady energy.',
  cta: 'Save this post for later!',
  emojis: '🌅 ✨',
  hashtags: '#MorningRoutine #InstagramTips',
  seoKeywords: ['morning routine'],
}

const FB: WrittenContent = {
  hook: 'Elevate your mornings.',
  caption: 'FB-only caption: three proven habits for a more productive morning.',
  cta: 'Share this with a friend.',
  emojis: '✨',
  hashtags: '#MorningRoutine #Facebook',
  seoKeywords: ['morning routine'],
}

const EDITED: WrittenContent = {
  hook: 'Better mornings!',
  caption: 'Start with hydration and one clear intention.',
  cta: 'Save this for later!',
  emojis: '✨',
  hashtags: '#MorningRoutine #Wellness',
  seoKeywords: ['morning routine'],
}

const IMAGE_PROMPT = 'A vibrant morning scene with coffee and sunlight'

function draftWithPlatform(): Record<string, unknown> {
  return {
    id: 'post-x',
    phone: PHONE,
    status: 'WRITTEN',
    transcript: 'I want a morning routine post.',
    intent: { topic: 'morning routine', audience: 'health-conscious', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' },
    plan: { positioning: 'Boost mornings', angle: 'Simple tips', suggestedTime: '7am' },
    content: BASE,
    platformContent: { instagram: IG, facebook: FB },
    imagePrompt: IMAGE_PROMPT,
  }
}

async function makeReadyPost(): Promise<string> {
  const post = await createPost(PHONE)
  await updatePost(post.id, {
    transcript: 'I want a morning routine post.',
    intent: { topic: 'morning routine', audience: 'health-conscious', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' },
    content: BASE,
    platformContent: { instagram: IG, facebook: FB },
    imagePrompt: IMAGE_PROMPT,
    imagePath: 'images/test.png',
    imageUrl: 'http://mock/media/test.png',
    status: 'AWAITING_APPROVAL',
  })
  await setConversation(PHONE, { kind: 'awaiting_approval', postId: post.id })
  return post.id
}

async function setPackage(slug: string, features: Record<string, boolean>): Promise<void> {
  if (!(await getPackage(slug))) {
    await createPackage({ name: slug, slug, priceCents: 100, includedTokens: 1000, features })
  }
  await updateUser(PHONE, { packageId: slug })
  clearFeatureCache()
}

function useClassifier(decider: (latest: string) => AgentDecision): void {
  chatJsonMock.mockImplementation(async (messages: unknown[]) => {
    const latest = String((messages[1] as { content: string }).content)
    return decider(latest)
  })
}

function baseMocks(): void {
  vi.mocked(saveImageBuffer).mockReturnValue('images/test.png')
  vi.mocked(localFileUrl).mockReturnValue('http://mock/media/test.png')
  vi.mocked(sendText).mockResolvedValue({ messages: [{ id: 'msg' }] })
  vi.mocked(sendImage).mockResolvedValue({ messages: [{ id: 'img' }] })
  vi.mocked(sendReplyButtons).mockResolvedValue({ messages: [{ id: 'btn' }] })
  chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
  brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
  generateImagePromptMock.mockResolvedValue(IMAGE_PROMPT)
  generateImageMock.mockResolvedValue(IMAGE_BUFFER)
  publishImageMock.mockResolvedValue({ mediaId: '17912345678901234', permalink: 'https://www.instagram.com/p/C0OL1dRF9pN/' })
  publishToFacebookMock.mockResolvedValue({ postId: 'fb_123', permalink: 'https://facebook.com/fb_123' })
}

describe('P1 — canonical post content: what the user approves is what publishes', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.resetAllMocks()
    await resetStore()
    await registerTestUser()
    clearFeatureCache()
    baseMocks()
  })

  it('preview shows the platform-specific caption that will be published for a single-platform user', async () => {
    await setPackage('ig-only', {
      instagram_publishing: true,
      facebook_publishing: false,
      whatsapp_broadcast: true,
      scheduled_publishing: true,
      image_generation: true,
      ad_campaigns: true,
    })
    const postId = await makeReadyPost()
    const post = (await getPost(postId))!

    await sendPreview(PHONE, post)

    // Publisher uses captionForPlatform(post, 'instagram'); the preview must
    // show exactly that — NOT the base content caption.
    const expected = captionForPlatform(post, 'instagram')
    const shown = sendImageMock.mock.calls.at(-1)?.[2]
    expect(shown).toBe(expected)
    expect(shown).toContain('IG-only caption')
    expect(shown).not.toContain('3 simple tips for a better morning routine')
  })

  it('edit updates the base content AND every platform copy so preview and publish stay in sync', async () => {
    const postId = await makeReadyPost()
    planEditMock.mockResolvedValue({ scope: 'caption', content: EDITED })
    useClassifier((latest) => {
      if (latest.includes('shorter')) return { action: 'edit_request', editRequest: 'make it shorter' }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('make it shorter', 'wamid.e1'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')

    const post = (await getPost(postId))!
    expect(post.content!.caption).toBe(EDITED.caption)
    expect(post.platformContent!.instagram!.caption).toBe(EDITED.caption)
    expect(post.platformContent!.facebook!.caption).toBe(EDITED.caption)

    // Preview after the edit shows the edited caption.
    const shown = sendImageMock.mock.calls.at(-1)?.[2]
    expect(shown).toContain(EDITED.caption)
  })

  it('full edit preserves the editRequest through regeneration instead of dropping it', async () => {
    const postId = await makeReadyPost()
    planEditMock.mockResolvedValue({ scope: 'full' })
    generateFullDraftMock.mockResolvedValue(draftWithPlatform() as never)
    useClassifier((latest) => {
      if (latest.includes('shorter')) return { action: 'edit_request', editRequest: 'make it shorter' }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('make it shorter', 'wamid.f1'))

    const lastCall = generateFullDraftMock.mock.calls.at(-1)!
    const opts = lastCall[2] as { editRequest?: string }
    expect(opts.editRequest).toBe('make it shorter')

    const edits = await getEdits(postId)
    expect(edits.some((e) => e.editRequest === 'make it shorter')).toBe(true)
  })

  it('brand-check fixed caption reaches publish (base + platform copies)', async () => {
    generateFullDraftMock.mockResolvedValue(draftWithPlatform() as never)
    brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS', fixedCaption: 'FIXED: start with hydration and water.' })
    useClassifier((latest) => {
      if (latest.includes('morning')) return { action: 'generate_post', intent: { topic: 'morning routine', audience: 'health-conscious', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' } }
      if (latest === 'Approve') return { action: 'approve', publishNow: true }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('I want a morning routine post', 'wamid.b1'))
    const draftPost = await waitForStatus(await latestPostId(), 'AWAITING_APPROVAL')
    const previewCaption = sendImageMock.mock.calls.at(-1)?.[2]
    expect(previewCaption).toContain('FIXED:')
    expect(draftPost.platformContent!.instagram!.caption).toContain('FIXED:')

    await handleWebhook(makeTextPayload('Approve', 'wamid.b2'))
    const done = await waitForStatus(draftPost.id, 'DONE')

    // The caption published on Instagram is the same approved (fixed) caption
    // that was previewed.
    const publishedCaption = publishImageMock.mock.calls[0]?.[1]
    expect(publishedCaption).toContain('FIXED:')
    expect(publishedCaption).toBe(previewCaption)
    expect(done.status).toBe('DONE')
  }, 20000)

  it('facebook publish uses the platform-specific facebook caption', async () => {
    await setPackage('fb-only', {
      instagram_publishing: false,
      facebook_publishing: true,
      whatsapp_broadcast: true,
      scheduled_publishing: true,
      image_generation: true,
      ad_campaigns: true,
    })
    const postId = await makeReadyPost()
    useClassifier((latest) => {
      if (latest === 'Approve') return { action: 'approve', publishNow: true }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('Approve', 'wamid.fb1'))
    await waitForStatus(postId, 'DONE')

    const fbCall = publishToFacebookMock.mock.calls[0]
    expect(fbCall).toBeDefined()
    expect(fbCall[1]).toBe(captionForPlatform((await getPost(postId))!, 'facebook'))
    expect(fbCall[1]).toContain('FB-only caption')
  }, 20000)

  it('scheduled publish uses the edited caption, not a stale un-edited copy', async () => {
    const postId = await makeReadyPost()
    planEditMock.mockResolvedValue({ scope: 'caption', content: EDITED })
    useClassifier((latest) => {
      if (latest.includes('shorter')) return { action: 'edit_request', editRequest: 'make it shorter' }
      if (latest === 'Approve') return { action: 'approve', publishNow: true }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('make it shorter', 'wamid.s1'))
    await waitForStatus(postId, 'AWAITING_APPROVAL')
    const edited = (await getPost(postId))!
    expect(edited.content!.caption).toBe(EDITED.caption)

    await handleWebhook(makeTextPayload('Approve', 'wamid.s2'))
    const done = await waitForStatus(postId, 'DONE')
    expect(done.status).toBe('DONE')

    const publishedCaption = publishImageMock.mock.calls[0]?.[1]
    expect(publishedCaption).toContain(EDITED.caption)
  }, 20000)

  async function latestPostId(): Promise<string> {
    const { listPosts } = await import('../src/store.js')
    const posts = await listPosts()
    return posts[posts.length - 1].id
  }
})