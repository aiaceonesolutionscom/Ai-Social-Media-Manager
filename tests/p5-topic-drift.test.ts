import { describe, it, expect } from 'vitest'
import { captionMentionsTopic } from '../src/pipeline/conversation.js'

// P5-TOPIC — guards against the "generic social-media advice" drift where the
// model ignores the user's actual subject. The check must be:
//  - true when the caption references the topic (incl. singular/plural)
//  - false when the caption is off-topic generic filler
describe('P5 — topic-relevance guard', () => {
  it('passes when the caption references the topic', () => {
    expect(captionMentionsTopic('We are hiring AI interns for our engineering team.', 'hiring AI interns')).toBe(true)
  })

  it('matches singular/plural variants', () => {
    expect(captionMentionsTopic('Hire our interns and grow with us.', 'hiring AI interns')).toBe(true)
  })

  it('fails on generic, off-topic filler', () => {
    expect(captionMentionsTopic('Ever feel like your social media posts miss the mark? Here are tips.', 'hiring AI interns')).toBe(false)
  })

  it('flags the reported "running dog" regression (morning advice, not a dog reunion)', () => {
    const offTopic = 'What’s your secret to a stress-free morning? Mornings set the tone for the rest of the day—but let’s be real, they don’t always go as planned. 😅 Between snoozing the alarm, scrambling for coffee, an'
    expect(captionMentionsTopic(offTopic, 'running dog reuniting with owner')).toBe(false)
  })

  it('passes when the caption is genuinely about the running dog', () => {
    expect(captionMentionsTopic('A loyal dog ran miles to find its way back home to its owner. ❤️', 'running dog reuniting with owner')).toBe(true)
  })

  it('returns true for empty topic (do not block generation)', () => {
    expect(captionMentionsTopic('Some caption', '')).toBe(true)
  })

  it('substring-matches short topics instead of auto-passing', () => {
    // Topic "ai" has no token >=3, so we fall back to a substring check: a
    // genuinely off-topic caption must NOT pass.
    expect(captionMentionsTopic('Anything at all', 'ai')).toBe(false)
    expect(captionMentionsTopic('We built an AI assistant today', 'ai')).toBe(true)
  })
})
