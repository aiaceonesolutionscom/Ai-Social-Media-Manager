import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import type { Post } from './types.js'

export function storageDir(): string {
  const dir = path.resolve(config.storageDir)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function saveAudioBuffer(buffer: Buffer, postId: string): string {
  const dir = storageDir()
  const rel = `audio/${postId}.ogg`
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, buffer)
  return rel
}

export function saveImageBuffer(buffer: Buffer, postId: string): string {
  const dir = storageDir()
  const rel = `images/${postId}.png`
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, buffer)
  return rel
}

// P5-5 — resolve a caller-supplied relative path and guarantee it stays inside
// the storage root. Absolute paths, null bytes, and any `..` escape are rejected.
function safeResolve(relPath: string): string {
  if (!relPath || relPath.includes('\0')) {
    throw new Error(`Invalid file path: ${relPath}`)
  }
  const dir = storageDir()
  const full = path.resolve(dir, relPath)
  const rel = path.relative(dir, full)
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    throw new Error(`Invalid file path: ${relPath}`)
  }
  return full
}

export function readFile(relPath: string): Buffer {
  const full = safeResolve(relPath)
  if (!fs.existsSync(full)) throw new Error(`File not found: ${relPath}`)
  return fs.readFileSync(full)
}

export function fileExists(relPath: string): boolean {
  try {
    return fs.existsSync(safeResolve(relPath))
  } catch {
    return false
  }
}

export function postImageUrl(post: Post): string {
  if (post.imageUrl) return post.imageUrl
  if (post.imagePath) {
    const fileName = encodeURIComponent(post.imagePath.split(/[/\\]/).pop() ?? post.imagePath)
    return `${config.publicBaseUrl}/media/${fileName}`
  }
  throw new Error('Post has no image URL or path')
}
