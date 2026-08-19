import { CancelledPublishError, publishImage } from '../lib/instagram.js'
import { publishToFacebook } from '../lib/facebook.js'
import { logger } from '../lib/logger.js'
import { fullCaption, platformCaption } from '../lib/caption.js'
import { getPost, getUser, getPackage, resolveUserPhone, setConversation, setStage, getAccountByPlatform } from '../store.js'
import { getTokenCost, deductTokens } from '../lib/tokens.js'
import { sendText } from '../lib/whatsapp.js'
import { auditLogger } from '../lib/AuditLogger.js'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '../db.js'
import { scheduledPosts } from '../db/schema.js'

// Token action charged for a post publish, based on the platforms the user's
// package includes. Publishing to both Instagram + Facebook costs more
// (cost_cross_platform), a single platform costs cost_standard_post.
export async function getPublishTokenAction(userPhone: string): Promise<'standard_post' | 'cross_platform'> {
  const user = await getUser(userPhone)
  const pkg = user?.packageId ? await getPackage(user.packageId) : null
  const features = (pkg?.features || {}) as Record<string, boolean>
  const hasIG = features.instagram_publishing === true
  const hasFB = features.facebook_publishing === true
  // Only charge the cross-platform rate when the user is actually connected to
  // both platforms AND their package includes both.
  const [igAccount, fbAccount] = await Promise.all([
    getAccountByPlatform(userPhone, 'instagram').catch(() => undefined),
    getAccountByPlatform(userPhone, 'facebook').catch(() => undefined),
  ])
  const igReady = !!igAccount && hasIG
  const fbReady = !!fbAccount && hasFB
  if (igReady && fbReady) return 'cross_platform'
  return 'standard_post'
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
  if (!post.content || (!post.imageUrl && !post.content.caption)) throw new Error('Post has no content or image to publish')

  const userPhone = await resolveUserPhone(post.phone)

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
    await setStage(postId, 'PREPARING_TO_PUBLISH')
    await setConversation(phone, { kind: 'preparing_publish', postId })
    await sendText(phone, `✅ Your post has been approved.\n\n⏳ Preparing your post for publishing...\nPlease wait while I upload and publish it.`)

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
    await auditLogger.log({ actor: userPhone, actorType: 'user', action: 'post.publish', target: userPhone, targetType: 'user', details: { postId, permalink: result.permalink } })
    await sendText(phone, `✅ Published!\n\nPost: ${result.permalink}\n\nDate & Time: ${new Date().toLocaleString()}\n\nSuccess! Your post is live.`)
    logger.info({ postId, mediaId: result.mediaId }, 'publish done')
  } catch (err) {
    if (err instanceof CancelledPublishError || job.cancelRequested) {
      await finalizeCancel(job)
      return
    }
    logger.error({ postId, error: (err as Error).message }, 'publish failed')
    try {
      const { tokenEngine } = await import('../lib/TokenEngine.js')
      await tokenEngine.refundPost(postId, userPhone, `Refund for failed publish: ${postId}`)
    } catch (refundErr) {
      logger.error({ postId, error: (refundErr as Error).message }, 'failed to refund tokens after publish failure')
    }
    try {
      await setStage(postId, 'FAILED', { error: (err as Error).message })
      await setConversation(phone, { kind: 'awaiting_approval', postId })
      await sendText(phone, `❌ Publishing failed: ${(err as Error).message}\n\nYou can try publishing again or keep editing.`)
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
    await tokenEngine.refundPost(postId, userPhone, `Refund for cancelled publish: ${postId}`)
  } catch (refundErr) {
    logger.error({ postId, error: (refundErr as Error).message }, 'failed to refund tokens after cancel')
  }
  await sendText(phone, `✅ Publishing has been cancelled successfully.\n\nYour post was not published.\n\nYou can continue editing the post or publish it later.`)
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
    await tokenEngine.refundPost(postId, job.userPhone, `Refund for cancelled publish: ${postId}`)
  } catch (refundErr) {
    logger.error({ postId, error: (refundErr as Error).message }, 'failed to refund tokens after cancel')
  }
  await sendText(job.phone, `✅ Publishing has been cancelled successfully.\n\nYour post was not published.\n\nYou can continue editing the post or publish it later.`)
  logger.info({ postId }, 'publish cancelled by user')
  return 'cancelled'
}

export function pendingPublishCount(): number {
  return jobs.size
}

export function resetPublishJobs(): void {
  jobs.clear()
}

let schedulerInterval: NodeJS.Timeout | null = null

