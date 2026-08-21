import { CancelledPublishError, publishImage } from '../lib/instagram.js'
import { publishToFacebook } from '../lib/facebook.js'
import { logger } from '../lib/logger.js'
import { captionForPlatform } from '../lib/caption.js'
import { notifyPostPublished, notifyPostFailed } from '../lib/notifications.js'
import { getPost, getUser, getPackage, resolveUserPhone, setConversation, setStage, getAccountByPlatform } from '../store.js'
import { getUserFeatures } from '../lib/packagePermissions.js'
import type { PublishPlatform, PlatformPublishState } from '../types.js'
import { getTokenCost, deductTokens } from '../lib/tokens.js'
import { sendText, sendReplyButtons } from '../lib/whatsapp.js'
import { imageUrlForPlatform } from '../lib/platformImages.js'
import { naiveToUTC, nowInZone } from '../lib/timezone.js'
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
  completion?: Promise<string>
}

const jobs = new Map<string, PublishJob>()

export function getPublishJob(postId: string): PublishJob | undefined {
  return jobs.get(postId)
}

// Enqueues the post and returns a promise that resolves with the post's final
// status once the publish attempt fully settles (DONE / PARTIAL_SUCCESS /
// FAILED / CANCELLED). P1-7 — callers (the scheduler) must not treat a post as
// published just because it was enqueued.
export async function enqueuePublish(postId: string): Promise<string> {
  const post = await getPost(postId)
  if (!post) throw new Error(`Post ${postId} not found`)
  if (!post.content || !post.imageUrl) throw new Error('This post has no image to publish. Regenerate the post so the image can be created first.')
  // P1-7 — never re-publish a post that is already in a terminal state.
  if (post.status === 'DONE' || post.status === 'PARTIAL_SUCCESS' || post.status === 'CANCELLED') {
    return post.status
  }

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

  const completion = runPublish(job)
    .then(async () => (await getPost(postId))?.status ?? 'FAILED')
    .catch(() => 'FAILED')
  job.completion = completion
  return completion
}

