import { config } from '../config.js'
import { logger } from './logger.js'
import { getUser, resolveUserPhone } from '../store.js'
import { sendText } from './whatsapp.js'
import { getBalance, hasEnoughTokens, getTokenCost } from './tokens.js'
import type { TokenAction } from '../types.js'

export async function isRegistered(phone: string): Promise<boolean> {
  const user = await getUser(phone)
  return !!user
}

export async function isActive(phone: string): Promise<boolean> {
  const user = await getUser(phone)
  if (!user) return false
  return user.active === 1
}

export async function hasTokens(phone: string): Promise<boolean> {
  const balance = await getBalance(phone)
  return balance > 0
}

export async function hasEnoughTokensForAction(phone: string, action: TokenAction): Promise<boolean> {
  const balance = await getBalance(phone)
  return hasEnoughTokens(balance, action)
}

export async function checkUserAccess(phone: string): Promise<{
  allowed: boolean
  reason?: string
  user?: Awaited<ReturnType<typeof getUser>>
}> {
  const userPhone = await resolveUserPhone(phone)
  const user = await getUser(userPhone)

  if (!user) {
    return { allowed: false, reason: 'not_registered', user: undefined }
  }

  if (user.active !== 1) {
    return { allowed: false, reason: 'deactivated', user }
  }

  if (user.tokensRemaining <= 0) {
    return { allowed: false, reason: 'no_tokens', user }
  }

  return { allowed: true, user }
}

export async function sendAccessDenied(phone: string, reason: string): Promise<void> {
  let message: string

  switch (reason) {
    case 'not_registered':
      message = '⛔ You are not registered. Please contact admin to get access.'
      break
    case 'deactivated':
      message = '⛔ Your account has been deactivated. Please contact admin for assistance.'
      break
    case 'no_tokens':
      message = '🚫 No tokens remaining. Please upgrade your plan or buy more tokens.'
      break
    case 'no_whatsapp':
      message = '⛔ Your current package does not include the WhatsApp channel. Please upgrade your plan, or use the web dashboard chat to manage your posts.'
      break
    default:
      message = '⛔ Access denied. Please contact admin.'
  }

  try {
    await sendText(phone, message)
  } catch (err) {
    logger.error({ phone, error: (err as Error).message }, 'failed to send access denied message')
  }
}

export async function sendTokenWarning(phone: string, warnings: string[]): Promise<void> {
  for (const warning of warnings) {
    try {
      await sendText(phone, warning)
    } catch (err) {
      logger.error({ phone, error: (err as Error).message }, 'failed to send token warning')
    }
  }
}
