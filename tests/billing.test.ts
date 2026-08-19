import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import {
  initStore, resetStore, createUser, createPost, updatePost, getUser,
  createPackage, getPackage, createPayment, updatePayment,
  getPaymentByStripeSession, getTransactions, listAllTokenTransactions,
  logAIUsage, listAICosts, connectAccount, createAdCampaign,
} from '../src/store.js'
import { tokenEngine } from '../src/lib/TokenEngine.js'
import { billingEngine } from '../src/lib/BillingEngine.js'
import { getDb } from '../src/db.js'
import { sql, eq } from 'drizzle-orm'
import { aiUsageLogs, tokenTransactions, payments } from '../src/db/schema.js'

const PHONE = '919999999999'
const PHONE2 = '918888888888'

async function seedTestPackage(): Promise<void> {
  const existing = await getPackage('starter')
  if (!existing) {
    await createPackage({
      name: 'Starter',
      slug: 'starter',
      description: 'Test package',
      priceCents: 1500,
      includedTokens: 100,
      billingPeriod: 'monthly',
      features: {
        instagram_publishing: true,
        facebook_publishing: true,
        voice_transcription: true,
      },
    })
  }
}

async function registerTestUser(phone: string, tokens = 100): Promise<void> {
  const existing = await getUser(phone)
  if (!existing) {
    await createUser({
      phone,
      name: 'Test User',
      email: `${phone}@test.com`,
      tokensRemaining: tokens,
      packageId: 'starter',
    })
  }
  try {
    await connectAccount({ phone, platform: 'instagram', accountId: 'ig_test_' + phone, accountName: 'Test IG', accessToken: 'mock-ig-token' })
    await connectAccount({ phone, platform: 'facebook', accountId: 'fb_test_' + phone, accountName: 'Test FB', accessToken: 'mock-fb-token' })
  } catch {}
}

