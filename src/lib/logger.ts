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

function write(level: string, obj: unknown, msg?: string): void {
  const record =
    typeof obj === 'string'
      ? { level, time: timestamp(), msg: obj }
      : { level, time: timestamp(), ...(obj as object), ...(msg ? { msg } : {}) }
  const line = JSON.stringify(record)
  if (level === 'error') {
    process.stderr.write(line + '\n')
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
