import path from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { config } from '../config.js'

export function registerMediaRoute(server: any): void {
  server.get('/media/:file', async (req: any, reply: any) => {
    const file = req.params.file
    const safeFile = path.basename(file)
    const filePath = path.join(config.storageDir, 'images', safeFile)
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