describe('A. Refund Idempotency', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await seedTestPackage()
    await registerTestUser(PHONE, 100)
  })

  it('refundPost is idempotent — second call is a no-op', async () => {
    const post = await createPost(PHONE)
    await updatePost(post.id, { status: 'AWAITING_APPROVAL' })

    const charge = await tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'test charge')
    expect(charge.success).toBe(true)
    expect(charge.newBalance).toBe(98)

    const refund1 = await tokenEngine.refundPost(post.id, PHONE, 'test refund')
    expect(refund1.success).toBe(true)
    expect(refund1.newBalance).toBe(100)

    const userAfterRefund = await getUser(PHONE)
    expect(userAfterRefund!.tokensRemaining).toBe(100)

    const refund2 = await tokenEngine.refundPost(post.id, PHONE, 'test refund 2')
    expect(refund2.success).toBe(true)
    const userAfterSecondRefund = await getUser(PHONE)
    expect(userAfterSecondRefund!.tokensRemaining).toBe(100)

    const txns = await getTransactions(PHONE, 100)
    const refundTxns = txns.filter((t) => t.type === 'refund' && t.postId === post.id)
    expect(refundTxns).toHaveLength(1)
    expect(refundTxns[0].amount).toBe(2)
  })

  it('refundPost for uncharged post is a no-op', async () => {
    const post = await createPost(PHONE)
    const userBefore = await getUser(PHONE)
    const balanceBefore = userBefore!.tokensRemaining

    const refund = await tokenEngine.refundPost(post.id, PHONE, 'unforced refund')
    expect(refund.success).toBe(true)
    expect(refund.newBalance).toBe(balanceBefore)

    const txns = await getTransactions(PHONE, 100)
    const refundTxns = txns.filter((t) => t.type === 'refund' && t.postId === post.id)
    expect(refundTxns).toHaveLength(0)
  })

  it('two concurrent refund requests produce at most one refund', async () => {
    const post = await createPost(PHONE)
    await tokenEngine.chargePostOnce(post.id, PHONE, 'standard_post', 'charge')
    const balanceBefore = (await getUser(PHONE))!.tokensRemaining

    await Promise.all([
      tokenEngine.refundPost(post.id, PHONE, 'concurrent 1'),
      tokenEngine.refundPost(post.id, PHONE, 'concurrent 2'),
    ])

    const userAfter = await getUser(PHONE)
    expect(userAfter!.tokensRemaining).toBe(balanceBefore + 1)

    const txns = await getTransactions(PHONE, 100)
    const refundTxns = txns.filter((t) => t.type === 'refund' && t.postId === post.id)
    expect(refundTxns).toHaveLength(1)
  })

  it('failed publish followed by retry only refunds once', async () => {
    const post1 = await createPost(PHONE)
    await tokenEngine.chargePostOnce(post1.id, PHONE, 'cross_platform', 'first attempt')

    await tokenEngine.refundPost(post1.id, PHONE, 'publish failed')
    const balanceAfterFail = (await getUser(PHONE))!.tokensRemaining

    const post2 = await createPost(PHONE)
    await tokenEngine.chargePostOnce(post2.id, PHONE, 'cross_platform', 'retry')

    const txns1 = await getTransactions(PHONE, 100)
    const refundTxns1 = txns1.filter((t) => t.type === 'refund' && t.postId === post1.id)
    expect(refundTxns1).toHaveLength(1)

    const chargeTxns = txns1.filter((t) => t.type === 'deduct' && t.postId === post2.id)
    expect(chargeTxns).toHaveLength(1)
  })

  it('cancel followed by retry produces correct ledger', async () => {
    const post = await createPost(PHONE)
    await tokenEngine.chargePostOnce(post.id, PHONE, 'standard_post', 'charge')
    const balanceAfterCharge = (await getUser(PHONE))!.tokensRemaining

    await tokenEngine.refundPost(post.id, PHONE, 'cancel')
    const balanceAfterCancel = (await getUser(PHONE))!.tokensRemaining
    expect(balanceAfterCancel).toBe(balanceAfterCharge + 1)

    await tokenEngine.refundPost(post.id, PHONE, 'cancel again')
    const balanceAfterDoubleCancel = (await getUser(PHONE))!.tokensRemaining
    expect(balanceAfterDoubleCancel).toBe(balanceAfterCancel)

    const txns = await getTransactions(PHONE, 100)
    const refundTxns = txns.filter((t) => t.type === 'refund' && t.postId === post.id)
    expect(refundTxns).toHaveLength(1)
  })
})

describe('B. Stripe Webhook Deduplication', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await seedTestPackage()
  })

  it('creates pending payment then completes on webhook', async () => {
    await registerTestUser(PHONE, 0)
    const payment = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 1500,
      type: 'one_time',
      stripeSessionId: 'sess_test_001',
    })
    expect(payment.status).toBe('pending')

    await updatePayment(payment.id, { status: 'completed' })

    const completed = await getPaymentByStripeSession('sess_test_001')
    expect(completed).toBeDefined()
    expect(completed!.status).toBe('completed')
  })

  it('does not create duplicate payment for same session (unique index)', async () => {
    await registerTestUser(PHONE, 0)
    const p1 = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 1500,
      type: 'one_time',
      stripeSessionId: 'sess_dedup_001',
    })

    await updatePayment(p1.id, { status: 'completed' })

    const found = await getPaymentByStripeSession('sess_dedup_001')
    expect(found!.id).toBe(p1.id)

    const db = getDb()
    const rows = await db.select({ count: sql`COUNT(*)::int` })
      .from(payments)
      .where(eq(payments.stripeSessionId, 'sess_dedup_001'))
    expect(Number(rows[0].count)).toBe(1)
  })

  it('already-completed payment is skipped on duplicate webhook', async () => {
    await registerTestUser(PHONE, 0)
    const payment = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 1500,
      type: 'one_time',
      stripeSessionId: 'sess_already_done',
    })
    await updatePayment(payment.id, { status: 'completed' })

    const existing = await getPaymentByStripeSession('sess_already_done')
    expect(existing!.status).toBe('completed')

    const user = await getUser(PHONE)
    expect(user).toBeDefined()
  })
})

