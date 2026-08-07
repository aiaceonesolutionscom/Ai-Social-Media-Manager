import { CancelledPublishError, publishImage } from '../lib/instagram.js'
import { publishToFacebook } from '../lib/facebook.js'
import { logger } from '../lib/logger.js'
import { sendReplyButtons, sendText } from '../lib/whatsapp.js'
import { fullCaption, platformCaption } from '../lib/caption.js'
import { getPost, getUser, getPackage, resolveUserPhone, setConversation, setStage, getAccountByPlatform } from '../store.js'
import { getTokenCost, deductTokens } from '../lib/tokens.js'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../db.js'
import { scheduledPosts } from '../db/schema.js'

async function getPlatformLabel(phone: string): Promise<string> {
  const user = await getUser(phone)
  const pkg = user?.packageId ? await getPackage(user.packageId) : null
  const features = (pkg?.features || {}) as Record<string, boolean>
  const hasIG = features.instagram_publishing === true
  const hasFB = features.facebook_publishing === true
  if (hasIG && hasFB) return 'social media'
  if (hasIG) return 'Instagram'
  return 'Facebook'
}

export interface PublishJob {
  postId: string
  phone: string
  userPhone: string
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

  const userPhone = await resolveUserPhone(post.phone)
  const user = await getUser(userPhone)
  if (user) {
    const { tokenEngine } = await import('../lib/TokenEngine.js')
    const estimate = await tokenEngine.estimate('standard_post', userPhone)
    if (!estimate.canAfford) {
      throw new Error('Insufficient tokens. Please upgrade your plan or buy more tokens.')
    }
    const deduction = await tokenEngine.deduct('standard_post', userPhone, `Post publish: ${postId}`)
    if (!deduction.success) {
      throw new Error('Failed to reserve tokens. Please try again.')
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
    userPhone,
    cancelRequested: false,
    pointOfNoReturn: false,
    cancelledNotified: false,
    createdAt: new Date().toISOString(),
  }
  jobs.set(postId, job)

  void runPublish(job)
}

async function runPublish(job: PublishJob): Promise<void> {
  const { postId, phone, userPhone } = job
  try {
    const platformLabel = await getPlatformLabel(userPhone)
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
    const igAccount = await getAccountByPlatform(userPhone, 'instagram')
    const fbAccount = await getAccountByPlatform(userPhone, 'facebook')

    // Check package features for platform publishing
    const user = await getUser(userPhone)
    const pkg = user?.packageId ? await getPackage(user.packageId) : null
    const features = (pkg?.features || {}) as Record<string, boolean>

    const canPublishIG = features.instagram_publishing === true && !!igAccount
    const canPublishFB = features.facebook_publishing === true && !!fbAccount

    if (!canPublishIG && !canPublishFB) {
      throw new Error('Your package does not include any publishing platform. Please upgrade your plan.')
    }

    const maxAttempts = 2
    let result: { mediaId: string; permalink: string } | undefined
    let publishedFB = false
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (canPublishIG) {
          const igCaption = post.platformContent?.instagram
            ? platformCaption(post.platformContent.instagram, 'instagram')
            : fullCaption(post.content!)
          result = await publishImage(post.imageUrl!, igCaption, undefined, {
            shouldCancel: () => job.cancelRequested,
            onBeforePublish: () => {
              job.pointOfNoReturn = true
            },
          }, {
            accessToken: igAccount?.accessToken,
            igUserId: igAccount?.accountId,
          })
        } else if (canPublishFB && fbAccount) {
          const fbCaption = post.platformContent?.facebook
            ? platformCaption(post.platformContent.facebook, 'facebook')
            : fullCaption(post.content!)
          const fbResult = await publishToFacebook(post.imageUrl!, fbCaption, fbAccount.accountId, fbAccount.accessToken)
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
        const fbCaption = post.platformContent?.facebook
          ? platformCaption(post.platformContent.facebook, 'facebook')
          : fullCaption(post.content!)
        await publishToFacebook(post.imageUrl!, fbCaption, fbAccount.accountId, fbAccount.accessToken)
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
      `✅ Published!\n\nPost: ${result.permalink}\n\nDate & Time: ${new Date().toLocaleString()}\n\nSuccess! Your ${platformLabel} post is live.`,
    )
    logger.info({ postId, mediaId: result.mediaId }, 'publish done')
  } catch (err) {
    if (err instanceof CancelledPublishError || job.cancelRequested) {
      await finalizeCancel(job)
      return
    }
    logger.error({ postId, error: (err as Error).message }, 'publish failed')
    try {
      const { tokenEngine } = await import('../lib/TokenEngine.js')
      await tokenEngine.refund('standard_post', userPhone, `Refund for failed publish: ${postId}`)
    } catch (refundErr) {
      logger.error({ postId, error: (refundErr as Error).message }, 'failed to refund tokens after publish failure')
    }
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
    if (jobs.get(postId) === job) {
      jobs.delete(postId)
    }
  }
}

async function finalizeCancel(job: PublishJob): Promise<void> {
  if (job.cancelledNotified) return
  const { postId, phone, userPhone } = job
  job.cancelledNotified = true
  await setStage(postId, 'CANCELLED')
  await setConversation(phone, { kind: 'awaiting_approval', postId })
  try {
    const { tokenEngine } = await import('../lib/TokenEngine.js')
    await tokenEngine.refund('standard_post', userPhone, `Refund for cancelled publish: ${postId}`)
  } catch (refundErr) {
    logger.error({ postId, error: (refundErr as Error).message }, 'failed to refund tokens after cancel')
  }
  await sendText(
    phone,
    `✅ Publishing has been cancelled successfully.\n\nYour post was not published.\n\nYou can continue editing the post or publish it later.`,
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
  try {
    const { tokenEngine } = await import('../lib/TokenEngine.js')
    await tokenEngine.refund('standard_post', job.userPhone, `Refund for cancelled publish: ${postId}`)
  } catch (refundErr) {
    logger.error({ postId, error: (refundErr as Error).message }, 'failed to refund tokens after cancel')
  }
  await sendText(
    job.phone,
    `✅ Publishing has been cancelled successfully.\n\nYour post was not published.\n\nYou can continue editing the post or publish it later.`,
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

interface ScheduledPost {
  postId: string
  phone: string
  publishAt: string
}

let schedulerInterval: NodeJS.Timeout | null = null

export async function schedulePost(postId: string, phone: string, publishAt: string): Promise<void> {
  const now = new Date().toISOString()
  await getDb().insert(scheduledPosts).values({
    id: crypto.randomUUID(),
    postId,
    phone,
    publishAt,
    status: 'pending',
    createdAt: now,
  })
  logger.info({ postId, publishAt }, 'post scheduled for publishing')
}

export async function cancelScheduledPost(postId: string): Promise<boolean> {
  const result = await getDb().update(scheduledPosts).set({ status: 'cancelled' }).where(eq(scheduledPosts.postId, postId))
  return true
}

export async function getScheduledPosts(_phone?: string): Promise<ScheduledPost[]> {
  const db = getDb()
  const query = db.select().from(scheduledPosts).where(eq(scheduledPosts.status, 'pending')).orderBy(scheduledPosts.publishAt)
  const results = await query
  return results.map((r) => ({ postId: r.postId, phone: r.phone, publishAt: r.publishAt }))
}

function startScheduler(): void {
  if (schedulerInterval) return
  schedulerInterval = setInterval(async () => {
    try {
      const now = new Date().toISOString()
      const db = getDb()
      const due = await db.select().from(scheduledPosts).where(sql`${scheduledPosts.status} = 'pending' AND ${scheduledPosts.publishAt} <= ${now}`)

      for (const item of due) {
        await db.update(scheduledPosts).set({ status: 'processing' }).where(eq(scheduledPosts.id, item.id))
        try {
          await enqueuePublish(item.postId)
          await db.update(scheduledPosts).set({ status: 'completed', processedAt: now }).where(eq(scheduledPosts.id, item.id))
        } catch (err) {
          logger.error({ postId: item.postId, error: (err as Error).message }, 'scheduled publish failed')
          await db.update(scheduledPosts).set({ status: 'failed' }).where(eq(scheduledPosts.id, item.id))
        }
      }
    } catch (err) {
      logger.error({ err }, 'scheduler tick failed')
    }
  }, 60_000)
}

export function startPublishScheduler(): void {
  startScheduler()
  logger.info('publish scheduler started')
}

export function stopPublishScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}