async function runPublish(job: PublishJob): Promise<void> {
  const { postId, phone, userPhone } = job
  const platformStatuses: Partial<Record<PublishPlatform, PlatformPublishState>> = {}
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

    // Entitlement gate: getUserFeatures reflects the live package state (it
    // returns {} once the package expires or is revoked), so an expired or
    // ended plan can never publish.
    const features = await getUserFeatures(userPhone)
    const canPublishIG = features.instagram_publishing === true && !!igAccount
    const canPublishFB = features.facebook_publishing === true && !!fbAccount

    if (!canPublishIG && !canPublishFB) {
      throw new Error('Your package does not include any publishing platform (or it has expired). Please renew your plan.')
    }

    const maxAttempts = 2
    // Instagram is the primary platform and gets the retry loop.
    if (canPublishIG) {
      const igCaption = captionForPlatform(post, 'instagram')
      const igImageUrl = await imageUrlForPlatform(post.imageUrl!, postId, 'instagram')
      let igResult: { mediaId: string; permalink: string } | undefined
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          igResult = await publishImage(igImageUrl, igCaption, undefined, {
            shouldCancel: () => job.cancelRequested,
            onBeforePublish: () => {
              job.pointOfNoReturn = true
            },
          }, {
            accessToken: igAccount?.accessToken,
            igUserId: igAccount?.accountId,
          })
          break
        } catch (err) {
          if (err instanceof CancelledPublishError || job.cancelRequested) throw err
          if (job.pointOfNoReturn || attempt >= maxAttempts) {
            platformStatuses.instagram = { status: 'failed', error: (err as Error).message }
            break
          }
          logger.warn({ postId, attempt }, 'instagram publish attempt failed, retrying')
          await new Promise((r) => setTimeout(r, 800))
        }
      }
      if (igResult) {
        platformStatuses.instagram = {
          status: 'published',
          mediaId: igResult.mediaId,
          permalink: igResult.permalink,
          publishedAt: new Date().toISOString(),
        }
      }
    } else if (canPublishFB) {
      platformStatuses.instagram = { status: 'skipped', error: 'Instagram is not part of your plan or not connected' }
    }

    if (job.cancelRequested) {
      await finalizeCancel(job)
      return
    }

    // Facebook publishing is attempted independently and never blocks or
    // breaks the Instagram result (mirrors the previous non-blocking behavior
    // while recording the outcome so the failure is visible).
    if (canPublishFB && fbAccount) {
      const fbCaption = captionForPlatform(post, 'facebook')
      const fbImageUrl = await imageUrlForPlatform(post.imageUrl!, postId, 'facebook')
      try {
        const fbResult = await publishToFacebook(fbImageUrl, fbCaption, fbAccount.accountId, fbAccount.accessToken)
        platformStatuses.facebook = {
          status: 'published',
          mediaId: fbResult.postId,
          permalink: fbResult.permalink,
          publishedAt: new Date().toISOString(),
        }
        logger.info({ postId }, 'also published to Facebook')
      } catch (fbErr) {
        platformStatuses.facebook = { status: 'failed', error: (fbErr as Error).message }
        logger.warn({ postId, error: (fbErr as Error).message }, 'Facebook publish failed (non-blocking)')
      }
    } else if (canPublishIG) {
      platformStatuses.facebook = { status: 'skipped', error: 'Facebook is not part of your plan or not connected' }
    }

    if (job.cancelRequested) {
      await finalizeCancel(job)
      return
    }

    const published = Object.entries(platformStatuses).filter(([, s]) => s.status === 'published')
    const firstPublished = published[0]?.[1]

    if (published.length === 0) {
      const firstError = Object.values(platformStatuses)[0]?.error || 'Publish returned no result'
      throw new Error(firstError)
    }

    const primary = {
      mediaId: firstPublished!.mediaId,
      permalink: firstPublished!.permalink,
      publishedAt: firstPublished!.publishedAt,
    }

    const failedPlatforms = Object.entries(platformStatuses)
      .filter(([, s]) => s.status === 'failed')
      .map(([p]) => p)
    const attempted = Object.keys(platformStatuses).length

    if (failedPlatforms.length > 0 && attempted > published.length) {
      await setStage(postId, 'PARTIAL_SUCCESS', { ...primary, platformStatuses })
      await setConversation(phone, { kind: 'idle', postId })
      await auditLogger.log({ actor: userPhone, actorType: 'user', action: 'post.publish_partial', target: userPhone, targetType: 'user', details: { postId, platformStatuses } })
      const details = Object.entries(platformStatuses)
        .map(([p, s]) => `• ${p}: ${s.status}${s.permalink ? ` (${s.permalink})` : s.error ? ` — ${s.error}` : ''}`)
        .join('\n')
      await sendText(phone, `⚠️ Published on ${published.length} platform(s), but ${failedPlatforms.join(', ')} failed.\n\n${details}\n\nYou can edit and try publishing the failed platform again.`)
      logger.info({ postId, platformStatuses }, 'publish partially succeeded')
    } else {
      await setStage(postId, 'DONE', { ...primary, platformStatuses })
      await setConversation(phone, { kind: 'idle', postId })
      await auditLogger.log({ actor: userPhone, actorType: 'user', action: 'post.publish', target: userPhone, targetType: 'user', details: { postId, permalink: primary.permalink } })
      // P5-2 — wire the existing publish notification helpers (in-app notification
      // + WhatsApp confirmation) instead of an ad-hoc sendText.
      await notifyPostPublished(phone, primary.mediaId || '', primary.permalink || '')
      logger.info({ postId, mediaId: primary.mediaId }, 'publish done')

      // P3 — after a post goes live, offer to boost it as a Meta Ad. No ad is
      // created until the user taps the button and supplies budget/creative
      // details, so there is never any surprise spend.
      try {
        const boostMsg = primary.permalink
          ? `✅ Your post is live: ${primary.permalink}\n\nWant to reach even more people? Boost it with a Meta Ad.`
          : '✅ Your post is live!\n\nWant to reach even more people? Boost it with a Meta Ad.'
        await sendReplyButtons(phone, boostMsg, [
          { id: 'boost_ad', title: '🚀 Boost with Meta Ads' },
        ])
      } catch (btnErr) {
        logger.warn({ postId, error: (btnErr as Error).message }, 'boost button send failed (non-blocking)')
      }
    }
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
      await setStage(postId, 'FAILED', {
        error: (err as Error).message,
        ...(Object.keys(platformStatuses).length > 0 ? { platformStatuses } : {}),
      })
      await setConversation(phone, { kind: 'awaiting_approval', postId })
      await notifyPostFailed(phone, (err as Error).message)
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

