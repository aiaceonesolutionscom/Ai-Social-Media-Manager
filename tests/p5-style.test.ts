import { describe, it, expect, vi, beforeEach } from 'vitest'

// Isolate generate.ts: mock only the LLM layer and the store lookups it needs,
// so the real writeContent() runs and we can inspect the prompt it builds.
vi.mock('../src/lib/llm.js', () => ({ chat: vi.fn(), chatJson: vi.fn() }))
vi.mock('../src/store.js', () => ({
  listPostsForUser: vi.fn(),
  resolveUserPhone: vi.fn(async (p: string) => p),
}))

import { chatJson } from '../src/lib/llm.js'
import { listPostsForUser } from '../src/store.js'
import { writeContent } from '../src/pipeline/generate.js'
import type { Intent, PlannedContent } from '../src/types.js'

const chatJsonMock = vi.mocked(chatJson)
const listPostsUserMock = vi.mocked(listPostsForUser)

const INTENT: Intent = { topic: 'shoes', audience: 'all', tone: 'casual', goal: 'promote', language: 'English', emotion: 'joyful' }
const PLAN: PlannedContent = { positioning: 'x', angle: 'y', suggestedTime: '' } as PlannedContent

function lastSystemPrompt(): string {
  const calls = chatJsonMock.mock.calls
  return (calls[calls.length - 1][0] as { content: string }[])[0].content
}

describe('P5 — user-style captions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes the user’s past captions as a voice reference in the writer prompt', async () => {
    listPostsUserMock.mockResolvedValue([
      { id: 'a', content: { caption: 'Slay the day in these kicks! 🔥' }, transcript: '' } as never,
      { id: 'b', content: { caption: 'Comfy + cute = our new sneakers 👟' }, transcript: '' } as never,
    ])
    chatJsonMock.mockResolvedValue({ hook: 'h', caption: 'c', cta: 't', emojis: '', hashtags: '', seoKeywords: [] })

    await writeContent(INTENT, PLAN, undefined, undefined, '919999999999')

    const systemPrompt = lastSystemPrompt()
    expect(systemPrompt).toContain('AUTHOR VOICE')
    expect(systemPrompt).toContain('Slay the day in these kicks! 🔥')
    expect(systemPrompt).toContain('Comfy + cute = our new sneakers 👟')
  })

  it('does not inject a voice block when the user has no past posts', async () => {
    listPostsUserMock.mockResolvedValue([])
    chatJsonMock.mockResolvedValue({ hook: 'h', caption: 'c', cta: 't', emojis: '', hashtags: '', seoKeywords: [] })

    await writeContent(INTENT, PLAN, undefined, undefined, '919999999999')

    const systemPrompt = lastSystemPrompt()
    expect(systemPrompt).not.toContain('AUTHOR VOICE')
  })
})
