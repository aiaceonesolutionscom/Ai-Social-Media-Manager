import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '../src/config.js'
import { readFile, fileExists, saveImageBuffer } from '../src/storage.js'

describe('P5-5 — storage path traversal protection', () => {
  const originalDir = config.storageDir
  let tmp = ''

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-storage-'))
    config.storageDir = tmp
  })

  afterAll(() => {
    config.storageDir = originalDir
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('rejects traversal, absolute, and null-byte paths', () => {
    expect(() => readFile('../../outside.txt')).toThrow('Invalid file path')
    expect(() => readFile('/etc/passwd')).toThrow('Invalid file path')
    expect(() => readFile('images/../..//outside.txt')).toThrow('Invalid file path')
    expect(() => readFile('C:\\Windows\\system32\\config\\SAM')).toThrow('Invalid file path')
    expect(() => readFile('images/\0bad.png')).toThrow('Invalid file path')
    expect(fileExists('../../escape.txt')).toBe(false)
  })

  it('still reads files that live inside the storage root', () => {
    const rel = saveImageBuffer(Buffer.from('PNGDATA'), 'test-img')
    expect(fs.existsSync(path.join(tmp, rel))).toBe(true)
    expect(fileExists(rel)).toBe(true)
    expect(readFile(rel).toString()).toBe('PNGDATA')
  })
})