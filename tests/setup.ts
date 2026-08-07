import { vi } from 'vitest'

if (!process.env.DATABASE_URL) {
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/ai_instagram_test')
}
