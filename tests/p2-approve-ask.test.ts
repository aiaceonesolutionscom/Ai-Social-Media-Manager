import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, setConversation, getPost, getConversation } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { generateFullDraft, brandCheck, generateImagePrompt } from '../src/pipeline/generate.js'
import { generateImage } from '../src/lib/image.js'
import { sendImage, sendText, sendReplyButtons } from '../src/lib/whatsapp.js'
import { waitForStatus, registerTestUser, PHONE, makeTextPayload, makeButtonPayload, IMAGE_BUFFER, wait } from './helpers.js'
import type { WrittenContent } from '../src/types.js'

const chatJsonMock = vi.mocked(chatJson)
const generateFullDraftMock = vi.mocked(generateFullDraft)
const brandCheckMock = vi.mocked(brandCheck)
const generateImagePromptMock = vi.mocked(generateImagePrompt)
const generateImageMock = vi.mocked(generateImage)
const sendTextMock = vi.mocked(sendText)
const sendImageMock = vi.mocked(sendImage)
const sendReplyButtonsMock = vi.mocked(sendReplyButtons)

const DRAFT: WrittenContent = {
  hook: 'Join our team!',
  caption: 'We are hiring an AI intern. Build real products, learn from experts.',
  cta: 'Apply now',
  emojis: '🚀',
  hashtags: '#Hiring #AI',
  seoKeywords: ['AI internship'],
}

// Polls sendTextMock for a call whose 2nd arg contains `needle` (the confirmation
// text is sent right after the stage flips to DONE, so assert it in a deadline loop).
async function waitForSendText(phone: string, needle: string, ms = 8000): Promise<string> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const call = (sendTextMock.mock.calls as unknown[]).find((c) => Array.isArray(c) && (c[1] as string)?.includes(needle))
    if (call) return call[1] as string
    await wait(20)
  }
  throw new Error(`sendText(${phone}, ...) with "${needle}" was never called`)
}

function baseMocks(): void {
  vi.resetAllMocks()
  generateFullDraftMock.mockResolvedValue({ ...DRAFT, language: 'English' } as never)
  brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
  generateImagePromptMock.mockResolvedValue('AI intern promo scene')
  generateImageMock.mockResolvedValue(IMAGE_BUFFER)
  sendImageMock.mockResolvedValue({ messages: [{ id: 'img' }] })
  sendTextMock.mockResolvedValue({ messages: [{ id: 'msg' }] })
  sendReplyButtonsMock.mockResolvedValue({ messages: [{ id: 'btn' }] })
}

async function makeReadyPost(): Promise<string> {
  const { createPost, updatePost } = await import('../src/store.js')
  const post = await createPost(PHONE)
  await updatePost(post.id, {
    transcript: 'hiring ai intern',
    intent: { topic: 'AI internship', audience: 'developers', tone: 'professional', goal: 'hire', language: 'English', emotion: 'exciting' },
    content: DRAFT,
    imagePrompt: 'AI intern promo',
    imagePath: 'images/test.png',
    imageUrl: 'http://mock/media/test.png',
    status: 'AWAITING_APPROVAL',
  })
  await setConversation(PHONE, { kind: 'awaiting_approval', postId: post.id })
  return post.id
}

describe('P2 — approve asks "publish now or schedule?" unless told to publish now', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    baseMocks()
    await resetStore()
    await registerTestUser()
  })

  it('bare "approve" asks publish-now or schedule and never publishes', async () => {
    const postId = await makeReadyPost()
    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const latest = String((messages[1] as { content: string }).content)
      if (latest === 'Approve') return { action: 'approve' }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('Approve', 'wamid.approve1'))
    // Status stays AWAITING_APPROVAL — nothing was published.
    expect((await getPost(postId)).status).toBe('AWAITING_APPROVAL')
    // Bot must offer a publish-now button vs a schedule button.
    const buttons = sendReplyButtonsMock.mock.calls[sendReplyButtonsMock.mock.calls.length - 1][2] as { id: string }[]
    expect(buttons.map((b) => b.id)).toEqual(expect.arrayContaining(['publish', 'schedule']))
    // No publish attempt happened.
    expect(sendTextMock).not.toHaveBeenCalledWith(PHONE, expect.stringContaining('Published'))
  })

  it('"publish now" after approve publishes immediately', async () => {
    const postId = await makeReadyPost()
    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const latest = String((messages[1] as { content: string }).content)
      if (latest === 'Approve') return { action: 'approve' }
      if (latest === 'publish now') return { action: 'approve', publishNow: true }
      return { action: 'smalltalk', reply: 'ok' }
    })

    await handleWebhook(makeTextPayload('Approve', 'wamid.a1'))
    await handleWebhook(makeTextPayload('publish now', 'wamid.a2'))
    const done = await waitForStatus(postId, 'DONE')
    expect(done.status).toBe('DONE')
    await waitForSendText(PHONE, 'Published')
  })

  it('the "publish" quick-reply button after the ask still publishes immediately', async () => {
    const postId = await makeReadyPost()
    chatJsonMock.mockResolvedValue({ action: 'approve' })

    // Trigger the ask with text "Approve".
    await handleWebhook(makeTextPayload('Approve', 'wamid.a3'))
    expect((await getPost(postId)).status).toBe('AWAITING_APPROVAL')

    // Tap the existing "publish" quick-reply button → immediate publish.
    await handleWebhook(makeButtonPayload('publish'))
    const done = await waitForStatus(postId, 'DONE')
    expect(done.status).toBe('DONE')
  })

  it('"schedule" button asks for a time but does not publish', async () => {
    const postId = await makeReadyPost()
    chatJsonMock.mockResolvedValue({ action: 'approve' })

    await handleWebhook(makeTextPayload('Approve', 'wamid.a4'))
    await handleWebhook(makeButtonPayload('schedule'))

    expect((await getPost(postId)).status).toBe('AWAITING_APPROVAL')
    await waitForSendText(PHONE, 'schedule it for')
  })

  it('conv stays awaiting_approval during the ask (no state wipe)', async () => {
    const postId = await makeReadyPost()
    chatJsonMock.mockResolvedValue({ action: 'approve' })
    await handleWebhook(makeTextPayload('Approve', 'wamid.a5'))
    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('awaiting_approval')
    expect(conv.postId).toBe(postId)
  })
})
