import { describe, it, expect, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { suggestAdObjective } from '../src/pipeline/adGenerate.js'
import { chat } from '../src/lib/llm.js'

const chatMock = vi.mocked(chat)

describe('suggestAdObjective parses bare-string output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a bare objective string', async () => {
    chatMock.mockResolvedValue('OUTCOME_LEADS')
    await expect(suggestAdObjective('gym', 'get leads')).resolves.toBe('OUTCOME_LEADS')
  })

  it('trims surrounding quotes and whitespace', async () => {
    chatMock.mockResolvedValue('  "OUTCOME_SALES"  ')
    await expect(suggestAdObjective('gym', 'sell')).resolves.toBe('OUTCOME_SALES')
  })

  it('falls back to engagement on unknown output', async () => {
    chatMock.mockResolvedValue('SOMETHING_ELSE')
    await expect(suggestAdObjective('gym', 'x')).resolves.toBe('OUTCOME_ENGAGEMENT')
  })
})