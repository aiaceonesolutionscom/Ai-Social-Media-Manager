import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, connectAccount, getAccounts } from '../src/store.js'
import { PHONE } from './helpers.js'

describe('social account connect upsert', () => {
  beforeAll(async () => {
    await initStore()
  })

  beforeEach(async () => {
    await resetStore()
  })

  it('upserts the same platform instead of throwing on the unique (phone, platform) index', async () => {
    await connectAccount({ phone: PHONE, platform: 'facebook', accountId: 'page-1', accountName: 'Page 1', accessToken: 'token-1' })
    await connectAccount({ phone: PHONE, platform: 'facebook', accountId: 'page-2', accountName: 'Page 2', accessToken: 'token-2' })

    const accounts = await getAccounts(PHONE)
    const fb = accounts.filter((a) => a.platform === 'facebook')
    expect(fb).toHaveLength(1)
    expect(fb[0].accountId).toBe('page-2')
    expect(fb[0].accountName).toBe('Page 2')
    expect(fb[0].accessToken).toBe('token-2')
  })

  it('keeps distinct platforms as separate rows', async () => {
    await connectAccount({ phone: PHONE, platform: 'instagram', accountId: 'ig-1', accountName: 'IG', accessToken: 'ig-token' })
    await connectAccount({ phone: PHONE, platform: 'facebook', accountId: 'fb-1', accountName: 'FB', accessToken: 'fb-token' })

    const accounts = await getAccounts(PHONE)
    expect(accounts).toHaveLength(2)
  })
})