export interface ScheduledSnapshot {
  content?: unknown
  platformContent?: unknown
  imageUrl?: string
  imagePath?: string
}

export function buildPostSnapshot(post: { content?: unknown; platformContent?: unknown; imageUrl?: string; imagePath?: string }): ScheduledSnapshot {
  return {
    content: post.content,
    platformContent: post.platformContent,
    imageUrl: post.imageUrl,
    imagePath: post.imagePath,
  }
}

// P2-8 — restores a post's content to what it was when it was scheduled, so an
// edit made after scheduling never silently changes the published output.
export async function restoreScheduledSnapshot(postId: string, snapshot: ScheduledSnapshot | null | undefined): Promise<void> {
  if (!snapshot) return
  const patch: Record<string, unknown> = {}
  if (snapshot.content !== undefined) patch.content = snapshot.content
  if (snapshot.platformContent !== undefined) patch.platformContent = snapshot.platformContent
  if (snapshot.imageUrl !== undefined) patch.imageUrl = snapshot.imageUrl
  if (snapshot.imagePath !== undefined) patch.imagePath = snapshot.imagePath
  if (Object.keys(patch).length === 0) return
  const { updatePost } = await import('../store.js')
  await updatePost(postId, patch)
}

export async function schedulePost(postId: string, phone: string, publishAt: string): Promise<'scheduled' | 'rescheduled'> {
  const now = new Date().toISOString()
  // P2-8 — capture the post's content at scheduling time so later edits do not
  // change what is actually published.
  const post = await getPost(postId)
  const snapshot = post ? buildPostSnapshot(post) : undefined
  // Idempotent: if this post already has a pending scheduled row, update its time
  // instead of inserting a duplicate (the "reschedule" case).
  const existing = await getDb().select({ id: scheduledPosts.id }).from(scheduledPosts)
    .where(and(eq(scheduledPosts.postId, postId), sql`${scheduledPosts.status} IN ('pending', 'processing')`))
    .limit(1)
  if (existing.length > 0) {
    await getDb().update(scheduledPosts)
      .set({ publishAt, contentSnapshot: snapshot as any })
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
    contentSnapshot: snapshot as any,
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
  const db = getDb()
  const rows = await db.select({ postId: scheduledPosts.postId }).from(scheduledPosts)
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.phone, await resolveUserPhone(phone)), eq(scheduledPosts.status, 'pending')))
    .limit(1)
  if (rows.length === 0) return false
  const post = await getPost(rows[0].postId)
  const snapshot = post ? buildPostSnapshot(post) : undefined
  const updated = await db.update(scheduledPosts)
    .set({ publishAt, contentSnapshot: (snapshot as any) ?? null })
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.phone, await resolveUserPhone(phone)), eq(scheduledPosts.status, 'pending')))
    .returning()
  return updated.length > 0
}