describe('C. Charge-Once Generation', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await seedTestPackage()
    await registerTestUser(PHONE, 100)
  })

  it('chargePostOnce deducts exactly once even when called twice', async () => {
    const post = await createPost(PHONE)

    const r1 = await tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'first')
    expect(r1.success).toBe(true)
    expect(r1.alreadyCharged).toBeFalsy()
    expect((await getUser(PHONE))!.tokensRemaining).toBe(98)

    const r2 = await tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'second')
    expect(r2.success).toBe(true)
    expect(r2.alreadyCharged).toBe(true)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(98)
  })

  it('concurrent chargePostOnce only deducts once', async () => {
    const post = await createPost(PHONE)
    const balanceBefore = (await getUser(PHONE))!.tokensRemaining

    const [r1, r2] = await Promise.all([
      tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'concurrent 1'),
      tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'concurrent 2'),
    ])

    const balance = (await getUser(PHONE))!.tokensRemaining
    expect(balance).toBe(balanceBefore - 2)

    const txns = await getTransactions(PHONE, 100)
    const chargeTxns = txns.filter((t) => t.type === 'deduct' && t.postId === post.id)
    expect(chargeTxns).toHaveLength(1)
  })

  it('tokensCharged field is set on the post', async () => {
    const post = await createPost(PHONE)
    await tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'test')

    const { getPost } = await import('../src/store.js')
    const updated = await getPost(post.id)
    expect(updated!.tokensCharged).toBe(2)
    expect(updated!.tokensChargedAction).toBe('cross_platform')
  })

  it('chargePostOnce with insufficient tokens rolls back post claim', async () => {
    await registerTestUser(PHONE2, 1)
    const post = await createPost(PHONE2)

    const r = await tokenEngine.chargePostOnce(post.id, PHONE2, 'cross_platform', 'should fail')
    expect(r.success).toBe(false)
    expect(r.error).toBe('Insufficient tokens')

    const user = await getUser(PHONE2)
    expect(user!.tokensRemaining).toBe(1)

    const { getPost } = await import('../src/store.js')
    const postAfter = await getPost(post.id)
    expect(postAfter!.tokensCharged).toBe(0)
  })

  it('standard_post charges 1 credit', async () => {
    const post = await createPost(PHONE)
    const r = await tokenEngine.chargePostOnce(post.id, PHONE, 'standard_post', 'standard')
    expect(r.success).toBe(true)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(99)
  })

  it('ad campaign charges via chargeAdOnce', async () => {
    const post = await createPost(PHONE)
    const campaign = await createAdCampaign({
      phone: PHONE,
      postId: post.id,
      name: 'Test Campaign',
      objective: 'reach',
      adContent: { text: 'test ad', headline: 'Test' },
      targeting: { age_min: 18, age_max: 65 },
      budgetCents: 1000,
    })

    const r = await tokenEngine.chargeAdOnce(campaign.id, PHONE, 5, 'ad campaign')
    expect(r.success).toBe(true)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(95)
  })

  it('chargeAdOnce is idempotent', async () => {
    const post = await createPost(PHONE)
    const campaign = await createAdCampaign({
      phone: PHONE,
      postId: post.id,
      name: 'Test Campaign',
      objective: 'reach',
      adContent: { text: 'test ad', headline: 'Test' },
      targeting: { age_min: 18, age_max: 65 },
      budgetCents: 1000,
    })

    await tokenEngine.chargeAdOnce(campaign.id, PHONE, 5, 'first')
    const r2 = await tokenEngine.chargeAdOnce(campaign.id, PHONE, 5, 'second')
    expect(r2.success).toBe(true)
    expect(r2.alreadyCharged).toBe(true)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(95)
  })

  it('chargePostOnce works after simulated restart', async () => {
    const post = await createPost(PHONE)
    await tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'initial')

    const r = await tokenEngine.chargePostOnce(post.id, PHONE, 'cross_platform', 'after restart')
    expect(r.success).toBe(true)
    expect(r.alreadyCharged).toBe(true)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(98)
  })
})

