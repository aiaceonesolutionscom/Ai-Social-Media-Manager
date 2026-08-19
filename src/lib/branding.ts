import path from 'node:path'
import fs from 'node:fs'
import { config } from '../config.js'
import { storageDir } from '../storage.js'
import type { BrandProfile } from '../types.js'

export interface BrandIdentity extends BrandProfile {
  brandName?: string
  tagline?: string
  colors?: string[]
  logoPath?: string
  address?: string
  website?: string
  contact?: string
}

export function buildBrandContext(brand?: BrandProfile): string {
  const b = (brand ?? {}) as BrandIdentity
  const parts: string[] = []
  if (b.brandName) parts.push(`- brand name: ${b.brandName}`)
  if (b.tagline) parts.push(`- brand tagline: ${b.tagline}`)
  if (b.voice) parts.push(`- brand voice: ${b.voice}`)
  if (b.toneGuidelines) parts.push(`- brand tone guidelines: ${b.toneGuidelines}`)
  if (b.address) parts.push(`- brand address: ${b.address}`)
  if (b.website) parts.push(`- brand website: ${b.website}`)
  if (b.contact) parts.push(`- brand contact info: ${b.contact}`)
  if (Array.isArray(b.colors) && b.colors.length > 0) parts.push(`- brand colors: ${b.colors.join(', ')}`)
  if (parts.length === 0) return ''
  return `\nBRAND IDENTITY (naturally weave this into the post when it fits, but never force it):\n${parts.join('\n')}`
}

export function saveBrandLogo(buffer: Buffer, phone: string): string {
  const dir = storageDir()
  const rel = `images/logo_${phone.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, buffer)
  return rel
}

export function brandLogoUrl(logoPath?: string): string | null {
  if (!logoPath) return null
  const fileName = encodeURIComponent(logoPath.split(/[/\\]/).pop() ?? logoPath)
  return `${config.publicBaseUrl}/media/${fileName}`
}

export async function applyBrandLogo(imageBuffer: Buffer, logoPath: string): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default
    const full = path.join(storageDir(), logoPath)
    if (!fs.existsSync(full)) return imageBuffer
    const logo = await sharp(full).resize({ width: 200, height: 200, fit: 'inside' }).png().toBuffer()
    return await sharp(imageBuffer).composite([{ input: logo, gravity: 'southeast' }]).png().toBuffer()
  } catch {
    return imageBuffer
  }
}
