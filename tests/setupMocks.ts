import { vi } from 'vitest'

vi.mock('../src/lib/llm.js', () => ({
  chat: vi.fn(),
  chatJson: vi.fn(),
}))

vi.mock('../src/lib/stt.js', () => ({
  transcribeAudio: vi.fn(),
}))

vi.mock('../src/lib/image.js', () => ({
  generateImage: vi.fn(),
}))

vi.mock('../src/lib/whatsapp.js', () => ({
  sendText: vi.fn().mockResolvedValue({ messages: [{ id: 'msg' }] }),
  sendImage: vi.fn().mockResolvedValue({ messages: [{ id: 'img' }] }),
  sendReplyButtons: vi.fn().mockResolvedValue({ messages: [{ id: 'btn' }] }),
  downloadMedia: vi.fn().mockResolvedValue(Buffer.from('fake-audio-bytes')),
  localFileUrl: vi.fn().mockReturnValue('http://mock/media/test.png'),
  verifyWebhookSignature: vi.fn().mockReturnValue(true),
}))

vi.mock('../src/lib/instagram.js', () => ({
  publishImage: vi.fn(),
  CancelledPublishError: class CancelledPublishError extends Error {
    constructor() {
      super('Publishing cancelled by user')
      this.name = 'CancelledPublishError'
    }
  },
}))

vi.mock('../src/pipeline/generate.js', () => ({
  generateFullDraft: vi.fn(),
  brandCheck: vi.fn(),
  generateImagePrompt: vi.fn(),
  planEdit: vi.fn(),
  extractIntent: vi.fn(),
  planContent: vi.fn(),
  writeContent: vi.fn(),
}))

vi.mock('../src/storage.js', () => ({
  saveAudioBuffer: vi.fn().mockReturnValue('audio/test.ogg'),
  saveImageBuffer: vi.fn().mockReturnValue('images/test.png'),
  postImageUrl: vi.fn().mockReturnValue('http://mock/media/test.png'),
  readFile: vi.fn(),
  fileExists: vi.fn().mockReturnValue(true),
  storageDir: vi.fn().mockReturnValue('storage'),
}))
