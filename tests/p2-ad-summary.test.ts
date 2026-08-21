import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, setConversation } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { sendText, sendImage, sendReplyButtons } from '../src/lib/whatsapp.js'
import type { AgentDecision, AdConversationData } from '../src/types.js'
import { PHONE, makeTextPayload, registerTestUser } from './helpers.js'

const chatJsonMock = vi.mocked(chatJson)

describe('P2-19 — ad summary gives the LLM the full budget, currency and dates', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
    vi.mocked(sendText).mockResolvedValue({ messages: [{ id: 'msg' }] })
    vi.mocked(sendImage).mockResolvedValue({ messages: [{ id: 'img' }] })
    vi.mocked(sendReplyButtons).mockResolvedValue({ messages: [{ id: 'btn' }] })
  })

  async function systemOfClassify(adData: AdConversationData): Promise<string> {
    await setConversation(PHONE, { kind: 'ad_preview', postId: 'ad_1', adData } as never)
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' } satisfies AgentDecision)

    await handleWebhook(makeTextPayload('approve the ad please', 'wamid.adsum1'))

    const sys = String(chatJsonMock.mock.calls[0][0][0].content)
    return sys
  }

  it('includes the currency and budget type', async () => {
    const sys = await systemOfClassify({
      product: 'Running shoes',
      budget: 50,
      budgetType: 'total',
      currency: 'EUR',
      websiteUrl: 'https://example.com',
    })

    expect(sys).toContain('EUR')
    expect(sys).toContain('50/lifetime')
    expect(sys).not.toContain('$/day')
  })

  it('includes the campaign dates', async () => {
    const sys = await systemOfClassify({
      product: 'Running shoes',
      budget: 20,
      budgetType: 'daily',
      currency: 'USD',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    })

    expect(sys).toContain('start date: 2026-09-01')
    expect(sys).toContain('end date: 2026-09-30')
    expect(sys).toContain('20/per day')
  })
})