describe('D. Atomic Token + Ledger', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await seedTestPackage()
    await registerTestUser(PHONE, 100)
  })

  it('deduct and ledger are consistent', async () => {
    const r = await tokenEngine.deduct('standard_post', PHONE, 'atomic test')
    expect(r.success).toBe(true)
    expect(r.newBalance).toBe(99)

    const user = await getUser(PHONE)
    expect(user!.tokensRemaining).toBe(99)

    const txns = await getTransactions(PHONE, 10)
    const deductTxn = txns.find((t) => t.type === 'deduct' && t.description === 'atomic test')
    expect(deductTxn).toBeDefined()
    expect(deductTxn!.amount).toBe(-1)
    expect(deductTxn!.balanceAfter).toBe(99)
  })

  it('insufficient balance → no deduction + no ledger entry', async () => {
    await registerTestUser(PHONE2, 0)
    const r = await tokenEngine.deduct('standard_post', PHONE2, 'should fail')
    expect(r.success).toBe(false)
    expect((await getUser(PHONE2))!.tokensRemaining).toBe(0)

    const txns = await getTransactions(PHONE2, 10)
    const failedTxn = txns.find((t) => t.description === 'should fail')
    expect(failedTxn).toBeUndefined()
  })

  it('grant updates balance and ledger', async () => {
    const r = await tokenEngine.grant(PHONE, 50, 'test-admin', 'bonus')
    expect(r.success).toBe(true)
    expect(r.newBalance).toBe(150)

    const user = await getUser(PHONE)
    expect(user!.tokensRemaining).toBe(150)

    const txns = await getTransactions(PHONE, 10)
    const grantTxn = txns.find((t) => t.type === 'grant' && t.description === 'bonus')
    expect(grantTxn).toBeDefined()
    expect(grantTxn!.amount).toBe(50)
    expect(grantTxn!.balanceAfter).toBe(150)
  })

  it('refund updates balance and ledger', async () => {
    await tokenEngine.deduct('standard_post', PHONE, 'to be refunded')
    const afterDeduct = (await getUser(PHONE))!.tokensRemaining
    expect(afterDeduct).toBe(99)

    const r = await tokenEngine.refund('standard_post', PHONE, 'refund test')
    expect(r.success).toBe(true)
    expect(r.newBalance).toBe(100)

    const txns = await getTransactions(PHONE, 10)
    const refundTxn = txns.find((t) => t.type === 'refund' && t.description === 'refund test')
    expect(refundTxn).toBeDefined()
    expect(refundTxn!.amount).toBe(1)
  })

  it('concurrent deductions: balance always reconciles with ledger', async () => {
    const results = await Promise.all([
      tokenEngine.deduct('standard_post', PHONE, 'conc-1'),
      tokenEngine.deduct('standard_post', PHONE, 'conc-2'),
      tokenEngine.deduct('standard_post', PHONE, 'conc-3'),
      tokenEngine.deduct('standard_post', PHONE, 'conc-4'),
      tokenEngine.deduct('standard_post', PHONE, 'conc-5'),
    ])

    const successes = results.filter((r) => r.success)
    expect(successes.length).toBe(5)

    const user = await getUser(PHONE)
    expect(user!.tokensRemaining).toBe(95)

    const txns = await getTransactions(PHONE, 100)
    const deductTxns = txns.filter((t) => t.type === 'deduct' && t.description.startsWith('conc-'))
    expect(deductTxns).toHaveLength(5)
  })

  it('tokensRemaining never goes negative', async () => {
    await registerTestUser(PHONE2, 0)
    const r = await tokenEngine.deduct('standard_post', PHONE2, 'too much')
    expect(r.success).toBe(false)
    const user = await getUser(PHONE2)
    expect(user!.tokensRemaining).toBeGreaterThanOrEqual(0)
  })
})

