import { CancelledPublishError, publishImage } from '../lib/instagram.js'
import { publishToFacebook } from '../lib/facebook.js'
import { logger } from '../lib/logger.js'
import { sendReplyButtons, sendText } from '../lib/whatsapp.js'
import { fullCaption } from '../lib/caption.js'
import { getPost, getUser, getPackage, setConversation, setStage, getAccountByPlatform } from '../store.js'
import { getTokenCost, deductTokens } from '../lib/tokens.js'

async function getPlatformLabel(phone: string): Promise<string> {
  const user = await getUser(phone)
  const pkg = user?.packageId ? await getPackage(user.packageId) : null
  const features = (pkg?.features || {}) as Record<string, boolean>
  const hasIG = features.instagram_publishing !== false
  const hasFB = features.facebook_publishing !== false
  if (hasIG && hasFB) return 'social media'
  if (hasIG) return 'Instagram'
  return 'Facebook'
}

export interface PublishJob {
  postId: string
  phone: string
  cancelRequested: boolean
  pointOfNoReturn: boolean
  cancelledNotified: boolean
  createdAt: string
}

const jobs = new Map<string, PublishJob>()

export function getPublishJob(postId: string): PublishJob | undefined {
  return jobs.get(postId)
}

export async function enqueuePublish(postId: string): Promise<void> {
  const post = await getPost(postId)
  if (!post) throw new Error(`Post ${postId} not found`)
  if (!post.content || !post.imageUrl) throw new Error('Post has no content or image to publish')

  const user = await getUser(post.phone)
  if (user) {
    const cost = await getTokenCost('standard_post')
    if (cost > 0 && user.tokensRemaining < cost) {
      throw new Error('Insufficient tokens. Please upgrade your plan or buy more tokens.')
    }
  }

  const existing = jobs.get(postId)
  if (existing) {
    if (existing.pointOfNoReturn) {
      throw new Error('This post is already being published and cannot be cancelled.')
    }
    if (!existing.cancelledNotified) {
      throw new Error('This post is already preparing to publish. Use cancel to stop it first.')
    }
    jobs.delete(postId)
  }

  const job: PublishJob = {
    postId,
    phone: post.phone,
    cancelRequested: false,
    pointOfNoReturn: false,
    cancelledNotified: false,
    createdAt: new Date().toISOString(),
  }
  jobs.set(postId, job)

  void runPublish(job)
}

