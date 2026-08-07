import crypto from 'node:crypto'
import { getConfig, setConfig } from '../store.js'
import { getAdminSecret } from './adminAuth.js'

const OTP_TTL_MS = 5 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5

function otpKey(phone: string): string {
  return `wa_otp:${phone}`
}

export function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000))
}

export async function storeOtp(userPhone: string, phoneNumber: string, code: string): Promise<void> {
  await setConfig(otpKey(userPhone), JSON.stringify({
    phoneNumber,
    code,
    attempts: 0,
    expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  }))
}

export async function verifyOtp(userPhone: string, phoneNumber: string, code: string): Promise<{ valid: boolean; reason?: string }> {
  const raw = await getConfig(otpKey(userPhone))
  if (!raw) return { valid: false, reason: 'No verification code was sent. Request a new one.' }

  const record = JSON.parse(raw) as { phoneNumber: string; code: string; attempts: number; expiresAt: string }

  if (record.phoneNumber !== phoneNumber) {
    return { valid: false, reason: 'Phone number does not match the verification request.' }
  }
  if (new Date(record.expiresAt) < new Date()) {
    await setConfig(otpKey(userPhone), '')
    return { valid: false, reason: 'Verification code expired. Request a new one.' }
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return { valid: false, reason: 'Too many attempts. Request a new code.' }
  }

  if (record.code !== code) {
    await setConfig(otpKey(userPhone), JSON.stringify({ ...record, attempts: record.attempts + 1 }))
    return { valid: false, reason: 'Incorrect verification code.' }
  }

  await setConfig(otpKey(userPhone), '')
  return { valid: true }
}

function hmac(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

export async function signState(phone: string): Promise<string> {
  const secret = await getAdminSecret()
  return `${encodeURIComponent(phone)}.${hmac(phone, secret)}`
}

export async function verifyState(state: string | undefined): Promise<string | null> {
  if (!state) return null
  const [encodedPhone, signature] = state.split('.')
  if (!encodedPhone || !signature) return null
  const phone = decodeURIComponent(encodedPhone)
  const secret = await getAdminSecret()
  const expected = hmac(phone, secret)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return null
  return crypto.timingSafeEqual(a, b) ? phone : null
}