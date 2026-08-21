import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import { downloadMedia, sendText } from '../lib/whatsapp.js'
import { transcribeAudio } from '../lib/stt.js'
import { saveAudioBuffer } from '../storage.js'
import { handleUserInput, handleVoiceInput, regeneratePost } from '../pipeline/conversation.js'
import { cancelPublish, enqueuePublish } from '../pipeline/publish.js'
import { checkUserAccess, sendAccessDenied } from '../lib/auth.js'
import { checkPackageFeature } from '../lib/packagePermissions.js'
import { metaConfig } from '../lib/metaConfig.js'
import {
  getConversation,
  getPost,
  getUser,
  getPackage,
  isDuplicateDelivery,
  logMessage,
  logWebhookEvent,
  resolveUserPhone,
  setConversation,
  setStage,
  storageDir,
} from '../store.js'

async function handleButton(phone: string, buttonId: string): Promise<void> {
  const convo = await getConversation(phone)
  const postId = convo.postId

  if (buttonId === 'cancel') {
    if (!postId) {
      await sendText(phone, 'No publishing is currently in progress.')
      return
    }
    const res = await cancelPublish(postId)
    if (res === 'too_late') {
      await sendText(
        phone,
        'Your post has already been sent to Instagram for publishing and can no longer be cancelled.\n\nIf it has already been published, I can help you delete it later (if supported).',
      )
    } else if (res === 'not_found') {
      await sendText(phone, 'No publishing is currently in progress.')
    }
    return
  }

  if (!postId) return
  const post = await getPost(postId)
  if (!post) return

  if (buttonId === 'publish') {
    if (post.status !== 'AWAITING_APPROVAL' && post.status !== 'CANCELLED') {
      await sendText(phone, 'This post is not ready to publish yet.')
      return
    }
    try {
      await setStage(postId, 'APPROVED')
      // Fire-and-forget: publishing runs in the background so the user can
      // still cancel while it is in flight.
      void enqueuePublish(postId).catch((err: unknown) => {
        logger.error({ postId, error: (err as Error).message }, 'publish button failed')
        return sendText(phone, `❌ Could not start publishing: ${(err as Error).message}`)
      })
    } catch (err) {
      logger.error({ postId, error: (err as Error).message }, 'publish button failed')
      await sendText(phone, `❌ Could not start publishing: ${(err as Error).message}`)
    }
    return
  }

  if (buttonId === 'edit') {
    await setConversation(phone, { kind: 'editing', postId })
    await sendText(
      phone,
      '✏️ What would you like to change? For example: make it shorter, change the colors, use Urdu, add emojis, remove hashtags, make it funnier.',
    )
    return
  }

  if (buttonId === 'regenerate') {
    await regeneratePost(phone, postId)
    return
  }

  if (buttonId === 'branding_yes' || buttonId === 'branding_no') {
    await handleUserInput(phone, buttonId === 'branding_yes' ? 'branding_yes' : 'branding_no')
    return
  }

  if (buttonId === 'ad_approve') {
    const conv = await getConversation(phone)
    if ((conv as any).kind === 'ad_preview') {
      const { launchAdCampaign } = await import('../pipeline/adConversation.js')
      await launchAdCampaign((conv as any).postId)
    }
    return
  }

  if (buttonId === 'ad_edit') {
    // Route through the main conversation handler for natural editing
    await handleUserInput(phone, 'edit the ad')
    return
  }

   if (buttonId === 'ad_cancel') {
     await setConversation(phone, { kind: 'idle' })
     await sendText(phone, '❌ Ad campaign cancelled.')
     return
   }

   // Reached from the approval "publish now or schedule?" prompt: ask for a time,
   // then let the next user message flow through classify as a schedule_post.
   if (buttonId === 'schedule') {
     if (!postId) return
     if ((await getPost(postId))?.status !== 'AWAITING_APPROVAL') {
       await sendText(phone, 'This post is not awaiting approval right now.')
       return
     }
     await sendText(phone, '⏰ When should I schedule it for? Tell me like "tomorrow 5pm" or "Sunday 6pm".')
     return
   }

   // Reached from the post-publish "Boost with Meta Ads?" prompt. Hand off to the
   // existing ad-gathering flow using the just-published post as the creative
   // source. The user still supplies budget/location/audience/website — no ad is
   // launched until they approve a preview.
   if (buttonId === 'boost_ad') {
     if (!postId) return
     const post = await getPost(postId)
     if (!post) return
     const product = (post.intent?.topic as string) || ''
     await setConversation(phone, {
       kind: 'ad_gathering',
       postId,
       step: 'topic',
       data: {},
       adData: { existingPostId: postId, product } as Record<string, unknown>,
     } as never)
     await sendText(
       phone,
       '🚀 Let\'s boost this post with a Meta Ad! I\'ll need a few details first. What\'s your daily budget? (e.g. $5/day)',
     )
     return
   }
 }

