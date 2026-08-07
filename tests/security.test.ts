import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, listPosts } from '../src/store.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { PHONE, makeTextPayload, registerTestUser } from './helpers.js'

const chatJsonMock = vi.mocked(chatJson)

describe('Webhook message deduplication', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
    chatJsonMock.mockResolvedValue({ action: 'smalltalk', reply: 'Hi! 👋' })
  })

  it('ignores a re-delivered WhatsApp message with the same id', async () => {
    await handleWebhook(makeTextPayload('Hi', 'wamid.dup1'))
    const afterFirst = (await listPosts()).length
    expect(chatJsonMock).toHaveBeenCalledTimes(1)

    await handleWebhook(makeTextPayload('Hi', 'wamid.dup1'))

    expect(chatJsonMock).toHaveBeenCalledTimes(1)
    expect((await listPosts()).length).toBe(afterFirst)
  })

  it('processes distinct message ids normally', async () => {
    await handleWebhook(makeTextPayload('Hi', 'wamid.a'))
    await handleWebhook(makeTextPayload('Hello', 'wamid.b'))
    expect(chatJsonMock).toHaveBeenCalledTimes(2)
  })
})
