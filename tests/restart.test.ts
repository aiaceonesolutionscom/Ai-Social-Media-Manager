import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initStore, resetStore, createPost, updatePost, setConversation, getPost, getConversation } from '../src/store.js'
import { recoverStuckPosts } from '../src/store.js'
import type { PostStage } from '../src/types.js'

describe('P1 — publish-job recovery after restart', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    await resetStore()
  })

  it('resets posts stuck in PREPARING_TO_PUBLISH to AWAITING_APPROVAL', async () => {
    const post = await createPost('919999999999')
    await updatePost(post.id, { status: 'PREPARING_TO_PUBLISH' as PostStage })
    await setConversation('919999999999', { kind: 'preparing_publish', postId: post.id })

    const recovered = await recoverStuckPosts()
    expect(recovered).toBe(1)

    const updated = await getPost(post.id)!
    expect(updated!.status).toBe('AWAITING_APPROVAL')
    expect(updated!.history).toBeDefined()
    const recoveryNote = updated!.history!.find((h) => h.note === 'recovered after restart')
    expect(recoveryNote).toBeDefined()

    const conv = await getConversation('919999999999')
    expect(conv.kind).toBe('awaiting_approval')
    expect(conv.postId).toBe(post.id)
  })

  it('resets posts stuck in PUBLISHING to AWAITING_APPROVAL', async () => {
    const post = await createPost('919999999998')
    await updatePost(post.id, { status: 'PUBLISHING' as PostStage })
    await setConversation('919999999998', { kind: 'publishing', postId: post.id })

    const recovered = await recoverStuckPosts()
    expect(recovered).toBe(1)

    const updated = await getPost(post.id)!
    expect(updated!.status).toBe('AWAITING_APPROVAL')
    const conv = await getConversation('919999999998')
    expect(conv.kind).toBe('awaiting_approval')
  })

  it('does not touch posts in other states', async () => {
    await createPost('919999999997')
    const post = await createPost('919999999996')
    await updatePost(post.id, { status: 'AWAITING_APPROVAL' as PostStage })

    const recovered = await recoverStuckPosts()
    expect(recovered).toBe(0)
    const updated = await getPost(post.id)
    expect(updated!.status).toBe('AWAITING_APPROVAL')
  })

  it('returns 0 when no posts are stuck', async () => {
    const recovered = await recoverStuckPosts()
    expect(recovered).toBe(0)
  })
})