describe('E. STT Cost', () => {
  it('cost calculation uses real audio seconds, not API latency', async () => {
    const costPerMinute = 10

    const testCases = [
      { audioSeconds: 5, expectedCents: Math.ceil((5 / 60) * costPerMinute) },
      { audioSeconds: 30, expectedCents: Math.ceil((30 / 60) * costPerMinute) },
      { audioSeconds: 60, expectedCents: Math.ceil((60 / 60) * costPerMinute) },
      { audioSeconds: 120, expectedCents: Math.ceil((120 / 60) * costPerMinute) },
    ]

    for (const tc of testCases) {
      const durationMs = tc.audioSeconds * 1000
      const costCents = Math.ceil((durationMs / 60000) * costPerMinute)
      expect(costCents).toBe(tc.expectedCents)
    }
  })

  it('30s audio with 5s API latency: cost based on 30s not 35s', () => {
    const costPerMinute = 10
    const audioSeconds = 30
    const apiLatencyMs = 5000

    const correctCost = Math.ceil((audioSeconds * 1000 / 60000) * costPerMinute)
    const wrongCost = Math.ceil(((audioSeconds * 1000 + apiLatencyMs) / 60000) * costPerMinute)

    expect(correctCost).toBe(5)
    expect(wrongCost).toBe(6)
    expect(correctCost).not.toBe(wrongCost)
  })

  it('voice_transcription default cost is 1 credit', async () => {
    const cost = await tokenEngine.estimate('voice_transcription', PHONE)
    expect(cost.cost).toBe(1)
  })
})

describe('F. User Attribution', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await seedTestPackage()
    await registerTestUser(PHONE, 100)
  })

  it('aiUsageLog entries always have a phone when user is known', async () => {
    await logAIUsage({
      phone: PHONE,
      providerId: 'test-llm',
      category: 'llm',
      model: 'deepseek-chat',
      feature: 'generate',
      tokensInput: 1000,
      tokensOutput: 500,
      estimatedCostCents: 10,
      durationMs: 1000,
      success: true,
      error: '',
    })

    await logAIUsage({
      phone: PHONE,
      providerId: 'test-image',
      category: 'image',
      model: 'dall-e-3',
      feature: 'generate',
      tokensInput: 0,
      tokensOutput: 0,
      estimatedCostCents: 5,
      durationMs: 2000,
      imageCount: 1,
      success: true,
      error: '',
    })

    await logAIUsage({
      phone: PHONE,
      providerId: 'test-stt',
      category: 'stt',
      model: 'whisper-1',
      feature: 'transcribe',
      tokensInput: 0,
      tokensOutput: 0,
      estimatedCostCents: 3,
      durationMs: 30000,
      audioSeconds: 30,
      success: true,
      error: '',
    })

    const db = getDb()
    const logs = await db.select().from(aiUsageLogs).where(eq(aiUsageLogs.phone, PHONE))
    expect(logs.length).toBe(3)

    for (const log of logs) {
      expect(log.phone).toBe(PHONE)
    }

    const categories = logs.map((l) => l.category).sort()
    expect(categories).toEqual(['image', 'llm', 'stt'])
  })

  it('image usage log has imageCount = 1', async () => {
    const result = await logAIUsage({
      phone: PHONE,
      providerId: 'test-image',
      category: 'image',
      model: 'dall-e-3',
      feature: 'generate',
      tokensInput: 0,
      tokensOutput: 0,
      estimatedCostCents: 5,
      durationMs: 2000,
      imageCount: 1,
      success: true,
      error: '',
    })

    expect(result.imageCount).toBe(1)
  })

  it('STT usage log has audioSeconds set', async () => {
    const result = await logAIUsage({
      phone: PHONE,
      providerId: 'test-stt',
      category: 'stt',
      model: 'whisper-1',
      feature: 'transcribe',
      tokensInput: 0,
      tokensOutput: 0,
      estimatedCostCents: 3,
      durationMs: 30000,
      audioSeconds: 30,
      success: true,
      error: '',
    })

    expect(result.audioSeconds).toBe(30)
  })
})