export async function handleWebhook(req: unknown): Promise<{ status: number; body: string }> {
  const body = req as {
    entry?: { id: string; changes: { value: { messages?: unknown[] } }[] }[]
  }
  const messages = body.entry?.[0]?.changes?.[0]?.value?.messages
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return { status: 200, body: 'ok' }
  }

  const msg = messages[0] as {
    from: string
    id: string
    type: string
    text?: { body: string }
    audio?: { id: string; mime_type: string; voice?: boolean; seconds?: number }
    interactive?: { type: string; button_reply?: { id: string } }
  }

  // P5-2 — record every received webhook (audit trail / debugging). Best-effort;
  // a logging failure must never break message processing.
  try {
    await logWebhookEvent({
      source: 'whatsapp',
      eventType: msg?.type ?? 'unknown',
      payload: { from: msg?.from, msgId: msg?.id },
      status: 'received',
      responseCode: 200,
    })
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'failed to log webhook event')
  }

  const from = msg.from

  // H8 — skip a duplicate/retried delivery of the same WhatsApp message id for
  // this phone (a retry must never trigger the action twice).
  if (isDuplicateDelivery(from, msg.id)) {
    return { status: 200, body: 'ok' }
  }

  const isButtonPress = msg.type === 'interactive' && msg.interactive?.type === 'button_reply'
  const access = await checkUserAccess(from)
  if (!access.allowed) {
    if (!isButtonPress) {
      await sendAccessDenied(from, access.reason || 'unknown')
    }
    return { status: 200, body: 'ok' }
  }

  // WhatsApp channel gate: only users whose package enables whatsapp_broadcast
  // may use the bot over WhatsApp. Others are told to use web chat or upgrade.
  const waUserPhone = await resolveUserPhone(from)
  const hasWhatsAppChannel = await checkPackageFeature(waUserPhone, 'whatsapp_broadcast')
  if (!hasWhatsAppChannel) {
    await sendAccessDenied(from, 'no_whatsapp')
    return { status: 200, body: 'ok' }
  }

  if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply' && msg.interactive.button_reply) {
    const buttonId = msg.interactive.button_reply.id
    await logMessage({ phone: from, role: 'user', type: 'text', content: `[button] ${buttonId}`, waMsgId: msg.id })
    await handleButton(from, buttonId)
    return { status: 200, body: 'ok' }
  }

  if (msg.type === 'audio' && msg.audio?.id) {
    const userPhone = await resolveUserPhone(from)
    const user = await getUser(userPhone)
    if (user?.packageId) {
      const pkg = await getPackage(user.packageId)
      if (pkg?.features && (pkg.features as Record<string, boolean>).voice_transcription === false) {
        await sendText(from, '❌ Voice-to-post transcription is not included in your package. Please type your message as text instead, or upgrade your plan to use voice notes.')
        return { status: 200, body: 'ok' }
      }
    }

    // Stable billing idempotency key derived from the WhatsApp message id — a
    // retried/duplicated delivery of the SAME message must never charge twice.
    // The random UUID below is ONLY used as a storage filename identity.
    const voiceClaimKey = `voice:${msg.id}`
    const audioId = randomUUID()
    try {
      const { tokenEngine } = await import('../lib/TokenEngine.js')
      const charge = await tokenEngine.chargeVoiceOnce(voiceClaimKey, userPhone, 'Voice transcription')
      if (!charge.success && !charge.alreadyCharged) {
        await sendText(from, `❌ You need ${charge.error === 'Insufficient tokens' ? 'enough tokens' : 'tokens'} to transcribe voice notes. Please upgrade your plan or buy more tokens.`)
        return { status: 200, body: 'ok' }
      }

      // Duplicate/retried delivery: already charged exactly once — do NOT process
      // again (no extra credit, no second provider call, no duplicate handling).
      if (charge.alreadyCharged) {
        return { status: 200, body: 'ok' }
      }

      await sendText(from, '🎙️ Got your voice note, processing...')
      const audioBuffer = await downloadMedia(msg.audio.id)
      const relPath = saveAudioBuffer(audioBuffer, audioId)
      const durationMs = (msg.audio?.seconds ?? 0) * 1000
      const transcript = await transcribeAudio(path.join(storageDir(), relPath), { phone: userPhone, durationMs })
      await handleVoiceInput(from, transcript, { waMsgId: msg.id })
    } catch (err) {
      logger.error({ from, error: (err as Error).message }, 'voice processing failed')
      await sendText(from, `❌ Sorry, I could not process that voice note: ${(err as Error).message}`)
      try {
        const { tokenEngine } = await import('../lib/TokenEngine.js')
        await tokenEngine.refundVoiceOnce(voiceClaimKey, userPhone, 'Voice transcription refund')
      } catch (refundErr) {
        logger.error({ refundErr: (refundErr as Error).message }, 'voice transcription refund failed')
      }
      const convo = await getConversation(from)
      await setConversation(from, { kind: 'idle', postId: convo.postId })
    }
    return { status: 200, body: 'ok' }
  }

  if (msg.type === 'text') {
    await handleUserInput(from, msg.text?.body ?? '', { waMsgId: msg.id })
    return { status: 200, body: 'ok' }
  }

  return { status: 200, body: 'ok' }
}

export async function handleVerify(req: unknown): Promise<{ status: number; body: string }> {
  const q = req as { query: Record<string, string> }
  const { hub_mode: hubMode, hub_verify_token: verifyToken, hub_challenge: challenge } = q.query ?? {}
  if (hubMode === 'subscribe' && verifyToken === metaConfig.getVerifyToken()) {
    return { status: 200, body: challenge ?? '' }
  }
  return { status: 403, body: 'Forbidden' }
}