export async function schedulePost(postId: string, phone: string, publishAt: string): Promise<'scheduled' | 'rescheduled'> {
  const now = new Date().toISOString()
  // Idempotent: if this post already has a pending scheduled row, update its time
  // instead of inserting a duplicate (the "reschedule" case).
  const existing = await getDb().select({ id: scheduledPosts.id }).from(scheduledPosts)
    .where(and(eq(scheduledPosts.postId, postId), sql`${scheduledPosts.status} IN ('pending', 'processing')`))
    .limit(1)
  if (existing.length > 0) {
    await getDb().update(scheduledPosts)
      .set({ publishAt })
      .where(eq(scheduledPosts.id, existing[0].id))
    logger.info({ postId, publishAt }, 'post rescheduled (updated existing scheduled row)')
    return 'rescheduled'
  }
  await getDb().insert(scheduledPosts).values({
    id: crypto.randomUUID(),
    postId,
    phone,
    publishAt,
    status: 'pending',
    createdAt: now,
  })
  logger.info({ postId, publishAt }, 'post scheduled for publishing')
  return 'scheduled'
}

export async function cancelScheduledPost(postId: string): Promise<boolean> {
  const result = await getDb().update(scheduledPosts).set({ status: 'cancelled' }).where(eq(scheduledPosts.postId, postId))
  return true
}

export interface ScheduledPostInfo {
  id: string
  postId: string
  publishAt: string
  status: string
  caption?: string
  imageUrl?: string
}

export async function getScheduledPosts(phone?: string): Promise<ScheduledPostInfo[]> {
  const db = getDb()
  const base = db.select().from(scheduledPosts)
  const rows = phone
    ? await base.where(and(eq(scheduledPosts.phone, await resolveUserPhone(phone)), sql`${scheduledPosts.status} IN ('pending', 'processing')`)).orderBy(scheduledPosts.publishAt)
    : await base.where(sql`${scheduledPosts.status} IN ('pending', 'processing')`).orderBy(scheduledPosts.publishAt)
  const out: ScheduledPostInfo[] = []
  for (const row of rows) {
    const post = await getPost(row.postId)
    out.push({
      id: row.id,
      postId: row.postId,
      publishAt: row.publishAt,
      status: row.status,
      caption: post?.content?.caption || post?.transcript,
      imageUrl: post?.imageUrl,
    })
  }
  return out
}

export async function cancelScheduledPostById(id: string, phone: string): Promise<boolean> {
  const rows = await getDb().update(scheduledPosts)
    .set({ status: 'cancelled' })
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.phone, await resolveUserPhone(phone)), eq(scheduledPosts.status, 'pending')))
    .returning()
  return rows.length > 0
}

export async function rescheduleScheduledPost(id: string, phone: string, publishAt: string): Promise<boolean> {
  const rows = await getDb().update(scheduledPosts)
    .set({ publishAt })
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.phone, await resolveUserPhone(phone)), eq(scheduledPosts.status, 'pending')))
    .returning()
  return rows.length > 0
}

// Minimal fallback: only accept already-ISO timestamps or explicit 4-digit-year
// dates. All natural-language parsing ("kal raat 8", "15 August at 9am", etc.)
// is delegated to the LLM via normalizeScheduleTime.
export function parseScheduleTime(value: string): string | null {
  if (!value) return null
  const text = value.trim()
  const now = new Date()

  if (!Number.isNaN(Date.parse(text))) {
    if (/\b\d{4}\b/.test(text) || /^\d{4}-\d{2}-\d{2}/.test(text)) {
      const d = new Date(text)
      return d > now ? d.toISOString() : null
    }
  }

  return null
}

// Resolve a natural-language time/date to a future ISO string. Fast-path ISO
// values; everything else is converted by the LLM (no hardcoded patterns).
export async function normalizeScheduleTime(value: string): Promise<string | null> {
  const parsed = parseScheduleTime(value)
  if (parsed) return parsed
  try {
    const now = new Date().toISOString()
    const { chatJson } = await import('../lib/llm.js')
    const result = await chatJson<{ iso: string }>(
      [
        {
          role: 'system',
          content: `You convert natural-language time/date expressions into ISO-8601 timestamps. The current time is ${now} (UTC). The scheduled moment MUST be in the future. Output ONLY a JSON object: {"iso": "..."} — an ISO-8601 timestamp. If you cannot determine a future time, set "iso": "".`,
        },
        { role: 'user', content: `When should the post be published? "${value}"` },
      ],
      { temperature: 0 },
    )
    if (!result?.iso) return null
    const d = new Date(result.iso)
    return !Number.isNaN(d.getTime()) && d > new Date() ? d.toISOString() : null
  } catch (err) {
    logger.warn({ error: (err as Error).message, value }, 'LLM time normalization failed')
    return null
  }
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
