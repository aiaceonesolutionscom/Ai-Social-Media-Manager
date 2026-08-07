import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { initStore, resetStore } from '../src/store.js'
import { closeDb } from '../src/db.js'
import { config } from '../src/config.js'
import { placeholderPng, generateImage } from '../src/lib/image.js'
import { publishImage, CancelledPublishError } from '../src/lib/instagram.js'
import { publishToFacebook } from '../src/lib/facebook.js'
import { transcribeAudio } from '../src/lib/stt.js'
import { sendText } from '../src/lib/whatsapp.js'

// Enable the DEV_MODE mock layer and clear real credentials so mocks activate.
function enableDev() {
  config.dev.enabled = true
  config.instagram.accessToken = ''
  config.instagram.igUserId = ''
  config.image.openaiKey = ''
  config.stt.apiKey = ''
  config.whatsapp.token = ''
  config.whatsapp.phoneNumberId = ''
}

describe('DEV_MODE mock layer', () => {
  beforeAll(() => initStore())
  beforeEach(async () => {
    enableDev()
    await resetStore()
  })

  it('placeholderPng returns a valid PNG buffer', () => {
    const buf = placeholderPng(128, 128)
    // PNG signature
    expect(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).equals(buf.subarray(0, 8))).toBe(true)
    // Contains the IEND chunk at the end
    expect(buf.subarray(buf.length - 8, buf.length - 4).toString('ascii')).toBe('IEND')
    expect(buf.length).toBeGreaterThan(20)
  })

  it('generateImage returns placeholder PNG when dev mode and no OpenAI key', async () => {
    const buf = await generateImage('A test prompt')
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG')
  })

  it('generateImage throws when NOT in dev mode and no OpenAI key', async () => {
    config.dev.enabled = false
    await expect(generateImage('x')).rejects.toThrow(/No active image provider configured/)
  })

  it('transcribeAudio returns a mock transcript in dev mode', async () => {
    const transcript = await transcribeAudio('/does/not/exist.ogg')
    expect(typeof transcript).toBe('string')
    expect(transcript.length).toBeGreaterThan(10)
  })

  it('transcribeAudio throws when NOT in dev mode and no Groq key', async () => {
    config.dev.enabled = false
    await expect(transcribeAudio('/does/not/exist.ogg')).rejects.toThrow(/No active STT provider configured/)
  })

  it('publishImage simulates success in dev mode', async () => {
    const result = await publishImage('http://x/img.png', 'caption')
    expect(result.mediaId).toMatch(/^DEV_/)
    expect(result.permalink).toContain('instagram.com')
  })

  it('publishImage honours cancel in dev mode', async () => {
    await expect(
      publishImage('http://x/img.png', 'caption', undefined, { shouldCancel: () => true }),
    ).rejects.toBeInstanceOf(CancelledPublishError)
  })

  it('publishToFacebook simulates success with a dev token', async () => {
    const result = await publishToFacebook('http://x/img.png', 'caption', 'dev_fb_page', 'dev_token_fb')
    expect(result.postId).toMatch(/^DEV_/)
    expect(result.permalink).toContain('facebook.com')
  })

  it('publishToFacebook throws when NOT in dev mode and creds missing', async () => {
    config.dev.enabled = false
    await expect(publishToFacebook('http://x/img.png', 'caption', '', '')).rejects.toThrow(/required/)
  })

  it('sendText records a message and returns a dev id in dev mode', async () => {
    const result = await sendText('+1234567890', 'hello dev')
    expect(result.id).toMatch(/^dev_/)
  })
})