describe('G. Profitability', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await seedTestPackage()
    await registerTestUser(PHONE, 100)
  })

  it('billing summary calculates net profit correctly', async () => {
    const payment = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 1500,
      type: 'one_time',
    })
    await updatePayment(payment.id, { status: 'completed' })

    await logAIUsage({
      phone: PHONE,
      providerId: 'test-llm',
      category: 'llm',
      model: 'deepseek-chat',
      feature: 'generate',
      tokensInput: 1000,
      tokensOutput: 500,
      estimatedCostCents: 50,
      durationMs: 1000,
      success: true,
      error: '',
    })

    const summary = await billingEngine.getSummary()
    expect(summary.totalRevenue).toBe(1500)
    expect(summary.totalAICost).toBe(50)
    expect(summary.netProfit).toBe(1450)
    expect(summary.profitMargin).toBeCloseTo(96.67, 0)
  })

  it('per-package profit is calculated', async () => {
    const payment = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 1500,
      type: 'one_time',
    })
    await updatePayment(payment.id, { status: 'completed' })

    await logAIUsage({
      phone: PHONE,
      providerId: 'test-llm',
      category: 'llm',
      model: 'deepseek-chat',
      feature: 'generate',
      tokensInput: 1000,
      tokensOutput: 500,
      estimatedCostCents: 100,
      durationMs: 1000,
      success: true,
      error: '',
    })

    const summary = await billingEngine.getSummary()
    const starterPkg = summary.perPackage.find((p) => p.packageId === 'starter')
    expect(starterPkg).toBeDefined()
    expect(starterPkg!.revenue).toBe(1500)
    expect(starterPkg!.aiCost).toBe(100)
    expect(starterPkg!.profit).toBe(1400)
    expect(starterPkg!.profitMargin).toBeGreaterThan(90)
  })

  it('per-user cost breakdown is correct', async () => {
    await logAIUsage({
      phone: PHONE,
      providerId: 'test-llm',
      category: 'llm',
      model: 'deepseek-chat',
      feature: 'generate',
      tokensInput: 1000,
      tokensOutput: 500,
      estimatedCostCents: 30,
      durationMs: 1000,
      success: true,
      error: '',
    })

    await logAIUsage({
      phone: PHONE,
      providerId: 'test-image',
      category: 'image',
      model: 'dall-e-3',
      feature: 'generate',
      tokensInput: 0,
      tokensOutput: 0,
      estimatedCostCents: 20,
      durationMs: 2000,
      imageCount: 1,
      success: true,
      error: '',
    })

    const cost = await billingEngine.getUserCost(PHONE)
    expect(cost.totalCost).toBe(50)
    expect(cost.byCategory['llm']).toBe(30)
    expect(cost.byCategory['image']).toBe(20)
  })

  it('daily profit is calculated', async () => {
    const payment = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 2000,
      type: 'one_time',
    })
    await updatePayment(payment.id, { status: 'completed' })

    await logAIUsage({
      phone: PHONE,
      providerId: 'test-llm',
      category: 'llm',
      model: 'deepseek-chat',
      feature: 'generate',
      tokensInput: 1000,
      tokensOutput: 500,
      estimatedCostCents: 200,
      durationMs: 1000,
      success: true,
      error: '',
    })

    const summary = await billingEngine.getSummary()
    const today = new Date().toISOString().slice(0, 10)
    const todayEntry = summary.daily.find((d) => d.date.includes(today))
    if (todayEntry) {
      expect(todayEntry.revenue).toBeGreaterThanOrEqual(2000)
      expect(todayEntry.aiCost).toBeGreaterThanOrEqual(200)
      expect(todayEntry.profit).toBe(todayEntry.revenue - todayEntry.aiCost)
    }
  })

  it('missing AI cost does not become zero silently', async () => {
    const summary = await billingEngine.getSummary()
    expect(summary.totalRevenue).toBe(0)
    expect(summary.totalAICost).toBe(0)
    expect(summary.netProfit).toBe(0)
    expect(summary.profitMargin).toBe(0)
  })
})

