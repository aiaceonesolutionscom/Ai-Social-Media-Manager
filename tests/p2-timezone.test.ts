import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createPost, updatePost, setConversation, getPost, saveUserPreferences } from '../src/store.js'
import { getDb } from '../src/db.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { chatJson } from '../src/lib/llm.js'
import { brandCheck } from '../src/pipeline/generate.js'
import { sendText, sendImage, sendReplyButtons } from '../src/lib/whatsapp.js'
import { saveImageBuffer } from '../src/storage.js'
import { parseScheduleTime, normalizeScheduleTime } from '../src/pipeline/publish.js'
import { resolveUserTimezone, isValidTimezone, naiveToUTC, nowInZone } from '../src/lib/timezone.js'
import { scheduledPosts } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { clearFeatureCache } from '../src/lib/packagePermissions.js'
import type { WrittenContent } from '../src/types.js'
import { PHONE, makeTextPayload, registerTestUser } from './helpers.js'

const chatJsonMock = vi.mocked(chatJson)
const brandCheckMock = vi.mocked(brandCheck)
const sendTextMock = vi.mocked(sendText)

const CONTENT: WrittenContent = {
  hook: 'Boost your mornings!',
  caption: '3 simple tips for a better morning routine.',
  cta: 'Save this post!',
  emojis: '🌅',
  hashtags: '#MorningRoutine',
  seoKeywords: ['morning routine'],
}

describe('P2-5/6 — schedule times honour the user timezone; degenerate dates rejected', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    clearFeatureCache(PHONE)
    await resetStore()
    await registerTestUser()
    brandCheckMock.mockResolvedValue({ passed: true, grammar: 'PASS', brandVoice: 'PASS', copyright: 'PASS', policy: 'PASS' })
    chatJsonMock.mockResolvedValue({ action: 'unclear', reply: 'Please rephrase.' })
    sendTextMock.mockResolvedValue(undefined)
  })

  it('rejects degenerate inputs like a bare year or partial date', () => {
    expect(parseScheduleTime('2026')).toBeNull()
    expect(parseScheduleTime('2026-08')).toBeNull()
    expect(parseScheduleTime('not a date')).toBeNull()
  })

  it('interprets a naive datetime in the supplied timezone, not server time', () => {
    // 2026-08-21 17:00 in Asia/Karachi (UTC+5) is 12:00 UTC.
    const karachi = parseScheduleTime('2026-08-21T17:00', 'Asia/Karachi')
    expect(karachi).toBe('2026-08-21T12:00:00.000Z')
    // Same wall-clock time with no timezone defaults to UTC.
    expect(parseScheduleTime('2026-08-21T17:00', 'UTC')).toBe('2026-08-21T17:00:00.000Z')
    // 17:00 in New York during EDT (UTC-4) is 21:00 UTC.
    expect(parseScheduleTime('2026-08-21T17:00', 'America/New_York')).toBe('2026-08-21T21:00:00.000Z')
  })

  it('parses absolute ISO timestamps with an explicit offset as-is', () => {
    expect(parseScheduleTime('2026-08-21T17:00:00+05:00')).toBe('2026-08-21T12:00:00.000Z')
    expect(parseScheduleTime('2026-08-21T17:00:00Z')).toBe('2026-08-21T17:00:00.000Z')
  })

  it('rejects past times even when the format is valid', () => {
    expect(parseScheduleTime('2020-01-01T12:00', 'UTC')).toBeNull()
  })

  it('naiveToUTC converts wall-clock times across timezones correctly', () => {
    expect(new Date(naiveToUTC('2026-08-21T17:00:00', 'Asia/Karachi')).toISOString()).toBe('2026-08-21T12:00:00.000Z')
    expect(new Date(naiveToUTC('2026-08-21T17:00:00', 'America/New_York')).toISOString()).toBe('2026-08-21T21:00:00.000Z')
  })

  it('timezone resolution defaults to UTC and falls back safely', async () => {
    expect(await resolveUserTimezone(PHONE)).toBe('UTC')
    await saveUserPreferences(PHONE, { timezone: 'Asia/Karachi' })
    expect(await resolveUserTimezone(PHONE)).toBe('Asia/Karachi')
    expect(isValidTimezone('Asia/Karachi')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
    expect(isValidTimezone(undefined)).toBe(false)
  })

  it('nowInZone describes the current time with the zone offset', () => {
    const t = nowInZone('Asia/Karachi', new Date('2026-08-20T12:00:00Z'))
    expect(t).toContain('Asia/Karachi')
    expect(t).toContain('UTC+05:00')
    expect(t).toContain('2026-08-20 17:00:00')
  })

  it('normalizeScheduleTime tells the LLM the user timezone and converts the result to UTC', async () => {
    chatJsonMock.mockImplementation(async (messages: unknown[]) => {
      const sys = String((messages[0] as { content: string }).content)
      expect(sys).toContain('Asia/Karachi')
      expect(sys).toContain('UTC+05:00')
      return { iso: '2026-08-21T18:00:00+05:00' }
    })
    const iso = await normalizeScheduleTime('6 baje', 'Asia/Karachi')
    expect(iso).toBe('2026-08-21T13:00:00.000Z')
  })

  it('chat scheduling stores the correct UTC instant using the user timezone', async () => {
    await saveUserPreferences(PHONE, { timezone: 'Asia/Karachi' })
    const post = await createPost(PHONE)
    await updatePost(post.id, {
      transcript: 'I want a morning post.',
      intent: { topic: 'morning routine', audience: 'all', tone: 'friendly', goal: 'educate', language: 'English', emotion: 'positive' },
      content: CONTENT,
      imagePrompt: 'Morning scene',
      imagePath: 'images/test.png',
      imageUrl: 'http://mock/media/test.png',
      status: 'AWAITING_APPROVAL',
      platforms: ['instagram'],
    })
    await setConversation(PHONE, { kind: 'awaiting_approval', postId: post.id })

    chatJsonMock.mockResolvedValue({ action: 'approve', scheduleAt: '2026-08-21T17:00' } as never)
    await handleWebhook(makeTextPayload('publish it at 5pm', 'wamid.tz1'))

    expect(sendTextMock).toHaveBeenCalledWith(PHONE, expect.stringContaining('Scheduled'))
    const rows = await getDb().select().from(scheduledPosts).where(eq(scheduledPosts.postId, post.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].publishAt).toBe('2026-08-21T12:00:00.000Z')

    // P5/TZ — the confirmation must be shown in the USER's timezone, never the
    // server's local time.
    const confirm = (sendTextMock.mock.calls as unknown[])
      .map((c) => (c[1] as string) || '')
      .find((t) => t.includes('Scheduled'))
    expect(confirm).toContain('Asia/Karachi')
    expect(confirm).toContain('5:00 PM')
  }, 15000)
})