import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import { logger } from './logger.js'

export type StorageProvider = 'local' | 's3' | 'r2' | 'b2'

export interface StorageAdapter {
  save(key: string, data: Buffer): Promise<string>
  read(key: string): Promise<Buffer>
  delete(key: string): Promise<boolean>
  exists(key: string): Promise<boolean>
  getUrl(key: string): string
}

class LocalStorageAdapter implements StorageAdapter {
  private basePath: string

  constructor() {
    this.basePath = config.storageDir
  }

  async save(key: string, data: Buffer): Promise<string> {
    const filePath = this.getFullPath(key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, data)
    return this.getUrl(key)
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.getFullPath(key))
  }

  async delete(key: string): Promise<boolean> {
    try {
      await fs.unlink(this.getFullPath(key))
      return true
    } catch {
      return false
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.getFullPath(key))
      return true
    } catch {
      return false
    }
  }

  getUrl(key: string): string {
    return `${config.publicBaseUrl}/media/${key}`
  }

  private getFullPath(key: string): string {
    const safeKey = path.basename(key)
    return path.join(this.basePath, 'images', safeKey)
  }
}

class StorageManager {
  private adapter: StorageAdapter
  private provider: StorageProvider

  constructor() {
    this.provider = (process.env.STORAGE_PROVIDER as StorageProvider) || 'local'
    this.adapter = new LocalStorageAdapter()
    logger.info({ provider: this.provider }, 'storage manager initialized')
  }

  async save(key: string, data: Buffer): Promise<string> {
    return this.adapter.save(key, data)
  }

  async read(key: string): Promise<Buffer> {
    return this.adapter.read(key)
  }

  async delete(key: string): Promise<boolean> {
    return this.adapter.delete(key)
  }

  async exists(key: string): Promise<boolean> {
    return this.adapter.exists(key)
  }

  getUrl(key: string): string {
    return this.adapter.getUrl(key)
  }

  getProvider(): StorageProvider {
    return this.provider
  }

  async cleanup(maxAgeDays = 30): Promise<number> {
    if (this.provider !== 'local') return 0
    const adapter = this.adapter as LocalStorageAdapter
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    let deleted = 0
    try {
      const dir = path.join(config.storageDir, 'images')
      const files = await fs.readdir(dir)
      for (const file of files) {
        const filePath = path.join(dir, file)
        const stat = await fs.stat(filePath)
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(filePath)
          deleted++
        }
      }
      if (deleted > 0) {
        logger.info({ deleted, maxAgeDays }, 'storage cleanup completed')
      }
    } catch (err) {
      logger.error({ err }, 'storage cleanup failed')
    }
    return deleted
  }
}

export const storageManager = new StorageManager()
