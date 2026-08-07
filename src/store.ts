import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { eq, desc, asc, and } from 'drizzle-orm'
import { getDb, getPool } from './db.js'
import { posts, messages, conversations, postEdits, userPreferences, brandProfile, packages, users, tokenTransactions, socialAccounts, adminConfig, payments, userSessions } from './db/schema.js'
import { logger } from './lib/logger.js'
import { storageDir } from './storage.js'
import { encryptSecret, decryptSecret } from './lib/crypto.js'
import type { AdminConfig, BrandProfile, ConversationState, EditRecord, MessageRecord, MessageRole, MessageType, Package, Payment, Post, PostStage, SocialAccount, TokenTransaction, TokenTransactionType, User, UserPreferences } from './types.js'

function postFromRow(row: typeof posts.$inferSelect): Post {
  const data = (row.data ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    phone: row.phone,
    status: (row.stage as PostStage) || 'NEW',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...data,
  } as Post
}

function postToRow(post: Post) {
  const { id, phone, status, createdAt, updatedAt, ...rest } = post
  return {
    id,
    phone,
    stage: status ?? 'NEW',
    createdAt,
    updatedAt,
    data: rest as Record<string, unknown>,
  } as { id: string; phone: string; stage: string; createdAt: string; updatedAt: string; data: Record<string, unknown> }
}