// Minimal fallback: only accept already-ISO timestamps or explicit 4-digit-year
// dates. All natural-language parsing ("kal raat 8", "15 August at 9am", etc.)
// is delegated to the LLM via normalizeScheduleTime. Naive ISO date/datetime
// values (no timezone marker) are interpreted in the supplied timezone, so a
// dashboard datetime-local picker and the server agree regardless of server TZ.
export function parseScheduleTime(value: string, timezone = 'UTC'): string | null {
  if (!value) return null
  const text = value.trim()
  const now = new Date()

  // Absolute timestamps carrying Z or an explicit UTC offset are parsed as-is.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})/.test(text)) {
    const d = new Date(text)
    return !Number.isNaN(d.getTime()) && d > now ? d.toISOString() : null
  }

  // Naive date/datetime without a timezone marker, interpreted in the user's
  // timezone. The full yyyy-mm-dd pattern is required — degenerate inputs like
  // a bare year ("2026") that Date.parse would accept as Jan 1 are rejected.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
  if (m) {
    const y = m[1], mo = m[2], d = m[3], h = m[4] ?? '0', mi = m[5] ?? '0', s = m[6] ?? '0'
    const naive = `${y}-${mo}-${d}T${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${s.padStart(2, '0')}`
    const ms = naiveToUTC(naive, timezone)
    const dt = new Date(ms)
    return !Number.isNaN(dt.getTime()) && dt > now ? dt.toISOString() : null
  }

  return null
}

// Resolve a natural-language time/date to a future ISO string. ISO values are
// fast-pathed (interpreted in `timezone`); everything else is converted by the
// LLM, which is told the current time in the user's timezone.
export async function normalizeScheduleTime(value: string, timezone = 'UTC'): Promise<string | null> {
  const parsed = parseScheduleTime(value, timezone)
  if (parsed) return parsed
  try {
    const ref = nowInZone(timezone)
    const { chatJson } = await import('../lib/llm.js')
    const result = await chatJson<{ iso: string }>(
      [
        {
          role: 'system',
          content: `You convert natural-language time/date expressions into ISO-8601 timestamps. The current time is ${ref}. The scheduled moment MUST be in the future. Return the ISO-8601 timestamp WITH its UTC offset (e.g. "2026-08-21T18:00:00+05:00"). Output ONLY a JSON object: {"iso": "..."}. If you cannot determine a future time, set "iso": "".`,
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
        // P5-1 — a paused package must not execute its scheduled jobs. The job
        // stays pending so it runs naturally once the package is resumed.
        // Resolve the canonical user phone (thread keys map back to owner).
        const user = await getUser(await resolveUserPhone(item.phone))
        if (user?.packageStatus === 'paused') {
          continue
        }
        // P1-7 — never re-publish a post that already reached a terminal state
        // (e.g. a crash happened after publishing but before marking the
        // scheduled row completed). Record the outcome instead.
        const post = await getPost(item.postId)
        if (post && (post.status === 'DONE' || post.status === 'PARTIAL_SUCCESS')) {
          await db.update(scheduledPosts).set({ status: 'completed', processedAt: now }).where(eq(scheduledPosts.id, item.id))
          continue
        }
        if (post && post.status === 'CANCELLED') {
          await db.update(scheduledPosts).set({ status: 'cancelled', processedAt: now }).where(eq(scheduledPosts.id, item.id))
          continue
        }
        await db.update(scheduledPosts).set({ status: 'processing' }).where(eq(scheduledPosts.id, item.id))
        try {
          // P2-8 — publish the content as it was scheduled, even if the post has
          // been edited in the meantime.
          if (item.contentSnapshot) {
            await restoreScheduledSnapshot(item.postId, item.contentSnapshot as ScheduledSnapshot)
          }
          // Await the publish attempt itself, not just the enqueue, so the row
          // is only marked 'completed' once publishing has really finished.
          const finalStatus = await enqueuePublish(item.postId)
          const ok = finalStatus === 'DONE' || finalStatus === 'PARTIAL_SUCCESS'
          const finalRowStatus = finalStatus === 'CANCELLED' ? 'cancelled' : ok ? 'completed' : 'failed'
          await db.update(scheduledPosts).set({ status: finalRowStatus, processedAt: now }).where(eq(scheduledPosts.id, item.id))
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