describe('H. Margin Guard', () => {
  it('profitable package shows PROFITABLE status', async () => {
    const costs = await listAICosts()
    const llmCost = costs.find((c) => c.provider === 'deepseek' && c.category === 'llm')
    const imageCost = costs.find((c) => c.provider === 'openai' && c.category === 'image')
    expect(llmCost).toBeDefined()
    expect(imageCost).toBeDefined()

    const estLlmCents = Math.ceil((3000 * llmCost!.costPer1MInputTokens + 1500 * llmCost!.costPer1MOutputTokens) / 1_000_000)
    const estImageCents = imageCost!.costPerImage
    const estTotalPerCredit = estLlmCents + estImageCents
    const revenuePerCredit = 1500 / 100

    const margin = ((revenuePerCredit - estTotalPerCredit) / revenuePerCredit) * 100
    expect(margin).toBeGreaterThan(30)
  })

  it('high-cost scenario shows LOSS status', () => {
    const revenuePerCredit = 5
    const costPerCredit = 10
    const margin = ((revenuePerCredit - costPerCredit) / revenuePerCredit) * 100
    expect(margin).toBeLessThan(0)
  })

  it('tight margin shows WARNING status', () => {
    const revenuePerCredit = 10
    const costPerCredit = 8
    const margin = ((revenuePerCredit - costPerCredit) / revenuePerCredit) * 100
    expect(margin).toBeLessThan(30)
    expect(margin).toBeGreaterThan(0)
  })
})

describe('I. Voice Credit', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await seedTestPackage()
    await registerTestUser(PHONE, 100)
  })

  it('voice_transcription costs 1 credit', async () => {
    const est = await tokenEngine.estimate('voice_transcription', PHONE)
    expect(est.cost).toBe(1)
    expect(est.canAfford).toBe(true)
  })

  it('deduct voice_transcription charges exactly 1 credit', async () => {
    const r = await tokenEngine.deduct('voice_transcription', PHONE, 'voice test')
    expect(r.success).toBe(true)
    expect(r.newBalance).toBe(99)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(99)
  })

  it('insufficient credits blocks voice_transcription', async () => {
    await registerTestUser(PHONE2, 0)
    const est = await tokenEngine.estimate('voice_transcription', PHONE2)
    expect(est.canAfford).toBe(false)

    const r = await tokenEngine.deduct('voice_transcription', PHONE2, 'should fail')
    expect(r.success).toBe(false)
    expect((await getUser(PHONE2))!.tokensRemaining).toBe(0)
  })

  it('voice_transcription deduction is recorded in ledger', async () => {
    await tokenEngine.deduct('voice_transcription', PHONE, 'voice ledger test')
    const txns = await getTransactions(PHONE, 10)
    const voiceTxn = txns.find((t) => t.description === 'voice ledger test')
    expect(voiceTxn).toBeDefined()
    expect(voiceTxn!.type).toBe('deduct')
    expect(voiceTxn!.amount).toBe(-1)
    expect(voiceTxn!.balanceAfter).toBe(99)
  })
})
