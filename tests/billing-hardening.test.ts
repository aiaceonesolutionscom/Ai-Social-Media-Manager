import { describe, it, expect, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import {
  initStore, resetStore, createUser, createPackage, getUser, getPackage,
  createPost, connectAccount,
  createAIProvider, setActiveAIProvider,
  upsertAICostVersion, createCostVersionProposal, approveCostVersion, rejectCostVersion,
  getActivePricingVersion, listAICostVersions, logAIUsage,
} from '../src/store.js'
import { tokenEngine } from '../src/lib/TokenEngine.js'
import { billingEngine } from '../src/lib/BillingEngine.js'
import { checkProposedMargin } from '../src/lib/profitability.js'
import { providerManager } from '../src/lib/ai/providerManager.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chargeImageRegenerate, refundImageRegenerate } from '../src/pipeline/conversation.js'
import { transcribeAudio } from '../src/lib/stt.js'
import { getDb } from '../src/db.js'
import { eq, and } from 'drizzle-orm'
import { tokenTransactions, aiProviderCostVersions, aiUsageLogs, packages, posts, users } from '../src/db/schema.js'
import { PHONE, makeAudioPayload, registerTestUser } from './helpers.js'
import { deepseekLLM } from '../src/lib/ai/providers/deepseek.js'
import { groqSTT } from '../src/lib/ai/providers/groq.js'
import { openaiImage } from '../src/lib/ai/providers/openai-image.js'

vi.mock('../src/lib/ai/providers/deepseek.js', () => ({
  deepseekLLM: { name: 'deepseek', category: 'llm', chat: vi.fn(), testConnection: vi.fn() },
}))
vi.mock('../src/lib/ai/providers/groq.js', () => ({
  groqSTT: { name: 'groq', category: 'stt', transcribe: vi.fn(), testConnection: vi.fn() },
}))
vi.mock('../src/lib/ai/providers/openai-image.js', () => ({
  openaiImage: { name: 'openai-image', category: 'image', generate: vi.fn(), testConnection: vi.fn() },
}))

const deepseekChatMock = vi.mocked(deepseekLLM.chat)
const groqTranscribeMock = vi.mocked(groqSTT.transcribe)
const openaiImageMock = vi.mocked(openaiImage.generate)
const transcribeMock = vi.mocked(transcribeAudio)

async function countTxnsByOpId(opId: string, type?: string): Promise<number> {
  const rows = await getDb().select().from(tokenTransactions).where(eq(tokenTransactions.operationId, opId))
  return type ? rows.filter((r) => r.type === type).length : rows.length
}

async function countRefundsForPost(postId: string): Promise<number> {
  const rows = await getDb().select().from(tokenTransactions).where(and(eq(tokenTransactions.postId, postId), eq(tokenTransactions.type, 'refund')))
  return rows.length
}

// A single package whose revenue is far above any plausible operator cost — used
// so the margin guard never blocks the propose→approve lifecycle itself.
async function addRichPackage(): Promise<void> {
  await getDb().delete(packages)
  await createPackage({
    name: 'Rich', slug: 'rich', description: 'High value test package',
    priceCents: 10_000_000, includedTokens: 100,
    billingPeriod: 'monthly',
    features: { instagram_publishing: true, facebook_publishing: true, whatsapp_broadcast: true, web_chat: true, voice_transcription: true, ad_campaigns: true },
  })
}

// A single thin-margin package (₹1 / credit) so any non-trivial operator cost
// pushes it into a loss.
async function addThinPackage(): Promise<void> {
  await getDb().delete(packages)
  await createPackage({
    name: 'Thin', slug: 'thin', description: 'Thin margin test package',
    priceCents: 100, includedTokens: 100,
    billingPeriod: 'monthly',
    features: { instagram_publishing: true, facebook_publishing: true, voice_transcription: true },
  })
}

describe('A. Voice Billing — duplicate delivery and failure', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await registerTestUser()
    transcribeMock.mockClear()
  })

  it('delivering the same audio message twice charges exactly once and transcribes once', async () => {
    transcribeMock.mockResolvedValue('Make a post about coffee.')
    const r1 = await handleWebhook(makeAudioPayload('wamid.dup'))
    expect(r1.status).toBe(200)
    const r2 = await handleWebhook(makeAudioPayload('wamid.dup'))
    expect(r2.status).toBe(200)
    expect(transcribeMock).toHaveBeenCalledTimes(1)
    expect(await countTxnsByOpId('voice:wamid.dup', 'deduct')).toBe(1)
    const user = await getUser(PHONE)
    expect(user!.tokensRemaining).toBe(99)
  })

  it('10 concurrent chargeVoiceOnce calls for the same opId → exactly one deduction', async () => {
    await Promise.all(Array.from({ length: 10 }, () => tokenEngine.chargeVoiceOnce('voice:concurrent', PHONE, 'Voice transcription')))
    expect(await countTxnsByOpId('voice:concurrent', 'deduct')).toBe(1)
    const user = await getUser(PHONE)
    expect(user!.tokensRemaining).toBe(99)
  })

  it('STT failure refunds the single charge — balance fully restored', async () => {
    transcribeMock.mockRejectedValue(new Error('upstream stt outage'))
    const r = await handleWebhook(makeAudioPayload('wamid.fail'))
    expect(r.status).toBe(200)
    expect(transcribeMock).toHaveBeenCalledTimes(1)
    expect(await countTxnsByOpId('voice:wamid.fail', 'deduct')).toBe(1)
    expect(await countTxnsByOpId('voice:wamid.fail:refund', 'refund')).toBe(1)
    const user = await getUser(PHONE)
    expect(user!.tokensRemaining).toBe(100)
  })

  it('insufficient credits blocks the provider call entirely', async () => {
    await getDb().update(users).set({ tokensRemaining: 0 }).where(eq(users.phone, PHONE))
    transcribeMock.mockClear()
    const r = await handleWebhook(makeAudioPayload('wamid.nocr'))
    expect(r.status).toBe(200)
    expect(transcribeMock).not.toHaveBeenCalled()
    expect(await countTxnsByOpId('voice:wamid.nocr')).toBe(0)
  })
})

