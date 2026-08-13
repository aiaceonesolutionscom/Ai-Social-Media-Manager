import crypto from 'node:crypto'
import { getAllConfig } from '../store.js'
import { logger } from './logger.js'

export const GATEWAY_DEFAULT_API_BASE = 'https://api.rapidgateway.pk'
export const GATEWAY_WEBHOOK_PATH = '/webhooks/gateway'

export interface GatewaySettings {
  enabled: boolean
  sandbox: boolean
  apiKey: string
  webhookSecret: string
  apiBase: string
}

export async function getGatewaySettings(cfg?: Record<string, string>): Promise<GatewaySettings> {
  const all = cfg ?? (await getAllConfig())
  return {
    enabled: all.gateway_enabled !== 'off',
    sandbox: all.gateway_sandbox === 'on',
    apiKey: all.gateway_api_key || '',
    webhookSecret: all.gateway_webhook_secret || '',
    apiBase: all.gateway_api_base || GATEWAY_DEFAULT_API_BASE,
  }
}

export function isGatewayConfigured(settings: GatewaySettings): boolean {
  return !!(settings.apiKey && settings.webhookSecret)
}

export class GatewayNotConfiguredError extends Error {
  constructor(message = 'Payment gateway is not configured') {
    super(message)
    this.name = 'GatewayNotConfiguredError'
  }
}

export async function createGatewaySession(params: {
  amountPkr: number
  merchantTransactionId: string
  phone: string
  returnUrl: string
  webhookUrl: string
  settings: GatewaySettings
}): Promise<{ id: string; url: string }> {
  if (!isGatewayConfigured(params.settings)) {
    throw new GatewayNotConfiguredError()
  }

  const base = params.settings.apiBase.replace(/\/+$/, '')
  const res = await fetch(`${base}/v1/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.settings.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': params.merchantTransactionId,
    },
    body: JSON.stringify({
      amount: Math.round(params.amountPkr),
      currency: 'PKR',
      methods: ['jazzcash', 'easypaisa', 'card'],
      customer: { phone: params.phone },
      return_url: params.returnUrl,
      webhook_url: params.webhookUrl,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    logger.error({ status: res.status, detail }, 'gateway create session failed')
    throw new Error(`Gateway request failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }

  const data = (await res.json()) as { id?: string; checkout_url?: string }
  if (!data.id || !data.checkout_url) {
    throw new Error('Gateway did not return a checkout URL')
  }
  return { id: data.id, url: data.checkout_url }
}

export interface GatewayWebhookInput {
  rawBody: string
  timestamp?: string
  signature: string
  webhookSecret: string
}

export function verifyGatewayWebhook(input: GatewayWebhookInput): boolean {
  const { rawBody, timestamp, signature, webhookSecret } = input
  if (!signature || !webhookSecret) return false

  // New scheme: HMAC-SHA256(timestamp + '.' + rawBody) using the webhook secret,
  // uppercase hex, valid within a 5-minute window.
  if (timestamp) {
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex')
      .toUpperCase()
    if (safeEqual(expected, signature)) {
      const now = Math.floor(Date.now() / 1000)
      return Math.abs(now - Number(timestamp)) <= 300
    }
  }

  // Legacy scheme: HMAC-SHA256(rawBody), hex (lowercase).
  const legacy = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
  return safeEqual(legacy, signature)
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}
