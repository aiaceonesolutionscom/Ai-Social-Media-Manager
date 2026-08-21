import { describe, it, expect, vi, beforeEach } from 'vitest'
import { providerManager } from '../src/lib/ai/providerManager.js'

// P5-TRUNC — the root-cause fix for captions that arrived truncated mid-sentence.
// chatJson must detect finish_reason === 'length' and retry ONCE with a larger
// max_tokens budget.
describe('P5 — LLM truncation retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('retries once with doubled max_tokens when the response is truncated', async () => {
    const spy = vi
      .spyOn(providerManager, 'chatRaw')
      .mockResolvedValueOnce({
        content: '{"hook":"h","caption":"partial caption that gets cut off mid sente","cta":"","emojis":"","hashtags":""}',
        tokensInput: 1,
        tokensOutput: 1,
        durationMs: 1,
        finishReason: 'length',
        truncated: true,
      })
      .mockResolvedValueOnce({
        content: '{"hook":"h","caption":"a complete caption about hiring AI interns for our team","cta":"Apply now","emojis":"","hashtags":"#aijobs"}',
        tokensInput: 1,
        tokensOutput: 1,
        durationMs: 1,
        finishReason: 'stop',
        truncated: false,
      })

    const result = await providerManager.chatJson<{ caption: string }>([{ role: 'system', content: 'x' }], { maxTokens: 512 })

    expect(result.caption).toContain('complete caption')
    expect(spy).toHaveBeenCalledTimes(2)
    const secondOpts = spy.mock.calls[1][1] as { maxTokens?: number }
    expect(secondOpts.maxTokens).toBe(1024)
  })

  it('throws a clear error when still truncated after the retry', async () => {
    vi.spyOn(providerManager, 'chatRaw').mockResolvedValue({
      content: '{"hook":"h","caption":"still cut off","cta":"","emojis":"","hashtags":""}',
      tokensInput: 1,
      tokensOutput: 1,
      durationMs: 1,
      finishReason: 'length',
      truncated: true,
    })

    await expect(
      providerManager.chatJson([{ role: 'system', content: 'x' }], { maxTokens: 512 }),
    ).rejects.toThrow(/truncated/)
  })

  it('does not retry when the response is complete', async () => {
    const spy = vi.spyOn(providerManager, 'chatRaw').mockResolvedValue({
      content: '{"hook":"h","caption":"a complete caption","cta":"x","emojis":"","hashtags":"#t"}',
      tokensInput: 1,
      tokensOutput: 1,
      durationMs: 1,
      finishReason: 'stop',
      truncated: false,
    })

    const result = await providerManager.chatJson<{ caption: string }>([{ role: 'system', content: 'x' }])
    expect(result.caption).toContain('complete caption')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('retries when JSON is cut off mid-field even with finish_reason "stop"', async () => {
    // Reproduces the "scrambling for coffee, an" regression: the model returned
    // stop but left the JSON unterminated (no closing brace).
    const spy = vi
      .spyOn(providerManager, 'chatRaw')
      .mockResolvedValueOnce({
        content: '{"hook":"h","caption":"Mornings are hard, between snoozing the alarm and scrambling for coffee, an',
        tokensInput: 1,
        tokensOutput: 1,
        durationMs: 1,
        finishReason: 'stop',
        truncated: false,
      })
      .mockResolvedValueOnce({
        content: '{"hook":"h","caption":"a complete caption about the dog","cta":"x","emojis":"","hashtags":"#t"}',
        tokensInput: 1,
        tokensOutput: 1,
        durationMs: 1,
        finishReason: 'stop',
        truncated: false,
      })

    const result = await providerManager.chatJson<{ caption: string }>([{ role: 'system', content: 'x' }], { maxTokens: 512 })
    expect(result.caption).toContain('complete caption about the dog')
    expect(spy).toHaveBeenCalledTimes(2)
    expect((spy.mock.calls[1][1] as { maxTokens?: number }).maxTokens).toBe(1024)
  })
})
