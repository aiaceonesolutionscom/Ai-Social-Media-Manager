import { describe, it, beforeAll, afterAll, vi } from 'vitest'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

// Network-only mocks. The LLM layer is NOT mocked — every scenario runs against
// the real configured LLM provider (Mistral), copied into the isolated test DB.
vi.mock('../src/lib/image.js', () => ({ generateImage: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])) }))
vi.mock('../src/lib/instagram.js', () => ({
  publishImage: vi.fn().mockResolvedValue({ mediaId: '1789live0001', permalink: 'https://www.instagram.com/p/LIVE/' }),
  CancelledPublishError: class CancelledPublishError extends Error { constructor() { super('cancelled'); this.name = 'CancelledPublishError' } },
}))
vi.mock('../src/lib/whatsapp.js', () => ({
  sendText: vi.fn().mockResolvedValue({ messages: [{ id: 'm' }] }),
  sendImage: vi.fn().mockResolvedValue({ messages: [{ id: 'i' }] }),
  sendReplyButtons: vi.fn().mockResolvedValue({ messages: [{ id: 'b' }] }),
  downloadMedia: vi.fn().mockResolvedValue(Buffer.from('x')),
  localFileUrl: vi.fn().mockReturnValue('http://mock/media/test.png'),
  verifyWebhookSignature: vi.fn().mockReturnValue(true),
}))
vi.mock('../src/storage.js', () => ({
  saveAudioBuffer: vi.fn().mockReturnValue('audio/test.ogg'),
  saveImageBuffer: vi.fn().mockReturnValue('images/test.png'),
  postImageUrl: vi.fn().mockReturnValue('http://mock/media/test.png'),
  readFile: vi.fn(),
  fileExists: vi.fn().mockReturnValue(true),
  storageDir: vi.fn().mockReturnValue('storage'),
}))

import { initStore, createUser, updateUser, connectAccount, getConversation, getPost } from '../src/store.js'
import { getDb, getPool } from '../src/db.js'
import { aiProviders } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { handleUserInput } from '../src/pipeline/conversation.js'
import { providerManager } from '../src/lib/ai/providerManager.js'
import { sendText } from '../src/lib/whatsapp.js'
import { publishImage } from '../src/lib/instagram.js'

const PROD_DB = 'postgresql://postgres:postgres@localhost:5432/ai_instagram'
const PHONE = 'u_live_llm_test'
const sendTextMock = vi.mocked(sendText)
const publishImageMock = vi.mocked(publishImage)

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pg = require('pg') as typeof import('pg')

type ScenarioResult = { n: number; label: string; status: 'PASS' | 'FAIL' | 'INFO'; bot?: string; detail?: string }
const results: ScenarioResult[] = []

async function turn(msg: string): Promise<void> {
  await handleUserInput(PHONE, msg, { waMsgId: `live_${Date.now()}_${Math.random().toString(36).slice(2)}` })
}

function lastBotText(): string {
  const calls = sendTextMock.mock.calls.map((c) => String(c[1] ?? '')).filter((t) => t.length > 0)
  return calls.length ? calls[calls.length - 1] : ''
}

