import { config } from '../config.js'

export type Logger = {
  info: (obj: unknown, msg?: string) => void
  warn: (obj: unknown, msg?: string) => void
  error: (obj: unknown, msg?: string) => void
  debug: (obj: unknown, msg?: string) => void
}

function timestamp(): string {
  return new Date().toISOString()
}

let dbReady = false
export function setLoggerDbReady(ready: boolean): void {
  dbReady = ready
}

async function persistError(obj: unknown, msg?: string): Promise<void> {
  if (!dbReady) return
  try {
    const { createErrorLog } = await import('../store.js')
    const details =
      typeof obj === 'object' && obj !== null
        ? { ...(obj as Record<string, unknown>) }
        : {}
    await createErrorLog({
      source: typeof details.source === 'string' && details.source ? details.source : 'app',
      message: msg || (typeof obj === 'string' ? obj : String(details.msg || '')),
      stack: typeof details.stack === 'string' ? details.stack : undefined,
      details,
    })
  } catch {
    // Never let logging crash the app.
  }
}

function write(level: string, obj: unknown, msg?: string): void {
  const record =
    typeof obj === 'string'
      ? { level, time: timestamp(), msg: obj }
      : { level, time: timestamp(), ...(obj as object), ...(msg ? { msg } : {}) }
  const line = JSON.stringify(record)
  if (level === 'error') {
    process.stderr.write(line + '\n')
    void persistError(obj, msg)
  } else {
    process.stdout.write(line + '\n')
  }
}

export const logger: Logger = {
  info: (obj, msg) => {
    if (['info', 'warn', 'error', 'debug'].includes(config.logLevel)) write('info', obj, msg)
  },
  warn: (obj, msg) => {
    if (['warn', 'error', 'debug'].includes(config.logLevel)) write('warn', obj, msg)
  },
  error: (obj, msg) => write('error', obj, msg),
  debug: (obj, msg) => {
    if (config.logLevel === 'debug') write('debug', obj, msg)
  },
}