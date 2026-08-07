import { config } from '../config.js'
import { logger } from './logger.js'
import { sendText } from './whatsapp.js'
import { getPackage } from '../store.js'

async function sendToAdmin(message: string): Promise<void> {
  const adminPhone = config.admin.phone
  if (!adminPhone) {
    logger.debug('no admin phone configured, skipping notification')
    return
  }

  try {
    await sendText(adminPhone, message)
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'failed to send admin notification')
  }
}

export async function notifyNewUser(phone: string, name: string, packageId: string): Promise<void> {
  const pkg = packageId ? await getPackage(packageId) : null
  const planName = pkg?.name || 'Unknown'
  const tokens = pkg?.includedTokens || 0

  const message = `👤 New User Registered

📱 Phone: ${phone}
👤 Name: ${name}
📦 Plan: ${planName}
🪙 Tokens: ${tokens}

User is now active and can create posts.`

  await sendToAdmin(message)
}

export async function notifyPayment(phone: string, amountCents: number, planName: string): Promise<void> {
  const amount = (amountCents / 100).toFixed(2)

  const message = `💳 Payment Received

📱 Phone: ${phone}
💰 Amount: $${amount}
📦 Plan: ${planName}`

  await sendToAdmin(message)
}

export async function notifyLowTokens(phone: string, balance: number): Promise<void> {
  const message = `⚠️ Low Token Balance

📱 Phone: ${phone}
🪙 Balance: ${balance} tokens

User may need to upgrade or purchase more tokens.`

  await sendToAdmin(message)
}

export async function notifyUserDeactivated(phone: string): Promise<void> {
  const message = `🚫 User Deactivated

📱 Phone: ${phone}

User can no longer access the bot.`

  await sendToAdmin(message)
}

export async function notifyUserActivated(phone: string): Promise<void> {
  const message = `✅ User Activated

📱 Phone: ${phone}

User can now access the bot.`

  await sendToAdmin(message)
}

export async function notifyPostPublished(phone: string, mediaId: string, permalink: string): Promise<void> {
  const message = `✅ Post Published

📱 User: ${phone}
🆔 Media ID: ${mediaId}
🔗 Permalink: ${permalink}`

  await sendToAdmin(message)
}

export async function notifyPostFailed(phone: string, error: string): Promise<void> {
  const message = `❌ Post Failed

📱 User: ${phone}
❗ Error: ${error}`

  await sendToAdmin(message)
}
