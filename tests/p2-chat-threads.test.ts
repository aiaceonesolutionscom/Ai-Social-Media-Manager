import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createChatThread, getChatThread, listChatThreads, touchChatThread, threadPhoneKey, isThreadPhoneKey, resolveUserPhone, logMessage, getMessages, setConversation, getConversation } from '../src/store.js'
import { registerTestUser, PHONE } from './helpers.js'

describe('P1 — web chat sessions (new chat + history)', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
  })

  it('creates a thread owned by the user', async () => {
    const thread = await createChatThread(PHONE)
    expect(thread.id).toBeTruthy()
    expect(thread.phone).toBe(PHONE)
    expect(thread.createdAt).toBeTruthy()
    expect(thread.updatedAt).toBeTruthy()

    const fetched = await getChatThread(thread.id)
    expect(fetched).toBeTruthy()
    expect(fetched!.phone).toBe(PHONE)
  })

  it('synthetic thread key resolves back to the owner phone', async () => {
    const thread = await createChatThread(PHONE)
    const key = threadPhoneKey(thread.id)
    expect(isThreadPhoneKey(key)).toBe(true)
    expect(isThreadPhoneKey(PHONE)).toBe(false)
    expect(await resolveUserPhone(key)).toBe(PHONE)
  })

  it('message history is isolated per thread and does not leak into the shared phone', async () => {
    const thread = await createChatThread(PHONE)
    const threadKey = threadPhoneKey(thread.id)

    await logMessage({ phone: threadKey, role: 'user', type: 'text', content: 'hello thread' })
    await logMessage({ phone: PHONE, role: 'bot', type: 'text', content: 'shared stream' })

    const threadMessages = await getMessages(threadKey)
    const sharedMessages = await getMessages(PHONE)

    expect(threadMessages).toHaveLength(1)
    expect(threadMessages[0].content).toBe('hello thread')
    expect(sharedMessages).toHaveLength(1)
    expect(sharedMessages[0].content).toBe('shared stream')
  })

  it('conversation state is isolated per thread', async () => {
    const thread = await createChatThread(PHONE)
    const threadKey = threadPhoneKey(thread.id)

    await setConversation(threadKey, { kind: 'gathering', postId: 'from-thread' })
    await setConversation(PHONE, { kind: 'gathering', postId: 'from-shared' })

    expect((await getConversation(threadKey)).postId).toBe('from-thread')
    expect((await getConversation(PHONE)).postId).toBe('from-shared')
  })

  it('touchChatThread updates updatedAt', async () => {
    const thread = await createChatThread(PHONE)
    const before = thread.updatedAt
    await new Promise((r) => setTimeout(r, 15))
    await touchChatThread(thread.id)
    const fetched = await getChatThread(thread.id)
    expect(fetched!.updatedAt).not.toBe(before)
  })

  it('listChatThreads returns threads with last-message preview, newest first', async () => {
    const t1 = await createChatThread(PHONE)
    const t2 = await createChatThread(PHONE)
    await logMessage({ phone: threadPhoneKey(t1.id), role: 'user', type: 'text', content: 'first' })
    await logMessage({ phone: threadPhoneKey(t2.id), role: 'user', type: 'text', content: 'second' })
    await touchChatThread(t2.id)

    const threads = await listChatThreads(PHONE)
    expect(threads).toHaveLength(2)
    // newest thread first
    expect(threads[0].id).toBe(t2.id)
    expect(threads[0].lastMessage?.content).toBe('second')
    expect(threads[1].id).toBe(t1.id)
    expect(threads[1].lastMessage?.content).toBe('first')
  })

  it('getChatThread returns undefined for unknown ids', async () => {
    expect(await getChatThread('does-not-exist')).toBeUndefined()
  })
})
