import { config } from '../config.js'
import { logger } from './logger.js'
import { sendText } from './whatsapp.js'
import { getPackage, createNotification } from '../store.js'
import type { AppNotification } from '../store.js'

async function sendToAdmin(message: string): Promise<void> {
  const adminPhone = config.admin.phone
  if (!adminPhone) {
    logger.debug('no admin phone configured, skipping WhatsApp notification')
    return
  }

  try {
    await sendText(adminPhone, message)
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'failed to send admin notification')
  }
}

export interface NotifyResult {
  waSent: boolean
  saved: boolean
}

async function notify(targetType: 'admin' | 'user', targetPhone: string | undefined, category: string, title: string, body: string, waMessage: string, data?: Record<string, unknown>): Promise<NotifyResult> {
  let saved = false
  try {
    await createNotification({ targetType, targetPhone, category, title, body, data })
    saved = true
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'failed to save notification to DB')
  }

  let waSent = false
  if (targetType === 'admin') {
    await sendToAdmin(waMessage)
    waSent = true
  } else if (targetPhone) {
    try {
      await sendText(targetPhone, waMessage)
      waSent = true
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'failed to send user notification via WhatsApp')
    }
  }

  return { waSent, saved }
}

export async function notifyNewUser(phone: string, name: string, packageId: string): Promise<NotifyResult> {
  const pkg = packageId ? await getPackage(packageId) : null
  const planName = pkg?.name || 'Unknown'
  const tokens = pkg?.includedTokens || 0

  const title = 'New User Registered'
  const body = `${name || phone} registered on the ${planName} plan (${tokens} tokens).`
  const message = `👤 New User Registered

📱 Phone: ${phone}
👤 Name: ${name}
📦 Plan: ${planName}
🪙 Tokens: ${tokens}

User is now active and can create posts.`

  return notify('admin', undefined, 'user', title, body, message, { phone, name, packageId, planName, tokens })
}

export async function notifyPayment(phone: string, amountCents: number, planName: string): Promise<NotifyResult> {
  const amount = (amountCents / 100).toFixed(2)

  const title = 'Payment Received'
  const body = `Payment of $${amount} received from ${phone} (${planName}).`
  const message = `💳 Payment Received

📱 Phone: ${phone}
💰 Amount: $${amount}
📦 Plan: ${planName}`

  return notify('admin', undefined, 'payment', title, body, message, { phone, amountCents, planName })
}

export async function notifyLowTokens(phone: string, balance: number): Promise<NotifyResult> {
  const title = 'Low Token Balance'
  const body = `${phone} has only ${balance} tokens remaining.`
  const message = `⚠️ Low Token Balance

📱 Phone: ${phone}
🪙 Balance: ${balance} tokens

User may need to upgrade or purchase more tokens.`

  return notify('admin', undefined, 'tokens', title, body, message, { phone, balance })
}

export async function notifyUserDeactivated(phone: string): Promise<NotifyResult> {
  const title = 'User Deactivated'
  const body = `${phone} was deactivated and can no longer access the bot.`
  const message = `🚫 User Deactivated

📱 Phone: ${phone}

User can no longer access the bot.`

  return notify('admin', undefined, 'user', title, body, message, { phone })
}

export async function notifyUserActivated(phone: string): Promise<NotifyResult> {
  const title = 'User Activated'
  const body = `${phone} was activated and can now use the bot.`
  const message = `✅ User Activated

📱 Phone: ${phone}

User can now access the bot.`

  return notify('admin', undefined, 'user', title, body, message, { phone })
}

export async function notifyPostPublished(phone: string, mediaId: string, permalink: string): Promise<NotifyResult> {
  const title = 'Post Published'
  const body = `Your post was published to Instagram.`
  const message = `✅ Post Published

📱 User: ${phone}
🆔 Media ID: ${mediaId}
🔗 Permalink: ${permalink}`

  return notify('user', phone, 'post', title, body, message, { mediaId, permalink })
}

export async function notifyPostFailed(phone: string, error: string): Promise<NotifyResult> {
  const title = 'Post Failed'
  const body = `Your post could not be published: ${error}`
  const message = `❌ Post Failed

📱 User: ${phone}
❗ Error: ${error}`

  return notify('user', phone, 'post', title, body, message, { error })
}

export async function notifySupportTicketCreated(phone: string, subject: string, body: string): Promise<NotifyResult> {
  const title = 'New Support Ticket'
  const message = `🎫 New Support Ticket

📱 User: ${phone}
📌 Subject: ${subject}
💬 Message: ${body}`

  return notify('admin', undefined, 'support', title, `${phone} opened a ticket: ${subject}`, message, { phone, subject, body })
}

export async function notifySupportUserReply(phone: string, subject: string, reply: string): Promise<NotifyResult> {
  const title = 'Support Reply from User'
  const message = `💬 Support Reply

📱 User: ${phone}
📌 Ticket: ${subject}
💬 Reply: ${reply}`

  return notify('admin', undefined, 'support', title, `${phone} replied on "${subject}"`, message, { phone, subject, reply })
}

export async function notifySupportAdminReply(phone: string, subject: string, reply: string): Promise<NotifyResult> {
  const title = 'Support Reply'
  const body = `Our team replied on "${subject}"`
  const message = `📨 Support reply on "${subject}"`

  return notify('user', phone, 'support', title, body, message, { subject, reply })
}

export type { AppNotification }