describe('B. Image Regenerate — per-attempt billing', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await registerTestUser()
  })

  it('each NEW regenerate attempt charges again; a retry of the same attempt never double-charges', async () => {
    const post = await createPost(PHONE)
    const a1 = await chargeImageRegenerate(PHONE, post.id)
    expect(a1.charged).toBe(true)
    const a2 = await chargeImageRegenerate(PHONE, post.id, a1.attemptId)
    expect(a2.charged).toBe(false)
    const b1 = await chargeImageRegenerate(PHONE, post.id)
    expect(b1.charged).toBe(true)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(98)
  })

  it('refund for a failed attempt is exactly-once', async () => {
    const post = await createPost(PHONE)
    const a1 = await chargeImageRegenerate(PHONE, post.id)
    await refundImageRegenerate(PHONE, post.id, a1.attemptId)
    await refundImageRegenerate(PHONE, post.id, a1.attemptId)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(100)
    expect(await countTxnsByOpId(`image_regenerate:${post.id}:${a1.attemptId}:refund`, 'refund')).toBe(1)
  })

  it('different posts use distinct attempt ids — no cross-post collision', async () => {
    const p1 = await createPost(PHONE)
    const p2 = await createPost(PHONE)
    const x = await chargeImageRegenerate(PHONE, p1.id)
    const y = await chargeImageRegenerate(PHONE, p2.id)
    expect(x.attemptId).not.toBe(y.attemptId)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(98)
  })
})

