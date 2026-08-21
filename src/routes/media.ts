import path from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { config } from '../config.js'
import { verifySession } from '../lib/userAuth.js'
import { verifyMediaUrl } from '../lib/mediaAuth.js'
import { getPost } from '../store.js'

async function ownerMatches(safeFile: string, sessionPhone: string): Promise<boolean> {
  const base = safeFile.replace(/\.[a-z0-9]+$/i, '')
  if (base.startsWith('avatar_')) {
    // Avatar files are named avatar_<sanitizedPhone>.<ext>.
    const sanitized = sessionPhone.replace(/[^a-zA-Z0-9_-]/g, '_')
    return base === `avatar_${sanitized}`
  }
  // Post image: the file is <postId>.<ext>. Ownership is the post's owner.
  const post = await getPost(base)
  if (!post) return false
  return post.phone === sessionPhone
}

export function registerMediaRoute(server: any): void {
  server.get('/media/:file', async (req: any, reply: any) => {
    const file = req.params.file
    const safeFile = path.basename(file)
    // Path traversal guard: the basename must be the exact requested name.
    if (safeFile !== file || safeFile === '.' || safeFile === '..' || safeFile.includes('..')) {
      return reply.code(404).send('Not found')
    }
    const filePath = path.join(config.storageDir, 'images', safeFile)

    // H9 — authorized access only: a valid signed URL, or a bearer session
    // token whose user owns the file. In DEV mode we additionally allow local
    // media to be served without a session so <img> tags (which can't send an
    // Authorization header) still render for single-user local testing.
    const { expires, sig } = (req.query ?? {}) as { expires?: string; sig?: string }
    const signedOk = verifyMediaUrl(safeFile, expires, sig)
    const devBypass = config.dev?.enabled === true
    if (!signedOk && !devBypass) {
      const token = req.headers['authorization']?.replace('Bearer ', '') || ''
      if (!token) return reply.code(401).send('Unauthorized')
      const session = await verifySession(token)
      if (!session) return reply.code(401).send('Unauthorized')
      if (!(await ownerMatches(safeFile, session.phone))) return reply.code(403).send('Forbidden')
    }

    try {
      await access(filePath)
    } catch {
      return reply.code(404).send('Not found')
    }
    const buffer = await readFile(filePath)
    const ext = path.extname(safeFile).toLowerCase()
    const contentType =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : 'application/octet-stream'
    return reply.type(contentType).send(buffer)
  })
}