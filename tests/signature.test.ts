import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'

describe('Webhook signature verification (real implementation)', () => {
  it('accepts a valid X-Hub-Signature-256 and rejects invalid ones', async () => {
    process.env.WHATSAPP_APP_SECRET = 'test-secret-123'
    const { verifyWebhookSignature } = await import('../src/lib/whatsapp.js')

    const body = JSON.stringify({ entry: [{ id: 'x' }] })
    const valid = 'sha256=' + crypto.createHmac('sha256', 'test-secret-123').update(body).digest('hex')

    expect(verifyWebhookSignature(body, valid)).toBe(true)
    expect(verifyWebhookSignature(body, 'sha256=ffffffff')).toBe(false)
    expect(verifyWebhookSignature(body, undefined)).toBe(false)
    expect(verifyWebhookSignature(body, '')).toBe(false)
    expect(verifyWebhookSignature('tampered-body', valid)).toBe(false)
  })
})