export async function initStore(): Promise<void> {
  const pool = getPool()
  getDb()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'NEW',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_posts_phone ON posts(phone);
    CREATE INDEX IF NOT EXISTS idx_posts_stage ON posts(stage);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      wa_msg_id TEXT,
      post_id TEXT,
      meta TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa ON messages(phone, wa_msg_id);

    CREATE TABLE IF NOT EXISTS conversations (
      phone TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_edits (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      edit_request TEXT NOT NULL,
      content_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edits_post ON post_edits(post_id);

    CREATE TABLE IF NOT EXISTS user_preferences (
      phone TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brand_profile (
      phone TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      included_tokens INTEGER NOT NULL,
      features JSONB NOT NULL DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_packages_slug ON packages(slug);
    CREATE INDEX IF NOT EXISTS idx_packages_active ON packages(is_active);

    CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      active INTEGER NOT NULL DEFAULT 1,
      package_id TEXT,
      tokens_remaining INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

    CREATE TABLE IF NOT EXISTS token_transactions (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      description TEXT NOT NULL,
      post_id TEXT,
      admin_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_token_tx_phone ON token_transactions(phone, created_at);
    CREATE INDEX IF NOT EXISTS idx_token_tx_type ON token_transactions(type);

    CREATE TABLE IF NOT EXISTS social_accounts (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_name TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      connected_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_social_phone ON social_accounts(phone);
    CREATE INDEX IF NOT EXISTS idx_social_platform ON social_accounts(platform);
    CREATE INDEX IF NOT EXISTS idx_social_status ON social_accounts(status);

    CREATE TABLE IF NOT EXISTS admin_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      package_id TEXT,
      token_count INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      type TEXT NOT NULL,
      stripe_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payments_phone ON payments(phone);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_stripe ON payments(stripe_session_id);

    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `)

  // Safe migrations — add columns if missing
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`)

  await seedDefaultPackages()

  const legacyFile = path.join(process.cwd(), 'data', 'posts.json')
  if (fs.existsSync(legacyFile)) {
    try {
      const raw = fs.readFileSync(legacyFile, 'utf-8')
      const legacyPosts: Record<string, Post> = JSON.parse(raw)
      const db = getDb()
      for (const post of Object.values(legacyPosts)) {
        const row = postToRow(post)
        await db.insert(posts).values(row).onConflictDoNothing()
      }
      logger.info({ count: Object.keys(legacyPosts).length }, 'migrated posts from JSON')
      fs.renameSync(legacyFile, legacyFile + '.bak')
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'migration failed, continuing')
    }
  }
}

export async function createPost(phone: string): Promise<Post> {
  const now = new Date().toISOString()
  const post: Post = {
    id: randomUUID(),
    phone,
    status: 'NEW',
    createdAt: now,
    updatedAt: now,
    history: [{ stage: 'NEW', at: now }],
  }
  const row = postToRow(post)
  await getDb().insert(posts).values(row)
  return post
}

export async function getPost(id: string): Promise<Post | undefined> {
  const result = await getDb().select().from(posts).where(eq(posts.id, id)).limit(1)
  if (result.length === 0) return undefined
  const row = result[0]
  return postFromRow(row)
}

export async function listPosts(): Promise<Post[]> {
  const result = await getDb().select().from(posts).orderBy(desc(posts.createdAt))
  return result.map((row) => postFromRow(row))
}

export async function listPostsByPhone(phone: string): Promise<Post[]> {
  const result = await getDb().select().from(posts)
    .where(eq(posts.phone, phone))
    .orderBy(desc(posts.createdAt))
  return result.map((row) => postFromRow(row))
}

export async function updatePost(id: string, patch: Partial<Post>): Promise<Post> {
  const existing = await getPost(id)
  if (!existing) throw new Error(`Post ${id} not found`)
  const updated: Post = { ...existing, ...patch, updatedAt: new Date().toISOString() }
  const row = postToRow(updated)
  await getDb().update(posts).set({
    stage: row.stage,
    updatedAt: row.updatedAt,
    data: row.data,
  }).where(eq(posts.id, id))
  return updated
}

export async function setStage(id: string, status: PostStage, extra: Partial<Post> = {}): Promise<Post> {
  const post = await getPost(id)
  const history = [
    ...(post?.history ?? []),
    { stage: status, at: new Date().toISOString(), note: extra.error },
  ]
  return updatePost(id, { status, history, ...extra })
}

// ---- Messages ----

export async function logMessage(input: {
  phone: string
  role: 'user' | 'bot'
  type: MessageType
  content: string
  waMsgId?: string
  postId?: string
  meta?: string
}): Promise<{ record: MessageRecord; isDuplicate: boolean }> {
  const record: MessageRecord = {
    id: randomUUID(),
    phone: input.phone,
    role: input.role,
    type: input.type,
    content: input.content,
    waMsgId: input.waMsgId,
    postId: input.postId,
    meta: input.meta,
    createdAt: new Date().toISOString(),
  }
  const result = await getDb().insert(messages).values({
    id: record.id,
    phone: record.phone,
    role: record.role,
    type: record.type,
    content: record.content,
    waMsgId: record.waMsgId ?? null,
    postId: record.postId ?? null,
    meta: record.meta ?? null,
    createdAt: record.createdAt,
  }).onConflictDoNothing().returning()
  return { record, isDuplicate: result.length === 0 }
}

export async function getMessages(phone: string): Promise<MessageRecord[]> {
  const result = await getDb().select().from(messages)
    .where(eq(messages.phone, phone))
    .orderBy(messages.createdAt)
  return result.map((r) => ({
    id: r.id,
    phone: r.phone,
    role: r.role as MessageRole,
    type: r.type as MessageType,
    content: r.content,
    waMsgId: r.waMsgId ?? undefined,
    postId: r.postId ?? undefined,
    meta: r.meta ?? undefined,
    createdAt: r.createdAt,
  }))
}

// ---- Conversations (persisted) ----

export async function getConversation(phone: string): Promise<ConversationState> {
  const result = await getDb().select().from(conversations).where(eq(conversations.phone, phone)).limit(1)
  if (result.length === 0) return { kind: 'idle' }
  try {
    return result[0].data as ConversationState
  } catch {
    return { kind: 'idle' }
  }
}

export async function setConversation(phone: string, conv: ConversationState): Promise<void> {
  await getDb().insert(conversations).values({
    phone,
    data: conv as Record<string, unknown>,
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: conversations.phone,
    set: {
      data: conv as Record<string, unknown>,
      updatedAt: new Date().toISOString(),
    },
  })
}

// ---- Edit history ----

export async function saveEdit(postId: string, editRequest: string, contentSnapshot: string): Promise<EditRecord> {
  const record: EditRecord = {
    id: randomUUID(),
    postId,
    editRequest,
    contentSnapshot,
    createdAt: new Date().toISOString(),
  }
  await getDb().insert(postEdits).values({
    id: record.id,
    postId: record.postId,
    editRequest: record.editRequest,
    contentSnapshot: record.contentSnapshot,
    createdAt: record.createdAt,
  })
  return record
}

export async function getEdits(postId: string): Promise<EditRecord[]> {
  const result = await getDb().select().from(postEdits)
    .where(eq(postEdits.postId, postId))
    .orderBy(postEdits.createdAt)
  return result.map((r) => ({
    id: r.id,
    postId: r.postId,
    editRequest: r.editRequest,
    contentSnapshot: r.contentSnapshot,
    createdAt: r.createdAt,
  }))
}

export async function getUserPreferences(phone: string): Promise<UserPreferences | undefined> {
  const result = await getDb().select().from(userPreferences).where(eq(userPreferences.phone, phone)).limit(1)
  if (result.length === 0) return undefined
  try {
    return result[0].data as UserPreferences
  } catch {
    return undefined
  }
}

export async function saveUserPreferences(phone: string, prefs: UserPreferences): Promise<void> {
  await getDb().insert(userPreferences).values({
    phone,
    data: prefs as Record<string, unknown>,
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: userPreferences.phone,
    set: {
      data: prefs as Record<string, unknown>,
      updatedAt: new Date().toISOString(),
    },
  })
}

export async function getBrandProfile(phone: string): Promise<BrandProfile | undefined> {
  const result = await getDb().select().from(brandProfile).where(eq(brandProfile.phone, phone)).limit(1)
  if (result.length === 0) return undefined
  try {
    return result[0].data as BrandProfile
  } catch {
    return undefined
  }
}

export async function saveBrandProfile(phone: string, profile: BrandProfile): Promise<void> {
  await getDb().insert(brandProfile).values({
    phone,
    data: profile as Record<string, unknown>,
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: brandProfile.phone,
    set: {
      data: profile as Record<string, unknown>,
      updatedAt: new Date().toISOString(),
    },
  })
}

// ---- Package CRUD ----

function packageFromRow(row: typeof packages.$inferSelect): Package {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    priceCents: row.priceCents,
    currency: row.currency,
    includedTokens: row.includedTokens,
    features: (row.features ?? {}) as Record<string, unknown>,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function createPackage(data: { name: string; slug: string; description?: string; priceCents: number; includedTokens: number; features?: Record<string, unknown>; sortOrder?: number }): Promise<Package> {
  const now = new Date().toISOString()
  const pkg: Package = {
    id: randomUUID(),
    name: data.name,
    slug: data.slug,
    description: data.description || '',
    priceCents: data.priceCents,
    currency: 'usd',
    includedTokens: data.includedTokens,
    features: data.features || {},
    isActive: true,
    sortOrder: data.sortOrder || 0,
    createdAt: now,
    updatedAt: now,
  }
  await getDb().insert(packages).values({
    id: pkg.id,
    name: pkg.name,
    slug: pkg.slug,
    description: pkg.description,
    priceCents: pkg.priceCents,
    currency: pkg.currency,
    includedTokens: pkg.includedTokens,
    features: pkg.features as Record<string, unknown>,
    isActive: pkg.isActive,
    sortOrder: pkg.sortOrder,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  })
  return pkg
}

export async function getPackage(idOrSlug: string): Promise<Package | undefined> {
  const result = await getDb().select().from(packages).where(eq(packages.id, idOrSlug)).limit(1)
  if (result.length > 0) return packageFromRow(result[0])
  const bySlug = await getDb().select().from(packages).where(eq(packages.slug, idOrSlug)).limit(1)
  if (bySlug.length > 0) return packageFromRow(bySlug[0])
  return undefined
}

export async function getPackageBySlug(slug: string): Promise<Package | undefined> {
  const result = await getDb().select().from(packages).where(eq(packages.slug, slug)).limit(1)
  if (result.length === 0) return undefined
  return packageFromRow(result[0])
}

export async function listPackages(): Promise<Package[]> {
  const result = await getDb().select().from(packages).orderBy(asc(packages.sortOrder))
  return result.map(packageFromRow)
}

export async function listActivePackages(): Promise<Package[]> {
  const result = await getDb().select().from(packages)
    .where(eq(packages.isActive, true))
    .orderBy(asc(packages.sortOrder))
  return result.map(packageFromRow)
}

export async function updatePackage(id: string, patch: Partial<Package>): Promise<Package> {
  const existing = await getPackage(id)
  if (!existing) throw new Error(`Package ${id} not found`)
  const updated: Package = { ...existing, ...patch, updatedAt: new Date().toISOString() }
  await getDb().update(packages).set({
    name: updated.name,
    slug: updated.slug,
    description: updated.description,
    priceCents: updated.priceCents,
    includedTokens: updated.includedTokens,
    features: updated.features as Record<string, unknown>,
    isActive: updated.isActive,
    sortOrder: updated.sortOrder,
    updatedAt: updated.updatedAt,
  }).where(eq(packages.id, id))
  return updated
}

export async function deletePackage(id: string): Promise<void> {
  await getDb().delete(packages).where(eq(packages.id, id))
}

// ---- User CRUD ----

function userFromRow(row: typeof users.$inferSelect): User {
  return {
    phone: row.phone,
    name: row.name || '',
    email: row.email || '',
    role: row.role as 'user' | 'admin',
    active: row.active,
    packageId: row.packageId || '',
    tokensRemaining: row.tokensRemaining,
    tokensUsed: row.tokensUsed,
    stripeCustomerId: row.stripeCustomerId || '',
    stripeSubscriptionId: row.stripeSubscriptionId || '',
    passwordHash: row.passwordHash || undefined,
    oauthProvider: row.oauthProvider || undefined,
    oauthId: row.oauthId || undefined,
    avatarUrl: row.avatarUrl || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function createUser(data: { phone: string; name?: string; email?: string; packageId?: string; tokensRemaining?: number; stripeCustomerId?: string; passwordHash?: string; oauthProvider?: string; oauthId?: string; avatarUrl?: string }): Promise<User> {
  const now = new Date().toISOString()
  const user: User = {
    phone: data.phone,
    name: data.name || '',
    email: data.email || '',
    role: 'user',
    active: 1,
    packageId: data.packageId || '',
    tokensRemaining: data.tokensRemaining || 0,
    tokensUsed: 0,
    stripeCustomerId: data.stripeCustomerId || '',
    stripeSubscriptionId: '',
    passwordHash: data.passwordHash || undefined,
    oauthProvider: data.oauthProvider || undefined,
    oauthId: data.oauthId || undefined,
    avatarUrl: data.avatarUrl || undefined,
    createdAt: now,
    updatedAt: now,
  }
  await getDb().insert(users).values({
    phone: user.phone,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    packageId: user.packageId,
    tokensRemaining: user.tokensRemaining,
    tokensUsed: user.tokensUsed,
    stripeCustomerId: user.stripeCustomerId,
    stripeSubscriptionId: user.stripeSubscriptionId,
    passwordHash: user.passwordHash || null,
    oauthProvider: user.oauthProvider || null,
    oauthId: user.oauthId || null,
    avatarUrl: user.avatarUrl || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  })
  return user
}

export async function getUser(phone: string): Promise<User | undefined> {
  const result = await getDb().select().from(users).where(eq(users.phone, phone)).limit(1)
  if (result.length === 0) return undefined
  return userFromRow(result[0])
}

export async function listUsers(): Promise<User[]> {
  const result = await getDb().select().from(users).orderBy(desc(users.createdAt))
  return result.map(userFromRow)
}

export async function updateUser(phone: string, patch: Partial<User>): Promise<User> {
  const existing = await getUser(phone)
  if (!existing) throw new Error(`User ${phone} not found`)
  const updated: User = { ...existing, ...patch, updatedAt: new Date().toISOString() }
  await getDb().update(users).set({
    name: updated.name,
    email: updated.email,
    role: updated.role,
    active: updated.active,
    packageId: updated.packageId,
    tokensRemaining: updated.tokensRemaining,
    tokensUsed: updated.tokensUsed,
    stripeCustomerId: updated.stripeCustomerId,
    stripeSubscriptionId: updated.stripeSubscriptionId,
    passwordHash: updated.passwordHash || null,
    oauthProvider: updated.oauthProvider || null,
    oauthId: updated.oauthId || null,
    avatarUrl: updated.avatarUrl || null,
    updatedAt: updated.updatedAt,
  }).where(eq(users.phone, phone))
  return updated
}

export async function deleteUser(phone: string): Promise<void> {
  await getDb().delete(users).where(eq(users.phone, phone))
}

export async function activateUser(phone: string): Promise<User> {
  return updateUser(phone, { active: 1 })
}

export async function deactivateUser(phone: string): Promise<User> {
  return updateUser(phone, { active: 0 })
}

// ---- Token Transactions ----

function tokenTxFromRow(row: typeof tokenTransactions.$inferSelect): TokenTransaction {
  return {
    id: row.id,
    phone: row.phone,
    type: row.type as TokenTransactionType,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    description: row.description,
    postId: row.postId || '',
    adminId: row.adminId || '',
    createdAt: row.createdAt,
  }
}

export async function createTokenTransaction(data: { phone: string; type: TokenTransactionType; amount: number; balanceAfter: number; description: string; postId?: string; adminId?: string }): Promise<TokenTransaction> {
  const tx: TokenTransaction = {
    id: randomUUID(),
    phone: data.phone,
    type: data.type,
    amount: data.amount,
    balanceAfter: data.balanceAfter,
    description: data.description,
    postId: data.postId || '',
    adminId: data.adminId || '',
    createdAt: new Date().toISOString(),
  }
  await getDb().insert(tokenTransactions).values({
    id: tx.id,
    phone: tx.phone,
    type: tx.type,
    amount: tx.amount,
    balanceAfter: tx.balanceAfter,
    description: tx.description,
    postId: tx.postId,
    adminId: tx.adminId,
    createdAt: tx.createdAt,
  })
  return tx
}

export async function getTransactions(phone: string, limit = 50): Promise<TokenTransaction[]> {
  const result = await getDb().select().from(tokenTransactions)
    .where(eq(tokenTransactions.phone, phone))
    .orderBy(desc(tokenTransactions.createdAt))
    .limit(limit)
  return result.map(tokenTxFromRow)
}

// ---- Social Accounts ----

async function socialAccountFromRow(row: typeof socialAccounts.$inferSelect): Promise<SocialAccount> {
  return {
    id: row.id,
    phone: row.phone,
    platform: row.platform as 'instagram' | 'facebook' | 'whatsapp',
    accountId: row.accountId,
    accountName: row.accountName || '',
    accessToken: await decryptSecret(row.accessToken),
    refreshToken: await decryptSecret(row.refreshToken || ''),
    tokenExpiresAt: row.tokenExpiresAt || '',
    status: row.status as 'active' | 'expired' | 'disconnected',
    connectedAt: row.connectedAt,
  }
}

export async function connectAccount(data: { phone: string; platform: 'instagram' | 'facebook' | 'whatsapp'; accountId: string; accountName?: string; accessToken: string; refreshToken?: string; tokenExpiresAt?: string }): Promise<SocialAccount> {
  const account: SocialAccount = {
    id: randomUUID(),
    phone: data.phone,
    platform: data.platform,
    accountId: data.accountId,
    accountName: data.accountName || '',
    accessToken: data.accessToken,
    refreshToken: data.refreshToken || '',
    tokenExpiresAt: data.tokenExpiresAt || '',
    status: 'active',
    connectedAt: new Date().toISOString(),
  }
  await getDb().insert(socialAccounts).values({
    id: account.id,
    phone: account.phone,
    platform: account.platform,
    accountId: account.accountId,
    accountName: account.accountName,
    accessToken: await encryptSecret(account.accessToken),
    refreshToken: account.refreshToken ? await encryptSecret(account.refreshToken) : '',
    tokenExpiresAt: account.tokenExpiresAt,
    status: account.status,
    connectedAt: account.connectedAt,
  })
  return account
}

export async function getAccounts(phone: string): Promise<SocialAccount[]> {
  const result = await getDb().select().from(socialAccounts)
    .where(eq(socialAccounts.phone, phone))
    .orderBy(desc(socialAccounts.connectedAt))
  return Promise.all(result.map(socialAccountFromRow))
}

export async function getAccountByPlatform(phone: string, platform: 'instagram' | 'facebook' | 'whatsapp'): Promise<SocialAccount | undefined> {
  const result = await getDb().select().from(socialAccounts)
    .where(and(eq(socialAccounts.phone, phone), eq(socialAccounts.platform, platform)))
    .limit(1)
  if (result.length === 0) return undefined
  return socialAccountFromRow(result[0])
}

export async function disconnectAccount(id: string): Promise<void> {
  await getDb().delete(socialAccounts).where(eq(socialAccounts.id, id))
}

// ---- Admin Config ----

function adminConfigFromRow(row: typeof adminConfig.$inferSelect): AdminConfig {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt,
  }
}

export async function getConfig(key: string): Promise<string | undefined> {
  const result = await getDb().select().from(adminConfig).where(eq(adminConfig.key, key)).limit(1)
  if (result.length === 0) return undefined
  return result[0].value
}

export async function setConfig(key: string, value: string): Promise<void> {
  await getDb().insert(adminConfig).values({
    key,
    value,
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: adminConfig.key,
    set: {
      value,
      updatedAt: new Date().toISOString(),
    },
  })
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const result = await getDb().select().from(adminConfig)
  const config: Record<string, string> = {}
  for (const row of result) {
    config[row.key] = row.value
  }
  return config
}

// ---- Payments ----

function paymentFromRow(row: typeof payments.$inferSelect): Payment {
  return {
    id: row.id,
    phone: row.phone,
    packageId: row.packageId || '',
    tokenCount: row.tokenCount,
    amountCents: row.amountCents,
    type: row.type as 'subscription' | 'one_time' | 'token_purchase',
    stripeSessionId: row.stripeSessionId || '',
    status: row.status as 'pending' | 'completed' | 'failed' | 'refunded',
    createdAt: row.createdAt,
  }
}

export async function createPayment(data: { phone: string; packageId?: string; tokenCount: number; amountCents: number; type: 'subscription' | 'one_time' | 'token_purchase'; stripeSessionId?: string }): Promise<Payment> {
  const payment: Payment = {
    id: randomUUID(),
    phone: data.phone,
    packageId: data.packageId || '',
    tokenCount: data.tokenCount,
    amountCents: data.amountCents,
    type: data.type,
    stripeSessionId: data.stripeSessionId || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  await getDb().insert(payments).values({
    id: payment.id,
    phone: payment.phone,
    packageId: payment.packageId,
    tokenCount: payment.tokenCount,
    amountCents: payment.amountCents,
    type: payment.type,
    stripeSessionId: payment.stripeSessionId,
    status: payment.status,
    createdAt: payment.createdAt,
  })
  return payment
}

export async function getPayment(id: string): Promise<Payment | undefined> {
  const result = await getDb().select().from(payments).where(eq(payments.id, id)).limit(1)
  if (result.length === 0) return undefined
  return paymentFromRow(result[0])
}

export async function getPaymentByStripeSession(sessionId: string): Promise<Payment | undefined> {
  const result = await getDb().select().from(payments).where(eq(payments.stripeSessionId, sessionId)).limit(1)
  if (result.length === 0) return undefined
  return paymentFromRow(result[0])
}

export async function listPayments(phone?: string): Promise<Payment[]> {
  let query
  if (phone) {
    query = getDb().select().from(payments).where(eq(payments.phone, phone))
  } else {
    query = getDb().select().from(payments)
  }
  const result = await query.orderBy(desc(payments.createdAt))
  return result.map(paymentFromRow)
}

export async function updatePayment(id: string, patch: Partial<Payment>): Promise<Payment> {
  const existing = await getPayment(id)
  if (!existing) throw new Error(`Payment ${id} not found`)
  const updated: Payment = { ...existing, ...patch }
  await getDb().update(payments).set({
    status: updated.status,
  }).where(eq(payments.id, id))
  return updated
}

// ---- User Auth (email/password + OAuth) ----

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const result = await getDb().select().from(users).where(eq(users.email, email)).limit(1)
  if (result.length === 0) return undefined
  return userFromRow(result[0])
}

export async function createUserSession(token: string, userEmail: string, expiresAt: string): Promise<void> {
  await getDb().insert(userSessions).values({
    token,
    userEmail,
    createdAt: new Date().toISOString(),
    expiresAt,
  })
}

export async function getUserSession(token: string): Promise<{ token: string; userEmail: string; createdAt: string; expiresAt: string } | undefined> {
  const result = await getDb().select().from(userSessions).where(eq(userSessions.token, token)).limit(1)
  if (result.length === 0) return undefined
  const row = result[0]
  if (new Date(row.expiresAt) < new Date()) {
    await deleteUserSession(token)
    return undefined
  }
  return { token: row.token, userEmail: row.userEmail, createdAt: row.createdAt, expiresAt: row.expiresAt }
}

export async function deleteUserSession(token: string): Promise<void> {
  await getDb().delete(userSessions).where(eq(userSessions.token, token))
}

// ---- Package Seeding ----

const DEFAULT_PACKAGES = [
  { name: 'Facebook Only', slug: 'facebook-only', description: 'Perfect for Facebook-only creators', priceCents: 500, includedTokens: 15, sortOrder: 0,
    features: { facebook_publishing: true, instagram_publishing: false, whatsapp_broadcasts: false, voice_transcription: true, scheduled_publishing: false, analytics_dashboard: false, priority_support: false }},
  { name: 'Starter', slug: 'starter', description: 'Get started with social media automation', priceCents: 1500, includedTokens: 100, sortOrder: 1,
    features: { facebook_publishing: true, instagram_publishing: true, whatsapp_broadcasts: false, voice_transcription: true, scheduled_publishing: false, analytics_dashboard: true, priority_support: false }},
  { name: 'Pro', slug: 'pro', description: 'For professional content creators', priceCents: 2900, includedTokens: 1000, sortOrder: 2,
    features: { facebook_publishing: true, instagram_publishing: true, whatsapp_broadcasts: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true }},
  { name: 'Exclusive', slug: 'exclusive', description: 'Full access to all features', priceCents: 9900, includedTokens: 3000, sortOrder: 3,
    features: { facebook_publishing: true, instagram_publishing: true, whatsapp_broadcasts: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true, ad_campaigns: true, custom_branding: true }},
]

async function seedDefaultPackages(): Promise<void> {
  const existing = await listPackages()
  if (existing.length > 0) return
  const now = new Date().toISOString()
  for (const pkg of DEFAULT_PACKAGES) {
    await getDb().insert(packages).values({
      id: randomUUID(),
      name: pkg.name,
      slug: pkg.slug,
      description: pkg.description,
      priceCents: pkg.priceCents,
      currency: 'usd',
      includedTokens: pkg.includedTokens,
      features: pkg.features as Record<string, unknown>,
      isActive: true,
      sortOrder: pkg.sortOrder,
      createdAt: now,
      updatedAt: now,
    })
  }
  logger.info({ count: DEFAULT_PACKAGES.length }, 'seeded default packages')
}

// ---- Reset Store ----

export async function resetStore(): Promise<void> {
  const pool = getPool()
  await pool.query('DELETE FROM posts')
  await pool.query('DELETE FROM messages')
  await pool.query('DELETE FROM post_edits')
  await pool.query('DELETE FROM conversations')
  await pool.query('DELETE FROM user_preferences')
  await pool.query('DELETE FROM brand_profile')
  await pool.query('DELETE FROM packages')
  await pool.query('DELETE FROM users')
  await pool.query('DELETE FROM token_transactions')
  await pool.query('DELETE FROM social_accounts')
  await pool.query('DELETE FROM admin_config')
  await pool.query('DELETE FROM payments')
  await pool.query('DELETE FROM user_sessions')
}

const STUCK_STATUSES = ['PREPARING_TO_PUBLISH', 'PUBLISHING'] as PostStage[]

/**
 * Recovers posts stuck in PREPARING_TO_PUBLISH or PUBLISHING after a server restart.
 *
 * Safety notes:
 * - Instagram's media_publish is idempotent for the same container: calling it twice
 *   returns the same mediaId, so double-publish is not possible.
 * - Orphaned containers (from mid-polling crashes) expire on Instagram's side (~24h).
 * - Blind reset to AWAITING_APPROVAL is safe: the user can re-approve, and the new
 *   publish will create a fresh container.
 * - For production multi-user systems, consider storing the container ID and checking
 *   Instagram's container status before deciding to retry vs. mark failed.
 */
export async function recoverStuckPosts(): Promise<number> {
  const allPosts = await listPosts()
  let recovered = 0
  for (const post of allPosts) {
    if (STUCK_STATUSES.includes(post.status as PostStage)) {
      const history = [
        ...(post.history ?? []),
        { stage: 'AWAITING_APPROVAL' as PostStage, at: new Date().toISOString(), note: 'recovered after restart' },
      ]
      await updatePost(post.id, { status: 'AWAITING_APPROVAL', history })
      await setConversation(post.phone, { kind: 'awaiting_approval', postId: post.id })
      recovered++
    }
  }
  if (recovered > 0) {
    logger.info({ recovered }, 'recovered stuck posts after restart')
  }
  return recovered
}

export { storageDir } from './storage.js'
