import { vi } from 'vitest'

// Tests must NEVER touch a production database. Whatever DATABASE_URL is present in the
// environment or .env, force it to a _test database before any module reads it. This is
// defense-in-depth alongside resetStore(), which refuses to wipe non-test databases.
const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ai_instagram_test'

function dbNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    return segments[segments.length - 1] || ''
  } catch {
    return ''
  }
}

const existingUrl = process.env.DATABASE_URL || ''
const existingName = dbNameFromUrl(existingUrl)
vi.stubEnv('DATABASE_URL', existingName.endsWith('_test') ? existingUrl : TEST_DB_URL)
