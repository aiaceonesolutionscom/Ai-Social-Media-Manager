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

export function readFile(relPath: string): Buffer {
  const full = path.join(storageDir(), relPath)
  if (!fs.existsSync(full)) throw new Error(`File not found: ${relPath}`)
  return fs.readFileSync(full)
}

export function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(storageDir(), relPath))
}

export function postImageUrl(post: Post): string {
  if (post.imageUrl) return post.imageUrl
  if (post.imagePath) {
    const fileName = encodeURIComponent(post.imagePath.split(/[/\\]/).pop() ?? post.imagePath)
    return `${config.publicBaseUrl}/media/${fileName}`
  }
  throw new Error('Post has no image URL or path')
}
