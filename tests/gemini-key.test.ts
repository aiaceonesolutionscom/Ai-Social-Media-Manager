import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/http.js', () => ({
  fetchWithRetry: vi.fn(),
}))

import { fetchWithRetry } from '../src/lib/http.js'
import { geminiImage } from '../src/lib/ai/providers/gemini.js'

const fetchMock = vi.mocked(fetchWithRetry)

describe('P5-11 — Gemini API key sent via header, not query param', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: 'aGVsbG8=' } }] } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  it('generate() puts the key in X-Goog-Api-Key and not in the URL', async () => {
    await geminiImage.generate('sk_gemini_super_secret', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.0-flash', 'a cat')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).not.toContain('sk_gemini_super_secret')
    expect(url).not.toContain('key=')
    expect((opts as { headers: Record<string, string> }).headers['X-Goog-Api-Key']).toBe('sk_gemini_super_secret')
  })

  it('testConnection() also sends the key via header', async () => {
    const res = await geminiImage.testConnection('sk_gemini_super_secret', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.0-flash')
    expect(res.ok).toBe(true)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).not.toContain('key=')
    expect((opts as { headers: Record<string, string> }).headers['X-Goog-Api-Key']).toBe('sk_gemini_super_secret')
  })
})