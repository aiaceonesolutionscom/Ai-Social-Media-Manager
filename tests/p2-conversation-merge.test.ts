import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, setConversation, getConversation } from '../src/store.js'
import { PHONE } from './helpers.js'

describe('P2-9 — same-kind transitions merge gathered context instead of wiping it', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
  })

  it('gathering keeps previously gathered intent fields', async () => {
    await setConversation(PHONE, { kind: 'gathering', postId: 'p1', intent: { topic: 'shoes', tone: 'casual' } })
    await setConversation(PHONE, { kind: 'gathering', postId: 'p1', intent: { audience: 'young adults' } })

    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('gathering')
    const g = conv as { intent: Record<string, unknown> }
    expect(g.intent.topic).toBe('shoes')
    expect(g.intent.tone).toBe('casual')
    expect(g.intent.audience).toBe('young adults')
  })

  it('ad_gathering keeps gathered adData when a later update only changes step/data', async () => {
    await setConversation(PHONE, {
      kind: 'ad_gathering',
      postId: 'p2',
      step: 'budget',
      data: { budget: 100 },
      adData: { product: 'shoes', budget: 100 },
    })
    // Caller advances the step and adds a location without re-passing adData.
    await setConversation(PHONE, {
      kind: 'ad_gathering',
      postId: 'p2',
      step: 'location',
      data: { location: 'Karachi' },
      adData: {},
    })

    const conv = await getConversation(PHONE) as { step: string; data: Record<string, unknown>; adData: Record<string, unknown> }
    expect(conv.step).toBe('location')
    expect(conv.data.budget).toBe(100)
    expect(conv.data.location).toBe('Karachi')
    expect(conv.adData.product).toBe('shoes')
    expect(conv.adData.budget).toBe(100)
  })

  it('a fresh adData object replaces stale ad data instead of leaking it', async () => {
    await setConversation(PHONE, {
      kind: 'ad_gathering',
      postId: 'p3',
      step: 'budget',
      data: {},
      adData: { product: 'old product' },
    })
    await setConversation(PHONE, {
      kind: 'ad_gathering',
      postId: 'p3',
      step: 'topic',
      data: {},
      adData: { product: 'new product', budget: 50 },
    })

    const conv = await getConversation(PHONE) as { adData: Record<string, unknown> }
    expect(conv.adData.product).toBe('new product')
    expect(conv.adData.budget).toBe(50)
    expect(conv.adData).not.toHaveProperty('location')
  })

  it('ad_preview keeps adData when re-previewing the same ad', async () => {
    await setConversation(PHONE, { kind: 'ad_preview', postId: 'p4', adData: { product: 'shoes' } })
    await setConversation(PHONE, { kind: 'ad_preview', postId: 'p4' })

    const conv = await getConversation(PHONE) as { adData: Record<string, unknown> }
    expect(conv.kind).toBe('ad_preview')
    expect(conv.adData.product).toBe('shoes')
  })

  it('cross-kind transitions still replace wholesale', async () => {
    await setConversation(PHONE, { kind: 'gathering', postId: 'p5', intent: { topic: 'shoes' } })
    await setConversation(PHONE, { kind: 'awaiting_approval', postId: 'p5' })

    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('awaiting_approval')
    expect((conv as { intent?: unknown }).intent).toBeUndefined()
  })

  it('idle never inherits a stale postId', async () => {
    await setConversation(PHONE, { kind: 'idle', postId: 'p6' })
    await setConversation(PHONE, { kind: 'idle' })

    const conv = await getConversation(PHONE)
    expect(conv.kind).toBe('idle')
    expect((conv as { postId?: string }).postId).toBeUndefined()
  })
})