async function runPublish(job: PublishJob): Promise<void> {
  const { postId, phone } = job
  try {
    const platformLabel = await getPlatformLabel(phone)
    await setStage(postId, 'PREPARING_TO_PUBLISH')
    await setConversation(phone, { kind: 'preparing_publish', postId })

    await sendText(
      phone,
      `✅ Your post has been approved.\n\n⏳ Preparing your ${platformLabel} post...\nPlease wait while I upload and publish it.\n\nIf you changed your mind, you can cancel publishing before the final publish step.`,
    )
    await sendReplyButtons(phone, 'Cancel publishing?', [{ id: 'cancel', title: 'Cancel' }])

    if (job.cancelRequested) {
      await finalizeCancel(job)
      return
    }

    await setStage(postId, 'PUBLISHING')
    await setConversation(phone, { kind: 'publishing', postId })

    const post = await getPost(postId)
    if (!post) throw new Error(`Post ${postId} not found`)

    // Look up user's connected social accounts
    const igAccount = await getAccountByPlatform(phone, 'instagram')
    const fbAccount = await getAccountByPlatform(phone, 'facebook')

    // Check package features for platform publishing
    const user = await getUser(phone)
    const pkg = user?.packageId ? await getPackage(user.packageId) : null
    const features = (pkg?.features || {}) as Record<string, boolean>

    const canPublishIG = features.instagram_publishing !== false
    const canPublishFB = features.facebook_publishing !== false

    if (!canPublishIG && !canPublishFB) {
      throw new Error('Your package does not include any publishing platform. Please upgrade your plan.')
    }

    const maxAttempts = 2
    let result: { mediaId: string; permalink: string } | undefined
    let publishedFB = false
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (canPublishIG) {
          result = await publishImage(post.imageUrl!, fullCaption(post.content!), undefined, {
            shouldCancel: () => job.cancelRequested,
            onBeforePublish: () => {
              job.pointOfNoReturn = true
            },
          }, {
            accessToken: igAccount?.accessToken,
            igUserId: igAccount?.accountId,
          })
        } else if (canPublishFB && fbAccount) {
          const fbResult = await publishToFacebook(post.imageUrl!, fullCaption(post.content!), fbAccount.accountId, fbAccount.accessToken)
          result = { mediaId: fbResult.postId, permalink: fbResult.permalink }
          publishedFB = true
        }
        break
      } catch (err) {
        if (err instanceof CancelledPublishError || job.cancelRequested) {
          throw err
        }
        if (job.pointOfNoReturn) {
          throw err
        }
        if (attempt >= maxAttempts) throw err
        logger.warn({ postId, attempt }, 'publish attempt failed, retrying')
        await new Promise((r) => setTimeout(r, 800))
      }
    }

    // Also publish to Facebook if connected and feature allowed and not already published
    if (canPublishFB && fbAccount && !publishedFB && result) {
      try {
        await publishToFacebook(post.imageUrl!, fullCaption(post.content!), fbAccount.accountId, fbAccount.accessToken)
        logger.info({ postId }, 'also published to Facebook')
      } catch (fbErr) {
        logger.warn({ postId, error: (fbErr as Error).message }, 'Facebook publish failed (non-blocking)')
      }
    }

    if (job.cancelRequested) {
      await finalizeCancel(job)
      return
    }

    if (!result) throw new Error('Publish returned no result')

    await setStage(postId, 'DONE', {
      mediaId: result.mediaId,
      permalink: result.permalink,
      publishedAt: new Date().toISOString(),
    })
    await setConversation(phone, { kind: 'idle', postId })
    await sendText(
      phone,
      `✅ Published!\n\nPost: ${result.permalink}\n\nDate & Time: ${new Date().toISOString()}\n\nSuccess! Your ${platformLabel} post is live.`,
    )
    logger.info({ postId, mediaId: result.mediaId }, 'publish done')

    const tokenCost = await getTokenCost('standard_post')
    if (tokenCost > 0) {
      await deductTokens(phone, tokenCost, postId, `Published post`)
    }
    // Cross-platform cost applies when the post went out on both platforms
    if (canPublishIG && canPublishFB && fbAccount) {
      const crossCost = await getTokenCost('cross_platform')
      if (crossCost > 0) {
        const deducted = await deductTokens(phone, crossCost, postId, `Cross-platform publishing`)
        if (!deducted) {
          logger.warn({ postId }, 'could not deduct cross-platform cost — publish already succeeded')
        }
      }
    }
  } catch (err) {
    if (err instanceof CancelledPublishError || job.cancelRequested) {
      await finalizeCancel(job)
      return
    }
    logger.error({ postId, error: (err as Error).message }, 'publish failed')
    try {
      await setStage(postId, 'FAILED', { error: (err as Error).message })
      await setConversation(phone, { kind: 'awaiting_approval', postId })
      await sendText(
        phone,
        `❌ Publishing failed: ${(err as Error).message}\n\nYou can try publishing again or keep editing.`,
      )
    } catch {
      logger.warn({ postId }, 'could not update post after publish failure — post may have been removed')
    }
  } finally {
    jobs.delete(postId)
  }
}

async function finalizeCancel(job: PublishJob): Promise<void> {
  if (job.cancelledNotified) return
  const { postId, phone } = job
  job.cancelledNotified = true
  await setStage(postId, 'CANCELLED')
  await setConversation(phone, { kind: 'awaiting_approval', postId })
  await sendText(
    phone,
    `✅ Publishing has been cancelled successfully.\n\nYour Instagram post was not published.\n\nYou can continue editing the post or publish it later.`,
  )
  logger.info({ postId }, 'publish cancelled')
}

export async function cancelPublish(postId: string): Promise<'cancelled' | 'too_late' | 'not_found'> {
  const job = jobs.get(postId)
  const post = await getPost(postId)
  if (!post || (post.status !== 'PREPARING_TO_PUBLISH' && post.status !== 'PUBLISHING')) {
    if (post && post.status === 'CANCELLED') return 'not_found'
    return 'not_found'
  }
  if (!job) return 'not_found'
  if (job.pointOfNoReturn) return 'too_late'
  if (job.cancelRequested) return 'cancelled'

  job.cancelRequested = true
  await setStage(postId, 'CANCELLED')
  await setConversation(job.phone, { kind: 'awaiting_approval', postId })
  job.cancelledNotified = true
  await sendText(
    job.phone,
    `✅ Publishing has been cancelled successfully.\n\nYour Instagram post was not published.\n\nYou can continue editing the post or publish it later.`,
  )
  logger.info({ postId }, 'publish cancelled by user')
  return 'cancelled'
}

export function pendingPublishCount(): number {
  return jobs.size
}

export function resetPublishJobs(): void {
  jobs.clear()
}