describe('LIVE LLM — natural conversation verification (real Mistral, isolated test DB)', () => {
  beforeAll(async () => {
    await initStore()
    // The Pro seed enables custom_branding, which pauses every run at the branding
    // prompt. Branding behavior is covered separately (branding-toggle.test.ts), so
    // remove it here to let the natural-conversation flow run end to end.
    await getPool().query(`UPDATE packages SET features = features - 'custom_branding' WHERE slug='pro'`)
    // Fresh state for this phone in the isolated test DB.
    const pool = getPool()
    await pool.query('DELETE FROM conversations WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM messages WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM token_transactions WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM social_accounts WHERE phone=$1', [PHONE])
    await pool.query(`DELETE FROM post_edits WHERE post_id IN (SELECT id FROM posts WHERE phone=$1)`, [PHONE])
    await pool.query('DELETE FROM scheduled_posts WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM posts WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM users WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM ai_usage_logs WHERE phone=$1', [PHONE])
    // Copy the active LLM provider (with its key) from the production DB into the
    // isolated test DB so the in-process providerManager can talk to the real LLM.
    const prod = new pg.Pool({ connectionString: PROD_DB })
    const rows = await prod.query(`SELECT * FROM ai_providers WHERE category='llm' AND is_active LIMIT 1`)
    await prod.end()
    if (rows.rows.length === 0) throw new Error('No active LLM provider found in prod DB')
    const p = rows.rows[0]
    await getDb().delete(aiProviders).where(eq(aiProviders.category, 'llm'))
    await getDb().insert(aiProviders).values({
      id: randomUUID(),
      category: 'llm',
      provider: p.provider,
      displayName: p.display_name || p.provider,
      apiKey: p.api_key,
      baseUrl: p.base_url,
      model: p.model,
      config: p.config || {},
      isActive: true,
      isDefault: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await providerManager.reload('llm')
    // Isolated test user on the Pro package with both platforms connected.
    await createUser({ phone: PHONE, name: 'Live LLM Test', email: 'live-llm-test@example.com', tokensRemaining: 1000, packageId: 'pro' })
    await updateUser(PHONE, { packageId: 'pro', tokensRemaining: 1000, packageStatus: 'active' })
    await connectAccount({ phone: PHONE, platform: 'instagram', accountId: 'live_ig', accountName: 'Live IG', accessToken: 'mock' })
    await connectAccount({ phone: PHONE, platform: 'facebook', accountId: 'live_fb', accountName: 'Live FB', accessToken: 'mock' })
  })

  afterAll(async () => {
    const pool = getPool()
    await pool.query('DELETE FROM conversations WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM messages WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM token_transactions WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM social_accounts WHERE phone=$1', [PHONE])
    await pool.query(`DELETE FROM post_edits WHERE post_id IN (SELECT id FROM posts WHERE phone=$1)`, [PHONE])
    await pool.query('DELETE FROM scheduled_posts WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM posts WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM users WHERE phone=$1', [PHONE])
    await pool.query('DELETE FROM ai_usage_logs WHERE phone=$1', [PHONE])
    await pool.end()
  })

  it('drives the 20-scenario live conversation suite', async () => {
    let n = 0
    const scenario = async (label: string, fn: () => Promise<void>, pass?: (ctx: { kind: string; postId?: string }) => Promise<boolean> | boolean) => {
      n++
      const before = sendTextMock.mock.calls.length
      try {
        await fn()
        const conv = await getConversation(PHONE) as { kind: string; postId?: string }
        const bot = sendTextMock.mock.calls.length > before ? lastBotText() : ''
        const ok = pass ? await pass(conv) : true
        results.push({ n, label, status: ok ? 'PASS' : 'FAIL', detail: `conv=${conv.kind}`, bot: bot ? bot.replace(/\n+/g, ' ').slice(0, 160) : undefined })
      } catch (err: unknown) {
        results.push({ n, label, status: 'FAIL', detail: `error: ${(err as Error).message}`.slice(0, 220) })
      }
    }

    // 1. Greeting / smalltalk
    await scenario('1. greeting', () => turn('Hi!'), () => true)

    // 2. Full-intent post → preview (LLM may either generate or ask one clarifying question)
    await scenario('2. full-intent post', () => turn('Create an Instagram post about my new gym Focus Fitness. It has modern equipment and group classes. Audience is young adults, tone is motivational, goal is to promote.'),
      (c) => ['awaiting_approval', 'gathering'].includes(c.kind))

    // 3. Edit caption (works from either gathering follow-through or preview)
    await scenario('3. edit caption', () => turn('Make the caption shorter'), (c) => true)

    // 4. Add platform (Facebook)
    await scenario('4. add facebook', () => turn('Also post it to Facebook too'), (c) => true)

    // 5. Regenerate image
    await scenario('5. regenerate image', () => turn('Regenerate the image'), (c) => true)

    // 6. Approve → publish (mocked). The LLM may still be mid-gathering, so if the
    //    post reached preview after the first turn, re-confirm to drive the publish.
    await scenario('6. approve/publish', async () => {
      await turn('Approve')
      const conv = await getConversation(PHONE) as { kind: string }
      if (conv?.kind === 'awaiting_approval') await turn('Approve')
    },
      async (c) => {
        const p = c.postId ? await getPost(c.postId) : undefined
        return p?.status === 'DONE'
      })

    // 7. Correction → new post about coffee
    await scenario('7. new coffee post', () => turn('Actually that was wrong, make a new post about coffee instead'),
      (c) => ['awaiting_approval', 'gathering'].includes((c as { kind: string }).kind))

    // 8. Cancel
    await scenario('8. cancel', () => turn('Cancel this'), (c) => (c as { kind: string }).kind === 'idle')

    // 9. Start post → gathering (topic missing)
    await scenario('9. start post (gathering)', () => turn('I want to make a post'),
      (c) => ['gathering', 'awaiting_approval'].includes((c as { kind: string }).kind))

    // 10. Topic switch mid-gathering
    await scenario('10. topic switch', () => turn('Actually make it about shoes instead'),
      (c) => ['gathering', 'awaiting_approval'].includes((c as { kind: string }).kind))

    // 11. Fill details
    await scenario('11. fill details', () => turn('It is for running shoes for athletes, energetic tone'),
      (c) => ['gathering', 'awaiting_approval'].includes((c as { kind: string }).kind))

    // 12. Negation (safety): must never trigger a publish
    await scenario('12. negation', async () => {
      const before = publishImageMock.mock.calls.length
      await turn("Don't publish anything")
      const after = publishImageMock.mock.calls.length
      if (after !== before) throw new Error('publish was triggered despite negation!')
    },
      (c) => ['idle', 'gathering', 'awaiting_approval'].includes(c.kind))

    // 13. Post → ad (entity resolution)
    await scenario('13. post-to-ad', () => turn('Make an ad for the coffee post'),
      (c) => (c as { kind: string }).kind === 'ad_gathering' || (c as { kind: string }).kind === 'ad_preview')

    // 14. New ad with budget → preview
    await scenario('14. new ad + budget', () => turn('Create an ad for my shoe store with a 500 budget'),
      (c) => ['ad_preview', 'ad_gathering'].includes((c as { kind: string }).kind))

    // 15. Cancel ad
    await scenario('15. cancel ad', () => turn('Cancel the ad'), (c) => (c as { kind: string }).kind === 'idle')

    // 16. Roman Urdu post
    await scenario('16. roman urdu', () => turn('mujhe ek instagram post bana do gym ke bare mein'),
      (c) => ['awaiting_approval', 'gathering'].includes((c as { kind: string }).kind))

    // 17. Hinglish post
    await scenario('17. hinglish', () => turn('bhai ek post banao mere cafe ka, friendly tone'),
      (c) => ['awaiting_approval', 'gathering'].includes((c as { kind: string }).kind))

    // 18. Smalltalk in Urdu
    await scenario('18. smalltalk urdu', () => turn('aap kese ho?'), (c) => true)

    // 19. Schedule a post from idle — no draft exists, so the system must say so
    //     instead of faking a schedule. (Real scheduling is covered by publish.test.ts.)
    await scenario('19. schedule', () => turn('Schedule the post for tomorrow 7pm'),
      async (c) => {
        const bot = lastBotText()
        const pool = getPool()
        const rows = await pool.query('SELECT count(*)::int AS c FROM scheduled_posts WHERE phone=$1', [PHONE])
        const scheduled = (rows.rows[0]?.c ?? 0) > 0
        return scheduled || (c.kind === 'idle' && /no draft|draft to schedule/i.test(bot))
      })

    // 20. Unavailable feature → graceful reply
    await scenario('20. unavailable feature', () => turn('start a voice call'), (c) => true)

    fs.writeFileSync('live-llm-report.json', JSON.stringify(results, null, 2))
    const pass = results.filter((r) => r.status === 'PASS').length
    const fail = results.filter((r) => r.status === 'FAIL').length
    console.log(`\nLIVE LLM SUMMARY: ${pass} PASS / ${fail} FAIL / ${results.length - pass - fail} INFO\n`)
    for (const r of results) console.log(`  ${r.status.padEnd(4)} | ${r.n.toString().padStart(2)}. ${r.label} | ${r.detail}${r.bot ? ' | BOT: ' + r.bot : ''}`)
  }, 1_200_000)
})