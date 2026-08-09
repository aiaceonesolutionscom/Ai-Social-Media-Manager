import { FastifyInstance } from 'fastify'
import { verifySession } from '../lib/userAuth.js'
import { getBrandProfile, saveBrandProfile } from '../store.js'
import { requireFeature } from '../lib/packagePermissions.js'
import { saveBrandLogo, brandLogoUrl } from '../lib/branding.js'

async function requireUser(req: any): Promise<string | null> {
  const token = req.headers['authorization']?.replace('Bearer ', '') || ''
  if (!token) return null
  const session = await verifySession(token)
  return session?.phone || null
}

export function serializeBrandProfile(profile: any): Record<string, unknown> {
  if (!profile) return {}
  return {
    brandName: profile.brandName || '',
    tagline: profile.tagline || '',
    voice: profile.voice || '',
    toneGuidelines: profile.toneGuidelines || '',
    colors: Array.isArray(profile.colors) ? profile.colors : [],
    logoUrl: brandLogoUrl(profile.logoPath),
  }
}

export async function registerBrandRoutes(server: FastifyInstance): Promise<void> {

  // Get the current user's brand identity (available regardless of feature,
  // so the UI can show a disabled form to non-eligible users).
  server.get('/api/brand/profile', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    const profile = await getBrandProfile(phone)
    return reply.send({ profile: serializeBrandProfile(profile) })
  })

  // Save brand identity (custom_branding feature required).
  server.put('/api/brand/profile', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      await requireFeature(phone, 'custom_branding')
    } catch (err: any) {
      return reply.status(403).send({ error: err.message })
    }

    const existing = await getBrandProfile(phone)
    const body = (req.body ?? {}) as Record<string, unknown>
    const colors = Array.isArray(body.colors)
      ? (body.colors as unknown[]).filter((c): c is string => typeof c === 'string').slice(0, 6)
      : []

    const profile = {
      ...(existing ?? {}),
      brandName: typeof body.brandName === 'string' ? body.brandName.trim() : (existing as any)?.brandName || '',
      tagline: typeof body.tagline === 'string' ? body.tagline.trim() : (existing as any)?.tagline || '',
      voice: typeof body.voice === 'string' ? body.voice.trim() : (existing as any)?.voice || '',
      toneGuidelines: typeof body.toneGuidelines === 'string' ? body.toneGuidelines.trim() : (existing as any)?.toneGuidelines || '',
      colors,
    }

    await saveBrandProfile(phone, profile)
    return reply.send({ success: true, profile: serializeBrandProfile(profile) })
  })

  // Upload a brand logo (custom_branding feature required). Accepts a base64 data URL.
  server.post('/api/brand/logo', async (req: any, reply: any) => {
    const phone = await requireUser(req)
    if (!phone) return reply.status(401).send({ error: 'Unauthorized' })

    try {
      await requireFeature(phone, 'custom_branding')
    } catch (err: any) {
      return reply.status(403).send({ error: err.message })
    }

    const { dataUrl } = (req.body ?? {}) as { dataUrl?: string }
    if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl)) {
      return reply.status(400).send({ error: 'A valid base64 image data URL (png/jpeg/webp) is required' })
    }

    const buffer = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64')
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
      return reply.status(400).send({ error: 'Image is empty or larger than 5MB' })
    }

    const logoPath = saveBrandLogo(buffer, phone)
    const existing = await getBrandProfile(phone)
    await saveBrandProfile(phone, { ...(existing ?? {}), logoPath })

    return reply.send({ success: true, logoPath, logoUrl: brandLogoUrl(logoPath) })
  })
}
