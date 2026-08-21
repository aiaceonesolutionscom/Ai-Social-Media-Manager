import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import './setupMocks.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '../src/config.js'
import { initStore, resetStore, createUser, createPost, updatePost } from '../src/store.js'
import { storageManager } from '../src/lib/StorageManager.js'

describe('P5-12 — orphaned media cleanup preserves referenced files', () => {
  const originalDir = config.storageDir
  let tmp = ''
  let imagesDir = ''

  function touch(filename: string, ageDays: number): void {
    const p = path.join(imagesDir, filename)
    fs.writeFileSync(p, 'x')
    const old = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
    fs.utimesSync(p, old, old)
  }

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-cleanup-'))
    config.storageDir = tmp
    imagesDir = path.join(tmp, 'images')
    fs.mkdirSync(imagesDir, { recursive: true })
    await initStore()
  })

  beforeEach(async () => {
    await resetStore()
    await createUser({ phone: '911112223333', name: 'Cleanup Tester', email: 'cleanup@example.com' })
    for (const f of fs.readdirSync(imagesDir)) {
      fs.rmSync(path.join(imagesDir, f), { force: true })
    }
  })

  afterAll(() => {
    config.storageDir = originalDir
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('deletes only orphaned files older than the cutoff, keeping post images and avatars', async () => {
    const post = await createPost('911112223333')
    await updatePost(post.id, { status: 'DONE' })
    const avatarBase = `avatar_${'911112223333'.replace(/[^a-zA-Z0-9_-]/g, '_')}`

    touch(`${post.id}.png`, 45)
    touch(`${avatarBase}.png`, 45)
    touch('orphan_old.png', 45)
    touch('orphan_recent.png', 1)

    const deleted = await storageManager.cleanup(30)

    expect(deleted).toBe(1)
    expect(fs.existsSync(path.join(imagesDir, `${post.id}.png`))).toBe(true)
    expect(fs.existsSync(path.join(imagesDir, `${avatarBase}.png`))).toBe(true)
    expect(fs.existsSync(path.join(imagesDir, 'orphan_recent.png'))).toBe(true)
    expect(fs.existsSync(path.join(imagesDir, 'orphan_old.png'))).toBe(false)
  })

  it('deletes orphaned post-image files once their post no longer exists', async () => {
    const gone = '00000000-0000-0000-0000-000000000000'
    touch(`${gone}.png`, 45)
    const deleted = await storageManager.cleanup(30)
    expect(deleted).toBe(1)
    expect(fs.existsSync(path.join(imagesDir, `${gone}.png`))).toBe(false)
  })
})