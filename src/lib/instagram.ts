import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { fetchWithRetry } from './http.js'
import { logger } from './logger.js'
import { metaConfig } from './metaConfig.js'

function getBaseUrl(): string {
  return `https://graph.facebook.com/${metaConfig.getInstagramApiVersion()}`
}

function getFallbackToken(): string {
  return config.instagram.accessToken || ''
}

export class CancelledPublishError extends Error {
  constructor() {
    super('Publishing cancelled by user')
    this.name = 'CancelledPublishError'
  }
}

async function igGet(url: string, accessToken?: string): Promise<Record<string, unknown>> {
  const token = accessToken || getFallbackToken()
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`IG GET ${res.status}: ${JSON.stringify(body)}`)
  return body
}

async function igPost(url: string, body: Record<string, unknown>, accessToken?: string): Promise<Record<string, unknown>> {
  const token = accessToken || getFallbackToken()
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`IG POST ${res.status}: ${JSON.stringify(data)}`)
  return data
}

function waitForContainer(
  containerId: string,
  opts: { shouldCancel?: () => boolean; timeoutMs?: number; accessToken?: string; igUserId?: string } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const token = opts.accessToken || getFallbackToken()
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = async () => {
      const elapsed = Date.now() - start
      if (elapsed > timeoutMs) {
        reject(new Error(`Timed out waiting for container ${containerId}`))
        return
      }
      if (opts.shouldCancel?.()) {
        reject(new CancelledPublishError())
        return
      }
      try {
        const status = await igGet(
          `${getBaseUrl()}/${containerId}?fields=status_code&access_token=${token}`,
          token
        )
        const code = (status.status_code as string) ?? ''
        if (code === 'FINISHED') return resolve()
        if (code === 'ERROR') return reject(new Error(`Container ${containerId} error: ${JSON.stringify(status)}`))
        setTimeout(poll, 2000)
      } catch (err) {
        reject(err as Error)
      }
    }
    poll()
  })
}

export interface PublishCallbacks {
  onBeforePublish?: () => void
  shouldCancel?: () => boolean
}

export interface PublishResult {
  mediaId: string
  permalink: string
}

export async function publishImage(
  imageUrl: string,
  caption: string,
  publishAt?: string,
  callbacks: PublishCallbacks = {},
  options: { accessToken?: string; igUserId?: string } = {},
): Promise<PublishResult> {
  const token = options.accessToken || getFallbackToken()
  const igUserId = options.igUserId || config.instagram.igUserId
  const isMock = config.dev.enabled && (!igUserId || !token || token.startsWith('dev_'))
  if (isMock) {
    logger.info({ igUserId }, 'DEV MODE: Instagram publish skipped (no real token) — simulating success')
    if (callbacks.shouldCancel?.()) throw new CancelledPublishError()
    await new Promise((r) => setTimeout(r, 800))
    if (callbacks.shouldCancel?.()) throw new CancelledPublishError()
    callbacks.onBeforePublish?.()
    const mediaId = `DEV_${randomUUID().slice(0, 12)}`
    return { mediaId, permalink: `https://www.instagram.com/p/${mediaId}/` }
  }
  if (!igUserId) throw new Error('INSTAGRAM_IG_USER_ID is not set')
  if (!token) throw new Error('INSTAGRAM_ACCESS_TOKEN is not set')

  if (callbacks.shouldCancel?.()) throw new CancelledPublishError()

  const containerBody: Record<string, unknown> = {
    image_url: imageUrl,
    caption,
    media_type: 'IMAGE',
  }
  if (publishAt) containerBody.published_at = publishAt

  const container = await igPost(`${getBaseUrl()}/${igUserId}/media`, containerBody, token)
  const containerId = container.id as string
  if (!containerId) throw new Error('No container id returned')

  await waitForContainer(containerId, { shouldCancel: callbacks.shouldCancel, accessToken: token, igUserId })

  if (callbacks.shouldCancel?.()) throw new CancelledPublishError()

  callbacks.onBeforePublish?.()

  const publish = await igPost(`${getBaseUrl()}/${igUserId}/media_publish`, {
    creation_id: containerId,
  }, token)

  const mediaId = publish.id as string

  const mediaInfo = await igGet(`${getBaseUrl()}/${mediaId}?fields=permalink&access_token=${token}`, token)
  const permalink = (mediaInfo.permalink as string) ?? `https://www.instagram.com/p/${mediaId}/`

  return { mediaId, permalink }
}
