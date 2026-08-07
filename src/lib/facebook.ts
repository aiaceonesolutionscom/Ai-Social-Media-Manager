import { config } from '../config.js'
import { fetchWithRetry } from './http.js'
import { logger } from './logger.js'

export interface FacebookPublishResult {
  postId: string
  permalink: string
}

async function fbGet(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const separator = url.includes('?') ? '&' : '?'
  const fullUrl = `https://graph.facebook.com/${config.instagram.apiVersion}${url}${separator}access_token=${accessToken}`

  const res = await fetchWithRetry(fullUrl)
  const body = await res.json() as Record<string, unknown>

  if (!res.ok) {
    throw new Error(`Facebook API error: ${JSON.stringify(body)}`)
  }

  return body
}

async function fbPost(url: string, body: Record<string, unknown>, accessToken: string): Promise<Record<string, unknown>> {
  const fullUrl = `https://graph.facebook.com/${config.instagram.apiVersion}${url}`

  const res = await fetchWithRetry(fullUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const responseBody = await res.json() as Record<string, unknown>

  if (!res.ok) {
    throw new Error(`Facebook API error: ${JSON.stringify(responseBody)}`)
  }

  return responseBody
}

async function waitForPostProcessing(postId: string, accessToken: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const result = await fbGet(`/${postId}?fields=status`, accessToken)
    const status = result.status as number

    if (status === 0) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error('Facebook post processing timeout')
}

export async function publishToFacebook(
  imageUrl: string,
  caption: string,
  pageId: string,
  accessToken: string
): Promise<FacebookPublishResult> {
  const isMock = config.dev.enabled && (!pageId || !accessToken || accessToken.startsWith('dev_'))
  if (isMock) {
    logger.info({ pageId }, 'DEV MODE: Facebook publish skipped (no real token) — simulating success')
    const postId = `DEV_${Date.now()}`
    return { postId, permalink: `https://facebook.com/${postId}` }
  }
  if (!pageId || !accessToken) {
    throw new Error('Facebook page ID and access token are required')
  }

  logger.info({ pageId }, 'publishing to Facebook')

  const createResult = await fbPost(`/${pageId}/photos`, {
    url: imageUrl,
    message: caption,
    published: true,
  }, accessToken)

  const postId = createResult.id as string
  if (!postId) {
    throw new Error('Failed to create Facebook post: no ID returned')
  }

  logger.info({ postId }, 'Facebook post created, waiting for processing')

  await waitForPostProcessing(postId, accessToken)

  let permalink = `https://facebook.com/${postId}`
  try {
    const postDetails = await fbGet(`/${postId}?fields=permalink_url`, accessToken)
    if (postDetails.permalink_url) {
      permalink = postDetails.permalink_url as string
    }
  } catch (err) {
    logger.warn({ postId, error: (err as Error).message }, 'could not fetch Facebook permalink')
  }

  logger.info({ postId, permalink }, 'Facebook post published')
  return { postId, permalink }
}

export function validateFacebookConfig(): boolean {
  return !!(config.facebook.pageId && config.facebook.accessToken)
}
