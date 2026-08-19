import crypto from 'node:crypto'
import { config } from '../config.js'
import { fetchWithRetry } from './http.js'
import { logger } from './logger.js'
import { getConversation, logMessage } from '../store.js'
import { metaConfig } from './metaConfig.js'

function getWhatsAppApiBase(): string {
  return `https://graph.facebook.com/${metaConfig.getWhatsAppApiVersion()}`
}

function getWhatsAppToken(): string {
  return metaConfig.getWhatsAppToken() || config.whatsapp.token || ''
}

function getWhatsAppPhoneId(): string {
  return metaConfig.getWhatsAppPhoneId() || config.whatsapp.phoneNumberId || ''
}

function isWhatsAppMocked(): boolean {
  return config.dev.enabled && (!getWhatsAppToken() || !getWhatsAppPhoneId())
}

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetchWithRetry(`${getWhatsAppApiBase()}${path}`, init)
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

// Web-only users have canonical synthetic phone keys (u_...). The bot conversation is
// still logged to the messages table so the website dashboard chat can show it, but there
// is no real WhatsApp number to deliver to — skip the WhatsApp API call entirely.
export function isWebOnlyPhone(to: string): boolean {
  return to.startsWith('u_')
}

export async function sendText(to: string, text: string): Promise<Record<string, unknown>> {
  const conv = await getConversation(to)
  await logMessage({ phone: to, role: 'bot', type: 'text', content: text, postId: conv.postId })
  if (isWebOnlyPhone(to)) return mockResult('sendText')
  if (isWhatsAppMocked()) return mockResult('sendText')
  return api(`/${getWhatsAppPhoneId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getWhatsAppToken()}`,
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

// Send an approved template message. Template name + language come from meta config with env fallback.
export async function sendTemplate(
  to: string,
  templateName: string,
  language: string,
  params: string[],
  logLabel = 'template',
): Promise<Record<string, unknown>> {
  const conv = await getConversation(to)
  await logMessage({ phone: to, role: 'bot', type: 'text', content: `[${logLabel}] sent to ${to}`, postId: conv.postId })
  if (isWebOnlyPhone(to)) return mockResult(logLabel)
  if (isWhatsAppMocked()) return mockResult(logLabel)
  return api(`/${getWhatsAppPhoneId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getWhatsAppToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    }),
  })
}

// Send an OTP verification code via an approved template message.
// WhatsApp Cloud API requires a template for business-initiated messages (no 24h session yet).
// Template name is configurable via META_WA_OTP_TEMPLATE (default: 'otp_verification').
// The template must have exactly one {{1}} parameter that receives the code.
export async function sendOtpTemplate(to: string, code: string): Promise<Record<string, unknown>> {
  const templateName = metaConfig.getValue('whatsapp', 'otp_template') || process.env.META_WA_OTP_TEMPLATE || 'otp_verification'
  const language = metaConfig.getValue('whatsapp', 'otp_template_language') || 'en'
  const conv = await getConversation(to)
  await logMessage({ phone: to, role: 'bot', type: 'text', content: `[otp template] code sent to ${to}`, postId: conv.postId })
  if (isWebOnlyPhone(to)) return mockResult('sendOtpTemplate')
  if (isWhatsAppMocked()) return mockResult('sendOtpTemplate')
  return api(`/${getWhatsAppPhoneId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getWhatsAppToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
      },
    }),
  })
}

export async function sendImage(to: string, mediaUrl: string, caption: string): Promise<Record<string, unknown>> {
  const conv = await getConversation(to)
  await logMessage({ phone: to, role: 'bot', type: 'image', content: `[image ${mediaUrl}] ${caption.slice(0, 200)}`, postId: conv.postId })
  if (isWebOnlyPhone(to)) return mockResult('sendImage')
  if (isWhatsAppMocked()) return mockResult('sendImage')
  return api(`/${getWhatsAppPhoneId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getWhatsAppToken()}`,
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
  if (isWebOnlyPhone(to)) return mockResult('sendReplyButtons')
  if (isWhatsAppMocked()) return mockResult('sendReplyButtons')
  return api(`/${getWhatsAppPhoneId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getWhatsAppToken()}`,
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
    headers: { Authorization: `Bearer ${getWhatsAppToken()}` },
  })) as { url?: string }
  if (!info.url) throw new Error(`No media url for id ${mediaId}`)
  const res = await fetchWithRetry(info.url, {
    headers: { Authorization: `Bearer ${getWhatsAppToken()}` },
  })
  if (!res.ok) throw new Error(`Failed to download media: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!metaConfig.getWebhookSecret() || !signatureHeader) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', metaConfig.getWebhookSecret()).update(rawBody).digest('hex')
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

