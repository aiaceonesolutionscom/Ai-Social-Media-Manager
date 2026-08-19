import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
include: ['tests/**/*.test.ts'],
    // This file deliberately calls a real LLM and is only for an explicit
    // credential-backed smoke test. It must not make the regular test suite
    // slow, flaky, or dependent on an external provider.
    exclude: ['tests/live-llm.test.ts'],
  },
})
