import sharp from 'sharp'
import { config } from '../config.js'
import { saveImageBuffer } from '../storage.js'
import { localFileUrl } from './whatsapp.js'

// Never-crop image fitting for social publishing.
//
// Meta/Instagram accept a fixed set of aspect ratios. If a generated image is
// not already compliant, center-cropping silently throws away part of the
// creative. Instead we CONTAIN the image inside the target frame and pad the
// leftover space with a solid background, so the whole image is always visible.
export interface ContainOptions {
  width: number
  height: number
  background?: string
  format?: 'png' | 'jpeg'
}

export async function fitContain(buffer: Buffer, opts: ContainOptions): Promise<Buffer> {
  const background = opts.background ?? '#ffffff'
  const format = opts.format ?? 'png'
  return sharp(buffer, { failOn: 'none' })
    .resize(opts.width, opts.height, { fit: 'contain', background })
    .toFormat(format)
    .toBuffer()
}

// 1:1 — safe, widely-compatible feed ratio for Instagram.
export function containForInstagram(buffer: Buffer): Promise<Buffer> {
  return fitContain(buffer, { width: 1080, height: 1080 })
}

// 4:5 — Facebook's preferred portrait feed ratio (more vertical real estate).
export function containForFacebook(buffer: Buffer): Promise<Buffer> {
  return fitContain(buffer, { width: 1080, height: 1350 })
}

// Save a contain-fit variant and return its publicly-served URL.
export async function saveContainFit(buffer: Buffer, postId: string, platform: 'instagram' | 'facebook'): Promise<string> {
  const fit = platform === 'facebook' ? await containForFacebook(buffer) : await containForInstagram(buffer)
  const rel = saveImageBuffer(fit, `${postId}_${platform}`)
  return localFileUrl(rel)
}

// Resolve an image URL (served media) to a Buffer, or null if it cannot be
// fetched/read. Used so contain-fit can run on the real published image; any
// failure just falls back to the original URL (no regression).
export async function resolveImageBuffer(imageUrl: string): Promise<Buffer | null> {
  try {
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 4000)
      try {
        const res = await fetch(imageUrl, { signal: ac.signal })
        if (!res.ok) return null
        return Buffer.from(await res.arrayBuffer())
      } finally {
        clearTimeout(timer)
      }
    }
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { storageDir } = await import('../storage.js')
    const file = imageUrl.includes('/') ? imageUrl.split('/').pop()! : imageUrl
    return fs.readFileSync(path.join(storageDir(), 'images', file))
  } catch {
    return null
  }
}

// Returns the contain-fit URL for a platform, or the original URL when running
// in dev mode (publish is mocked, so the bytes are never uploaded) or when the
// source image cannot be resolved. Keeps the publish path side-effect free.
export async function imageUrlForPlatform(imageUrl: string, postId: string, platform: 'instagram' | 'facebook'): Promise<string> {
  if (config.dev.enabled) return imageUrl
  const buf = await resolveImageBuffer(imageUrl)
  if (!buf) return imageUrl
  try {
    return await saveContainFit(buf, postId, platform)
  } catch {
    return imageUrl
  }
}