describe('C. refundPost — atomic concurrent refund', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await registerTestUser()
  })

  it('10 concurrent refunds of the same post → exactly one refund, balance restored once', async () => {
    const post = await createPost(PHONE)
    await tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'charge')
    await Promise.all(Array.from({ length: 10 }, () => tokenEngine.refundPost(post.id, PHONE, 'refund')))
    expect(await countRefundsForPost(post.id)).toBe(1)
    const user = await getUser(PHONE)
    expect(user!.tokensRemaining).toBe(100)
    const postRow = await getDb().select().from(posts).where(eq(posts.id, post.id))
    expect(postRow[0].tokensCharged).toBe(0)
    expect(postRow[0].refundedAt).not.toBeNull()
  })

  it('refunding an already-refunded post stays a no-op', async () => {
    const post = await createPost(PHONE)
    await tokenEngine.chargePostOnce(post.id, PHONE, 'standard_post', 'charge')
    await tokenEngine.refundPost(post.id, PHONE, 'refund')
    await tokenEngine.refundPost(post.id, PHONE, 'refund')
    expect(await countRefundsForPost(post.id)).toBe(1)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(100)
  })
})

describe('D. Missing Pricing — provider is NOT called', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await registerTestUser()
    deepseekChatMock.mockClear()
    groqTranscribeMock.mockClear()
    openaiImageMock.mockClear()
  })

  async function activateWithoutPricing(category: 'llm' | 'stt' | 'image', providerId: string, provider: string, model: string): Promise<void> {
    const created = await createAIProvider({
      category, provider, displayName: provider.toUpperCase(), apiKey: 'sk-test',
      baseUrl: 'https://api.test.example/v1', model, config: {}, isActive: false, isDefault: false,
    }, false)
    await setActiveAIProvider(created.id, category)
    await getDb().delete(aiProviderCostVersions).where(and(eq(aiProviderCostVersions.provider, provider), eq(aiProviderCostVersions.category, category)))
    await providerManager.reload(category)
  }

  it('LLM: chat is blocked before any adapter call and logs an unpriced row', async () => {
    await activateWithoutPricing('llm', 'deepseek', 'deepseek', 'deepseek-chat')
    await expect(providerManager.chat([{ role: 'user', content: 'hi' }], { phone: PHONE })).rejects.toThrow(/blocked: no pricing configured/)
    expect(deepseekChatMock).not.toHaveBeenCalled()
    const logs = await getDb().select().from(aiUsageLogs).where(and(eq(aiUsageLogs.category, 'llm'), eq(aiUsageLogs.unpriced, true)))
    expect(logs).toHaveLength(1)
    expect(logs[0].estimatedCostCents).toBe(0)
  })

  it('STT: transcribe is blocked before any adapter call and logs an unpriced row', async () => {
    await activateWithoutPricing('stt', 'groq', 'groq', 'whisper-large-v3')
    await expect(providerManager.transcribeAudio('audio/test.ogg', { phone: PHONE })).rejects.toThrow(/blocked: no pricing configured/)
    expect(groqTranscribeMock).not.toHaveBeenCalled()
    const logs = await getDb().select().from(aiUsageLogs).where(and(eq(aiUsageLogs.category, 'stt'), eq(aiUsageLogs.unpriced, true)))
    expect(logs).toHaveLength(1)
  })

  it('IMAGE: generate is blocked before any adapter call and logs an unpriced row', async () => {
    await activateWithoutPricing('image', 'openai', 'openai', 'gpt-image-1-mini')
    await expect(providerManager.generateImage('a sunset', PHONE)).rejects.toThrow(/blocked: no pricing configured/)
    expect(openaiImageMock).not.toHaveBeenCalled()
    const logs = await getDb().select().from(aiUsageLogs).where(and(eq(aiUsageLogs.category, 'image'), eq(aiUsageLogs.unpriced, true)))
    expect(logs).toHaveLength(1)
  })
})

