import { logger } from './logger.js'
import { sendText, sendTemplate } from './whatsapp.js'
import { metaConfig } from './metaConfig.js'
import { getUser, getPackage, resolveUserPhone } from '../store.js'
import { getBalance } from './tokens.js'

export async function sendWelcomeMessage(phone: string): Promise<void> {
  const userPhone = await resolveUserPhone(phone)
  const user = await getUser(userPhone)
  if (!user) {
    logger.warn({ phone }, 'cannot send welcome: user not found')
    return
  }

  const pkg = user.packageId ? await getPackage(user.packageId) : null
  const balance = await getBalance(userPhone)

  const message = formatWelcomeMessage(user.name || 'there', pkg?.name || 'Free', balance)

  try {
    // Business-initiated greetings must use an approved template.
    // Configurable via admin meta settings or env:
    //   whatsapp.welcome_template (default 'welcome_message'), whatsapp.welcome_template_language (default 'en')
    const templateName = metaConfig.getValue('whatsapp', 'welcome_template') || process.env.META_WA_WELCOME_TEMPLATE || 'welcome_message'
    const language = metaConfig.getValue('whatsapp', 'welcome_template_language') || 'en'
    try {
      await sendTemplate(phone, templateName, language, [user.name || 'there', pkg?.name || 'Free', String(balance)], 'welcome')
    } catch (templateErr: any) {
      logger.warn({ phone, error: templateErr.message }, 'welcome template failed, falling back to free-form text')
      await sendText(phone, message)
    }
    logger.info({ phone }, 'welcome message sent')
  } catch (err) {
    logger.error({ phone, error: (err as Error).message }, 'failed to send welcome message')
  }
}

export function formatWelcomeMessage(name: string, planName: string, balance: number): string {
  return `👋 Hi ${name}! I'm your Instagram Agent.

I'm here to help you create & publish Instagram and Facebook posts — right from this WhatsApp chat.

📱 How to use:
1. Send me a voice note or text about your post
2. I'll create the caption + image for you
3. Review and approve
4. Published! ✅

📦 Your Plan: ${planName}
🪙 Balance: ${balance} tokens

Try saying: "Post about my new product"

Need help? Just ask me anything!`
}

export async function sendTokenBalanceMessage(phone: string): Promise<void> {
  const userPhone = await resolveUserPhone(phone)
  const user = await getUser(userPhone)
  if (!user) return

  const balance = await getBalance(userPhone)
  const pkg = user.packageId ? await getPackage(user.packageId) : null

  const message = `🪙 Your Token Balance

Balance: ${balance} tokens
Plan: ${pkg?.name || 'Free'}

Actions & Token Costs:
• Standard Post (IG or FB): 1 token
• Cross-Platform (IG + FB): 2 tokens
• Image Regenerate: 1 token
• Ad Campaign: 5 tokens

${balance <= 10 ? '⚠️ Running low on tokens!' : ''}

Need more tokens? Contact admin.`

  try {
    await sendText(phone, message)
  } catch (err) {
    logger.error({ phone, error: (err as Error).message }, 'failed to send balance message')
  }
}
