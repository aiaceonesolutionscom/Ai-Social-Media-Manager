import crypto from 'node:crypto'
import { config } from '../config.js'
import { fetchWithRetry } from './http.js'
import { logger } from './logger.js'
import { getConversation, logMessage } from '../store.js'

const WA_API = 'https://graph.facebook.com/v21.0'

function isWhatsAppMocked(): boolean {
  return config.dev.enabled && (!config.whatsapp.token || !config.whatsapp.phoneNumberId)
}

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetchWithRetry(`${WA_API}${path}`, init)
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`WhatsApp API ${res.status}: ${JSON.stringify(body)}`)
  }
  return body
}

function mockResult(label: string): Record<string, unknown> {
  logger.info({ label }, 'DEV MODE: WhatsApp send skipped (no WHATSAPP_TOKEN configured)')
  return { id: `dev_${crypto.randomUUID().slice(0, 12)}`, messaging_product: 'whatsapp' }
}

export async function sendText(to: string, text: string): Promise<Record<string, unknown>> {
  const conv = await getConversation(to)
  await logMessage({ phone: to, role: 'bot', type: 'text', content: text, postId: conv.postId })
  if (isWhatsAppMocked()) return mockResult('sendText')
  return api(`/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  })
}

export async function sendImage(to: string, mediaUrl: string, caption: string): Promise<Record<string, unknown>> {
  const conv = await getConversation(to)
  await logMessage({ phone: to, role: 'bot', type: 'image', content: `[image] ${caption.slice(0, 200)}`, postId: conv.postId })
  if (isWhatsAppMocked()) return mockResult('sendImage')
  return api(`/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: mediaUrl, caption },
    }),
  })
}

export interface ButtonOption {
  id: string
  title: string
}

export async function sendReplyButtons(to: string, text: string, buttons: ButtonOption[]): Promise<Record<string, unknown>> {
  const bodyPayload = buttons.slice(0, 3).map((b) => ({
    type: 'reply',
    reply: { id: b.id, title: b.title.slice(0, 20) },
  }))
  const conv = await getConversation(to)
  await logMessage({ phone: to, role: 'bot', type: 'text', content: `[buttons] ${text.slice(0, 200)}`, postId: conv.postId })
  if (isWhatsAppMocked()) return mockResult('sendReplyButtons')
  return api(`/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: text.slice(0, 1024) },
        action: { buttons: bodyPayload },
      },
    }),
  })
}

export async function downloadMedia(mediaId: string): Promise<Buffer> {
  const info = (await api(`/${mediaId}`, {
    headers: { Authorization: `Bearer ${config.whatsapp.token}` },
  })) as { url?: string }
  if (!info.url) throw new Error(`No media url for id ${mediaId}`)
  const res = await fetchWithRetry(info.url, {
    headers: { Authorization: `Bearer ${config.whatsapp.token}` },
  })
  if (!res.ok) throw new Error(`Failed to download media: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!config.whatsapp.appSecret || !signatureHeader) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex')
  const received = signatureHeader.trim()
  if (!received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function localFileUrl(relPath: string): string {
  return `${config.publicBaseUrl}/media/${encodeURIComponent(relPath.split('/').pop()!)}`
}