describe('E. Admin-Reviewed Pricing Versioning', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await addRichPackage()
  })

  it('a cost change creates a PENDING proposal and does not touch the active version', async () => {
    const before = await getActivePricingVersion('deepseek', 'llm')
    const proposal = await createCostVersionProposal({ provider: 'deepseek', category: 'llm', inputRate: 200, outputRate: 200 })
    expect(proposal.status).toBe('pending')
    expect(proposal.active).toBe(false)
    const after = await getActivePricingVersion('deepseek', 'llm')
    expect(after!.id).toBe(before!.id)
    expect(after!.version).toBe(1)
  })

  it('approval supersedes the old version (immutable) and activates the proposal', async () => {
    const proposal = await createCostVersionProposal({ provider: 'deepseek', category: 'llm', inputRate: 200, outputRate: 200 })
    const res = await approveCostVersion(proposal.id)
    expect(res.ok).toBe(true)
    const active = await getActivePricingVersion('deepseek', 'llm')
    expect(active!.id).toBe(proposal.id)
    expect(active!.version).toBe(2)
    const versions = await listAICostVersions('deepseek', 'llm')
    const old = versions.find((v) => v.version === 1)!
    expect(old.status).toBe('superseded')
    expect(old.active).toBe(false)
    expect(old.effectiveUntil).not.toBeNull()
    expect(old.inputRate).toBe(27) // seeded rate — the old row is NEVER mutated
  })

  it('approving an already-approved or rejected version fails', async () => {
    const proposal = await createCostVersionProposal({ provider: 'deepseek', category: 'llm', inputRate: 200, outputRate: 200 })
    expect((await approveCostVersion(proposal.id)).ok).toBe(true)
    const again = await approveCostVersion(proposal.id)
    expect(again.ok).toBe(false)
    const rejected = await createCostVersionProposal({ provider: 'deepseek', category: 'llm', inputRate: 5, outputRate: 5 })
    expect((await rejectCostVersion(rejected.id)).ok).toBe(true)
    const afterReject = await approveCostVersion(rejected.id)
    expect(afterReject.ok).toBe(false)
    const list = await listAICostVersions('deepseek', 'llm')
    expect(list.find((v) => v.id === rejected.id)!.status).toBe('rejected')
  })

  it('approval re-runs the margin guard — loss-making proposals are rejected', async () => {
    await addThinPackage()
    const proposal = await createCostVersionProposal({ provider: 'deepseek', category: 'llm', inputRate: 100000, outputRate: 100000 })
    const res = await approveCostVersion(proposal.id)
    expect(res.ok).toBe(false)
    expect(res.marginStatus).toBe('BLOCK')
    expect(res.lossPackages.length).toBeGreaterThan(0)
    const active = await getActivePricingVersion('deepseek', 'llm')
    expect(active!.version).toBe(1) // old pricing still active — nothing was applied
  })

  it('usage logged under an approved version stays pinned after a later approval', async () => {
    const v1 = await getActivePricingVersion('deepseek', 'llm')
    await logAIUsage({
      phone: PHONE, providerId: 'deepseek', category: 'llm', model: 'deepseek-chat',
      feature: 'chat', tokensInput: 1000, tokensOutput: 500, estimatedCostCents: 3, durationMs: 10,
      success: true, pricingVersionId: v1!.id,
    })
    const proposal = await createCostVersionProposal({ provider: 'deepseek', category: 'llm', inputRate: 200, outputRate: 200 })
    await approveCostVersion(proposal.id)
    const cost = await billingEngine.getUserCost(PHONE)
    expect(cost.totalCost).toBe(3)
    expect(cost.byProvider['deepseek:deepseek-chat']).toBe(3)
  })
})

describe('F. Margin Guard — BLOCK / WARNING / PROFITABLE', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await addThinPackage()
  })

  const override = (imageRate: number) => [
    { provider: 'deepseek', category: 'llm' as const, inputRate: 0, outputRate: 0, imageRate: 0, audioRate: 0 },
    { provider: 'openai', category: 'image' as const, inputRate: 0, outputRate: 0, imageRate, audioRate: 0 },
    { provider: 'openai-stt', category: 'stt' as const, inputRate: 0, outputRate: 0, imageRate: 0, audioRate: 0 },
  ]

  it('image cost > revenue → BLOCK (package would run at a loss)', async () => {
    const r = await checkProposedMargin(override(2.0))
    expect(r.result).toBe('BLOCK')
    expect(r.lossPackages).toContain('Thin')
  })

  it('image cost at 20% margin → WARNING', async () => {
    const r = await checkProposedMargin(override(0.8))
    expect(r.result).toBe('WARNING')
    expect(r.lowMarginPackages).toContain('Thin')
  })

  it('image cost at 50% margin → PROFITABLE', async () => {
    const r = await checkProposedMargin(override(0.5))
    expect(r.result).toBe('PROFITABLE')
    expect(r.lossPackages).toHaveLength(0)
    expect(r.lowMarginPackages).toHaveLength(0)
  })
})

