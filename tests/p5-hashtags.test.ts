import { describe, it, expect, vi, beforeEach } from 'vitest'

// Isolate the writer guard: mock only the LLM layer so the real writeContent()
// runs and we can assert it retries when hashtags/caption are missing.
vi.mock('../src/lib/llm.js', () => ({ chat: vi.fn(), chatJson: vi.fn() }))

import { chatJson } from '../src/lib/llm.js'
import { writeContent } from '../src/pipeline/generate.js'
import type { Intent, PlannedContent } from '../src/types.js'

const chatJsonMock = vi.mocked(chatJson)

const INTENT: Intent = {
  topic: 'hiring AI interns',
  audience: 'students',
  tone: 'professional',
  goal: 'generate leads',
  language: 'English',
  emotion: 'confident',
}
const PLAN: PlannedContent = { positioning: 'x', angle: 'y', suggestedTime: '' } as PlannedContent

describe('P5 — writer hashtag/caption guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retries with a nudge when hashtags are missing', async () => {
    chatJsonMock
      .mockResolvedValueOnce({ hook: 'h', caption: 'We are hiring AI interns for our team.', cta: '', emojis: '', hashtags: '' })
      .mockResolvedValueOnce({ hook: 'h', caption: 'We are hiring AI interns for our team.', cta: 'Apply now', emojis: '', hashtags: '#AIInterns #TechJobs' })

    const wc = await writeContent(INTENT, PLAN, undefined, undefined, undefined)
    expect(wc.hashtags).toContain('#AIInterns')
    expect(chatJsonMock).toHaveBeenCalledTimes(2)
    // The retry carries an explicit hashtag nudge.
    const secondUser = JSON.parse((chatJsonMock.mock.calls[1][0] as { content: string }[])[1].content)
    expect(secondUser.editRequest).toContain('hashtags')
  })

  it('retries with a nudge when the caption is empty', async () => {
    chatJsonMock
      .mockResolvedValueOnce({ hook: '', caption: '', cta: '', emojis: '', hashtags: '#x' })
      .mockResolvedValueOnce({ hook: 'h', caption: 'Join our AI internship program today.', cta: 'Apply', emojis: '', hashtags: '#AIInterns' })

    const wc = await writeContent(INTENT, PLAN, undefined, undefined, undefined)
    expect(wc.caption.trim().length).toBeGreaterThan(0)
    expect(chatJsonMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry when caption + hashtags are present', async () => {
    chatJsonMock.mockResolvedValue({ hook: 'h', caption: 'We are hiring AI interns now.', cta: 'Apply', emojis: '', hashtags: '#AIInterns #Hiring' })
    const wc = await writeContent(INTENT, PLAN, undefined, undefined, undefined)
    expect(wc.hashtags).toContain('#AIInterns')
    expect(chatJsonMock).toHaveBeenCalledTimes(1)
  })
})
