import crypto from 'node:crypto'
import { getAdminSecret } from './adminAuth.js'

async function getEncryptionKey(): Promise<Buffer> {
  const secret = await getAdminSecret()
  return crypto.createHash('sha256').update(`social-token-encryption:${secret}`).digest()
}

export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) return ''
  const key = await getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export async function decryptSecret(value: string): Promise<string> {
  if (!value) return ''
  if (!value.startsWith('enc:v1:')) return value
  const [, , ivB64, tagB64, dataB64] = value.split(':')
  if (!ivB64 || !tagB64 || !dataB64) return value
  try {
    const key = await getEncryptionKey()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
    return dec.toString('utf8')
  } catch {
    return value
  }
}