describe('G. Credit Independence + Provider Switching', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await registerTestUser()
  })

  it('provider pricing changes NEVER touch customer credits, packages, or ledgers', async () => {
    const before = await getUser(PHONE)
    expect(before!.tokensRemaining).toBe(100)
    await upsertAICostVersion({ provider: 'deepseek', category: 'llm', inputRate: 9999, outputRate: 9999 })
    const proposal = await createCostVersionProposal({ provider: 'deepseek', category: 'llm', inputRate: 7777, outputRate: 7777 })
    await approveCostVersion(proposal.id)
    const after = await getUser(PHONE)
    expect(after!.tokensRemaining).toBe(100)
    expect(after!.packageId).toBe(before!.packageId)
    const txns = await getDb().select().from(tokenTransactions).where(eq(tokenTransactions.phone, PHONE))
    expect(txns).toHaveLength(0)

    const post = await createPost(PHONE)
    await tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'charge')
    expect((await getUser(PHONE))!.tokensRemaining).toBe(98)
  })

  it('switching providers logs the new provider/model/version; old usage keeps its pinned version', async () => {
    const v1 = await getActivePricingVersion('deepseek', 'llm')
    await logAIUsage({
      phone: PHONE, providerId: 'deepseek', category: 'llm', model: 'deepseek-chat',
      feature: 'chat', tokensInput: 1000, tokensOutput: 500, estimatedCostCents: 1, durationMs: 10,
      success: true, pricingVersionId: v1!.id,
    })
    const openai = await createAIProvider({
      category: 'llm', provider: 'openai', displayName: 'OpenAI', apiKey: 'sk-o',
      baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', config: {}, isActive: false, isDefault: false,
    }, false)
    await setActiveAIProvider(openai.id, 'llm')
    const v2 = await upsertAICostVersion({ provider: 'openai', category: 'llm', inputRate: 250, outputRate: 1000 })
    await logAIUsage({
      phone: PHONE, providerId: 'openai', category: 'llm', model: 'gpt-4o',
      feature: 'chat', tokensInput: 2000, tokensOutput: 1000, estimatedCostCents: 4, durationMs: 10,
      success: true, pricingVersionId: v2.id,
    })
    const cost = await billingEngine.getUserCost(PHONE)
    expect(cost.byProvider['deepseek:deepseek-chat']).toBe(1)
    expect(cost.byProvider['openai:gpt-4o']).toBe(4)
    const oldLog = await getDb().select().from(aiUsageLogs).where(and(eq(aiUsageLogs.providerId, 'deepseek'), eq(aiUsageLogs.model, 'deepseek-chat')))
    expect(oldLog[0].pricingVersionId).toBe(v1!.id)
  })
})

describe('H. Schema — multiple inactive versions allowed, single active', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await addRichPackage()
  })

  it('several pending proposals for the same provider/category coexist; only the approved one becomes active', async () => {
    const p1 = await createCostVersionProposal({ provider: 'openai', category: 'image', inputRate: 0, outputRate: 0, imageRate: 10 })
    const p2 = await createCostVersionProposal({ provider: 'openai', category: 'image', inputRate: 0, outputRate: 0, imageRate: 20 })
    const p3 = await createCostVersionProposal({ provider: 'openai', category: 'image', inputRate: 0, outputRate: 0, imageRate: 30 })
    const versions = await listAICostVersions('openai', 'image')
    expect(versions.filter((v) => v.status === 'pending')).toHaveLength(3)
    await approveCostVersion(p2.id)
    const active = await getActivePricingVersion('openai', 'image')
    expect(active!.id).toBe(p2.id)
    expect(active!.imageRate).toBe(20)
    const still = await listAICostVersions('openai', 'image')
    expect(still.filter((v) => v.active)).toHaveLength(1)
    expect(p1.id).not.toBe(p2.id)
    expect(p3.id).not.toBe(p2.id)
  })
})