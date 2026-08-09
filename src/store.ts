import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { eq, desc, asc, and, sql, inArray } from 'drizzle-orm'
import { getDb, getPool } from './db.js'
import { posts, messages, conversations, postEdits, userPreferences, brandProfile, packages, topupBundles, users, tokenTransactions, socialAccounts, adminConfig, adminUsers, payments, userSessions, adCampaigns, aiProviders, aiUsageLogs, aiProviderCosts, metaConfig, supportTickets, supportReplies, auditLogs, webhookEvents, scheduledPosts } from './db/schema.js'
import { logger } from './lib/logger.js'
import { storageDir } from './storage.js'
import { encryptSecret, decryptSecret } from './lib/crypto.js'
import type { AdCampaign, AdminConfig, AIProvider, AIProviderCategory, AIProviderInput, AIUsageLog, AICostConfig, BrandProfile, ConversationState, EditRecord, MessageRecord, MessageRole, MessageType, Package, Payment, Post, PostStage, SocialAccount, TokenTransaction, TokenTransactionType, TopUpBundle, User, UserPreferences } from './types.js'

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

    CREATE TABLE IF NOT EXISTS topup_bundles (
      id TEXT PRIMARY KEY,
      tokens INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_topup_active ON topup_bundles(is_active);

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
      password_hash TEXT,
      oauth_provider TEXT,
      oauth_id TEXT,
      avatar_url TEXT,
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

    CREATE TABLE IF NOT EXISTS ad_campaigns (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      post_id TEXT,
      name TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ad_content JSONB NOT NULL,
      targeting JSONB NOT NULL,
      budget_cents INTEGER NOT NULL,
      campaign_id TEXT,
      ad_set_id TEXT,
      ad_id TEXT,
      image_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_phone ON ad_campaigns(phone);
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status ON ad_campaigns(status);
    ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS publish_at TEXT;

    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      api_key TEXT,
      base_url TEXT,
      model TEXT,
      config JSONB NOT NULL DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT false,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_providers_category ON ai_providers(category);
    CREATE INDEX IF NOT EXISTS idx_ai_providers_active ON ai_providers(is_active);

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id TEXT PRIMARY KEY,
      phone TEXT,
      provider_id TEXT NOT NULL,
      category TEXT NOT NULL,
      model TEXT,
      feature TEXT,
      tokens_input INTEGER NOT NULL DEFAULT 0,
      tokens_output INTEGER NOT NULL DEFAULT 0,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      success BOOLEAN NOT NULL DEFAULT true,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage_logs(provider_id);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_category ON ai_usage_logs(category);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_phone ON ai_usage_logs(phone);

    CREATE TABLE IF NOT EXISTS ai_provider_costs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      category TEXT NOT NULL,
      cost_per_1m_input_tokens INTEGER NOT NULL DEFAULT 0,
      cost_per_1m_output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_per_image INTEGER NOT NULL DEFAULT 0,
      cost_per_audio_minute INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_costs_provider ON ai_provider_costs(provider);

    CREATE TABLE IF NOT EXISTS meta_config (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      is_sensitive BOOLEAN NOT NULL DEFAULT false,
      updated_at TEXT NOT NULL,
      UNIQUE(category, key)
    );
    CREATE INDEX IF NOT EXISTS idx_meta_config_category ON meta_config(category);

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_support_phone ON support_tickets(phone);
    CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status);

    CREATE TABLE IF NOT EXISTS support_replies (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_support_replies_ticket ON support_replies(ticket_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'user',
      action TEXT NOT NULL,
      target TEXT,
      target_type TEXT,
      details JSONB NOT NULL DEFAULT '{}',
      ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      headers JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'received',
      response_code INTEGER,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_source ON webhook_events(source);
    CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events(status);
    CREATE INDEX IF NOT EXISTS idx_webhook_created ON webhook_events(created_at);

    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      publish_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_phone ON scheduled_posts(phone);
    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_publish_at ON scheduled_posts(publish_at);
  `)

  // Safe migrations — add columns if missing
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`)
  await pool.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly'`)
  await pool.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS yearly_price_cents INTEGER NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS setup_type TEXT NOT NULL DEFAULT 'none'`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      permissions JSONB NOT NULL DEFAULT '[]',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'admin_users' AND column_name = 'is_active' AND data_type = 'integer'
      ) THEN
        ALTER TABLE admin_users ALTER COLUMN is_active DROP DEFAULT;
        ALTER TABLE admin_users ALTER COLUMN is_active TYPE BOOLEAN USING (is_active::int::boolean);
        ALTER TABLE admin_users ALTER COLUMN is_active SET DEFAULT true;
      END IF;
    END $$;
  `)

  await seedDefaultPackages()
  await seedDefaultTopUpBundles()
  await migratePackageFeatures()

  await seedDefaultAIProviders()
  await migrateMetaConfigFromEnv()

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

// List posts for a user's canonical phone, also matching any connected WhatsApp
// numbers (webhook posts are keyed by the real sender number).
export async function listPostsForUser(phone: string): Promise<Post[]> {
  const accounts = await getDb().select({ accountId: socialAccounts.accountId }).from(socialAccounts)
    .where(and(eq(socialAccounts.phone, phone), eq(socialAccounts.platform, 'whatsapp')))
  const numbers = [phone, ...accounts.map((a) => a.accountId)]
  if (numbers.length === 1) return listPostsByPhone(phone)
  const result = await getDb().select().from(posts)
    .where(sql`${posts.phone} IN (${sql.join(numbers.map((n) => sql`${n}`), sql`, `)})`)
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
    billingPeriod: (row.billingPeriod ?? 'monthly') as 'monthly' | 'yearly',
    yearlyPriceCents: row.yearlyPriceCents ?? 0,
    setupType: (row.setupType ?? 'none') as 'none' | 'standard' | 'premium',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function createPackage(data: { name: string; slug: string; description?: string; priceCents: number; includedTokens: number; features?: Record<string, unknown>; sortOrder?: number; billingPeriod?: 'monthly' | 'yearly'; yearlyPriceCents?: number; setupType?: 'none' | 'standard' | 'premium' }): Promise<Package> {
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
    billingPeriod: data.billingPeriod || 'monthly',
    yearlyPriceCents: data.yearlyPriceCents || 0,
    setupType: data.setupType || 'none',
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
    billingPeriod: pkg.billingPeriod,
    yearlyPriceCents: pkg.yearlyPriceCents,
    setupType: pkg.setupType,
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
    billingPeriod: updated.billingPeriod,
    yearlyPriceCents: updated.yearlyPriceCents,
    setupType: updated.setupType,
    updatedAt: updated.updatedAt,
  }).where(eq(packages.id, id))
  return updated
}

export async function deletePackage(id: string): Promise<void> {
  await getDb().delete(packages).where(eq(packages.id, id))
}

// ---- Top-up Bundles ----

const DEFAULT_TOP_UP_BUNDLES = [
  { tokens: 200, priceCents: 600, sortOrder: 0 },
  { tokens: 500, priceCents: 1400, sortOrder: 1 },
  { tokens: 1000, priceCents: 2700, sortOrder: 2 },
  { tokens: 2500, priceCents: 6500, sortOrder: 3 },
]

function topUpBundleFromRow(row: typeof topupBundles.$inferSelect): TopUpBundle {
  return {
    id: row.id,
    tokens: row.tokens,
    priceCents: row.priceCents,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function seedDefaultTopUpBundles(): Promise<void> {
  const existing = await listTopUpBundles()
  if (existing.length > 0) return
  const now = new Date().toISOString()
  for (const bundle of DEFAULT_TOP_UP_BUNDLES) {
    await getDb().insert(topupBundles).values({
      id: randomUUID(),
      tokens: bundle.tokens,
      priceCents: bundle.priceCents,
      isActive: true,
      sortOrder: bundle.sortOrder,
      createdAt: now,
      updatedAt: now,
    })
  }
  logger.info({ count: DEFAULT_TOP_UP_BUNDLES.length }, 'seeded default top-up bundles')
}

export async function listTopUpBundles(): Promise<TopUpBundle[]> {
  const result = await getDb().select().from(topupBundles).orderBy(asc(topupBundles.sortOrder))
  return result.map(topUpBundleFromRow)
}

export async function listActiveTopUpBundles(): Promise<TopUpBundle[]> {
  const result = await getDb().select().from(topupBundles)
    .where(eq(topupBundles.isActive, true))
    .orderBy(asc(topupBundles.sortOrder))
  return result.map(topUpBundleFromRow)
}

export async function getTopUpBundle(id: string): Promise<TopUpBundle | undefined> {
  const result = await getDb().select().from(topupBundles).where(eq(topupBundles.id, id)).limit(1)
  return result.length > 0 ? topUpBundleFromRow(result[0]) : undefined
}

export async function createTopUpBundle(data: { tokens: number; priceCents: number; sortOrder?: number }): Promise<TopUpBundle> {
  const now = new Date().toISOString()
  const bundle: TopUpBundle = {
    id: randomUUID(),
    tokens: data.tokens,
    priceCents: data.priceCents,
    isActive: true,
    sortOrder: data.sortOrder || 0,
    createdAt: now,
    updatedAt: now,
  }
  await getDb().insert(topupBundles).values({
    id: bundle.id,
    tokens: bundle.tokens,
    priceCents: bundle.priceCents,
    isActive: bundle.isActive,
    sortOrder: bundle.sortOrder,
    createdAt: bundle.createdAt,
    updatedAt: bundle.updatedAt,
  })
  return bundle
}

export async function updateTopUpBundle(id: string, patch: Partial<TopUpBundle>): Promise<TopUpBundle> {
  const existing = await getTopUpBundle(id)
  if (!existing) throw new Error(`Top-up bundle ${id} not found`)
  const updated: TopUpBundle = { ...existing, ...patch, updatedAt: new Date().toISOString() }
  await getDb().update(topupBundles).set({
    tokens: updated.tokens,
    priceCents: updated.priceCents,
    isActive: updated.isActive,
    sortOrder: updated.sortOrder,
    updatedAt: updated.updatedAt,
  }).where(eq(topupBundles.id, id))
  return updated
}

export async function deleteTopUpBundle(id: string): Promise<void> {
  await getDb().delete(topupBundles).where(eq(topupBundles.id, id))
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

export async function listAllTokenTransactions(limit = 5000): Promise<TokenTransaction[]> {
  const result = await getDb().select().from(tokenTransactions)
    .orderBy(desc(tokenTransactions.createdAt))
    .limit(limit)
  return result.map(tokenTxFromRow)
}

// ---- Social Accounts ----

async function socialAccountFromRow(row: typeof socialAccounts.$inferSelect): Promise<SocialAccount> {
  return {
    id: row.id,
    phone: row.phone,
    platform: row.platform as 'instagram' | 'facebook' | 'whatsapp' | 'meta_ads',
    accountId: row.accountId,
    accountName: row.accountName || '',
    accessToken: await decryptSecret(row.accessToken),
    refreshToken: await decryptSecret(row.refreshToken || ''),
    tokenExpiresAt: row.tokenExpiresAt || '',
    status: row.status as 'active' | 'expired' | 'disconnected',
    connectedAt: row.connectedAt,
  }
}

export async function connectAccount(data: { phone: string; platform: 'instagram' | 'facebook' | 'whatsapp' | 'meta_ads'; accountId: string; accountName?: string; accessToken: string; refreshToken?: string; tokenExpiresAt?: string }): Promise<SocialAccount> {
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

export async function getAccountByPlatform(phone: string, platform: 'instagram' | 'facebook' | 'whatsapp' | 'meta_ads'): Promise<SocialAccount | undefined> {
  const result = await getDb().select().from(socialAccounts)
    .where(and(eq(socialAccounts.phone, phone), eq(socialAccounts.platform, platform)))
    .limit(1)
  if (result.length === 0) return undefined
  return socialAccountFromRow(result[0])
}

export async function disconnectAccount(id: string): Promise<void> {
  await getDb().update(socialAccounts).set({ status: 'disconnected' }).where(eq(socialAccounts.id, id))
}

// Resolve a WhatsApp sender number (webhook `from`) to the user's canonical phone.
// A real number is stored as `social_accounts.accountId` (platform=whatsapp) for the
// user whose canonical phone is `social_accounts.phone`. Users whose canonical phone IS
// the real number (e.g. admin-created or tests) resolve to themselves directly.
export async function resolveUserPhone(phone: string): Promise<string> {
  const direct = await getUser(phone)
  if (direct) return phone

  const result = await getDb().select({ userPhone: socialAccounts.phone }).from(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'whatsapp'), eq(socialAccounts.accountId, phone)))
    .limit(1)
  if (result.length === 0) return phone
  return result[0].userPhone
}

export async function getUserByWhatsAppNumber(waNumber: string): Promise<User | undefined> {
  const result = await getDb().select({ userPhone: socialAccounts.phone }).from(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'whatsapp'), eq(socialAccounts.accountId, waNumber)))
    .limit(1)
  if (result.length === 0) return undefined
  return getUser(result[0].userPhone)
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
    type: row.type as 'subscription' | 'one_time' | 'token_purchase' | 'topup',
    stripeSessionId: row.stripeSessionId || '',
    status: row.status as 'pending' | 'completed' | 'failed' | 'refunded',
    createdAt: row.createdAt,
  }
}

export async function createPayment(data: { phone: string; packageId?: string | null; tokenCount: number; amountCents: number; type: 'subscription' | 'one_time' | 'token_purchase' | 'topup'; stripeSessionId?: string }): Promise<Payment> {
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
    packageId: updated.packageId,
    tokenCount: updated.tokenCount,
    amountCents: updated.amountCents,
    type: updated.type,
    stripeSessionId: updated.stripeSessionId,
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

export async function updateUserSessionsEmail(oldEmail: string, newEmail: string): Promise<void> {
  await getDb().update(userSessions).set({ userEmail: newEmail }).where(eq(userSessions.userEmail, oldEmail))
}

// ---- Admin Users ----

export interface AdminUserRow {
  id: string
  email: string
  name: string
  passwordHash: string
  role: 'super_admin' | 'admin'
  permissions: string[]
  isActive: boolean
  createdBy: string
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

function adminUserFromRow(row: typeof adminUsers.$inferSelect): AdminUserRow {
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    passwordHash: row.passwordHash,
    role: (row.role as AdminUserRow['role']) || 'admin',
    permissions: Array.isArray(row.permissions) ? (row.permissions as string[]) : [],
    isActive: row.isActive === true,
    createdBy: row.createdBy || '',
    lastLoginAt: row.lastLoginAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const result = await getDb().select().from(adminUsers).orderBy(asc(adminUsers.createdAt))
  return result.map(adminUserFromRow)
}

export async function getAdminUserByEmail(email: string): Promise<AdminUserRow | undefined> {
  const result = await getDb().select().from(adminUsers).where(eq(adminUsers.email, email.toLowerCase())).limit(1)
  if (result.length === 0) return undefined
  return adminUserFromRow(result[0])
}

export async function getAdminUser(id: string): Promise<AdminUserRow | undefined> {
  const result = await getDb().select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1)
  if (result.length === 0) return undefined
  return adminUserFromRow(result[0])
}

export async function createAdminUser(data: {
  email: string
  name: string
  passwordHash: string
  role?: 'super_admin' | 'admin'
  permissions?: string[]
  createdBy?: string
}): Promise<AdminUserRow> {
  const now = new Date().toISOString()
  const id = randomUUID()
  await getDb().insert(adminUsers).values({
    id,
    email: data.email.toLowerCase(),
    name: data.name,
    passwordHash: data.passwordHash,
    role: data.role || 'admin',
    permissions: data.permissions || [],
    isActive: true,
    createdBy: data.createdBy || '',
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  })
  return (await getAdminUser(id))!
}

export async function updateAdminUser(id: string, patch: Partial<Omit<AdminUserRow, 'id' | 'createdAt'>>): Promise<AdminUserRow> {
  const existing = await getAdminUser(id)
  if (!existing) throw new Error(`Admin ${id} not found`)
  const updated: AdminUserRow = { ...existing, ...patch, updatedAt: new Date().toISOString() }
  await getDb().update(adminUsers).set({
    email: updated.email,
    name: updated.name,
    passwordHash: updated.passwordHash,
    role: updated.role,
    permissions: updated.permissions,
    isActive: updated.isActive,
    createdBy: updated.createdBy,
    lastLoginAt: updated.lastLoginAt,
    updatedAt: updated.updatedAt,
  }).where(eq(adminUsers.id, id))
  return updated
}

export async function deleteAdminUser(id: string): Promise<void> {
  await getDb().delete(adminUsers).where(eq(adminUsers.id, id))
}

export async function touchAdminLogin(id: string): Promise<void> {
  await getDb().update(adminUsers).set({ lastLoginAt: new Date().toISOString() }).where(eq(adminUsers.id, id))
}

// ---- Audit Logs ----

export async function listAuditLogs(opts: { actorType?: string; actor?: string; action?: string; limit?: number; offset?: number } = {}): Promise<Array<typeof auditLogs.$inferSelect>> {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const conditions = []
  if (opts.actorType) conditions.push(eq(auditLogs.actorType, opts.actorType))
  if (opts.actor) conditions.push(eq(auditLogs.actor, opts.actor))
  if (opts.action) conditions.push(eq(auditLogs.action, opts.action))
  const q = getDb().select().from(auditLogs)
  if (conditions.length === 1) q.where(conditions[0])
  if (conditions.length > 1) q.where(and(...conditions))
  const result = await q.orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset)
  return result
}

export async function countAuditLogs(opts: { actorType?: string; actor?: string; action?: string } = {}): Promise<number> {
  const conditions = []
  if (opts.actorType) conditions.push(eq(auditLogs.actorType, opts.actorType))
  if (opts.actor) conditions.push(eq(auditLogs.actor, opts.actor))
  if (opts.action) conditions.push(eq(auditLogs.action, opts.action))
  const q = getDb().select({ count: sql<number>`count(*)::int` }).from(auditLogs)
  if (conditions.length === 1) q.where(conditions[0])
  if (conditions.length > 1) q.where(and(...conditions))
  const result = await q
  return result[0]?.count ?? 0
}

// ---- Package Seeding ----

interface SeedPackage {
  name: string
  slug: string
  description: string
  priceCents: number
  includedTokens: number
  sortOrder: number
  billingPeriod: 'monthly' | 'yearly'
  yearlyPriceCents: number
  setupType: 'none' | 'standard' | 'premium'
  features: Record<string, boolean>
}

const DEFAULT_PACKAGES: SeedPackage[] = [
  { name: 'Facebook Only', slug: 'facebook-only', description: 'Perfect for Facebook-only creators', priceCents: 500, includedTokens: 15, sortOrder: 0, billingPeriod: 'monthly', yearlyPriceCents: 0, setupType: 'none', features: { facebook_publishing: true, instagram_publishing: false, whatsapp_broadcast: false, web_chat: false, voice_transcription: true, scheduled_publishing: false, analytics_dashboard: false, priority_support: false, ad_campaigns: false, custom_branding: false } },
  { name: 'Starter', slug: 'starter', description: 'Get started with social media automation', priceCents: 1500, includedTokens: 100, sortOrder: 1, billingPeriod: 'monthly', yearlyPriceCents: 0, setupType: 'none', features: { facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: false, web_chat: false, voice_transcription: true, scheduled_publishing: false, analytics_dashboard: true, priority_support: false, ad_campaigns: false, custom_branding: false } },
  { name: 'Pro', slug: 'pro', description: 'For professional content creators', priceCents: 2900, includedTokens: 1000, sortOrder: 2, billingPeriod: 'monthly', yearlyPriceCents: 0, setupType: 'none', features: { facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: true, web_chat: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true, ad_campaigns: true, custom_branding: false } },
  { name: 'Exclusive', slug: 'exclusive', description: 'Full access to all features', priceCents: 9900, includedTokens: 3000, sortOrder: 3, billingPeriod: 'monthly', yearlyPriceCents: 0, setupType: 'none', features: { facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: true, web_chat: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true, ad_campaigns: true, custom_branding: true } },
]

const CANONICAL_FEATURE_KEYS = [
  'facebook_publishing',
  'instagram_publishing',
  'whatsapp_broadcast',
  'web_chat',
  'voice_transcription',
  'scheduled_publishing',
  'analytics_dashboard',
  'priority_support',
  'ad_campaigns',
  'custom_branding',
]

const LEGACY_FEATURE_MAP: Record<string, string> = {
  whatsapp_broadcasts: 'whatsapp_broadcast',
}

async function seedDefaultPackages(): Promise<void> {
  const now = new Date().toISOString()
  for (const pkg of DEFAULT_PACKAGES) {
    const row = {
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
      billingPeriod: pkg.billingPeriod,
      yearlyPriceCents: pkg.yearlyPriceCents,
      setupType: pkg.setupType,
      createdAt: now,
      updatedAt: now,
    }
    await getDb().insert(packages).values(row).onConflictDoNothing({ target: packages.slug }).execute()
    await getDb().update(packages).set({
      billingPeriod: pkg.billingPeriod,
      yearlyPriceCents: pkg.yearlyPriceCents,
      setupType: pkg.setupType,
    }).where(eq(packages.slug, pkg.slug))
  }
  logger.info({ count: DEFAULT_PACKAGES.length }, 'seeded default packages')
}

/**
 * One-time migration that repairs stale/legacy package feature data:
 * - Default packages are reset to the canonical DEFAULT_PACKAGES config.
 * - Any package (custom too) gets unknown keys dropped and legacy aliases
 *   (e.g. whatsapp_broadcasts -> whatsapp_broadcast) merged, so the canonical
 *   feature set is always explicit and feature gating works correctly.
 * Guarded by an admin_config marker so it only runs once and later admin
 * edits are never clobbered on restart.
 */
async function migratePackageFeatures(): Promise<void> {
  const marker = await getConfig('package_features_migration')
  if (marker === 'v1') return

  const defaultsBySlug = new Map(DEFAULT_PACKAGES.map((p) => [p.slug, p.features]))
  const rows = await getDb().select().from(packages)
  let updated = 0

  for (const row of rows) {
    const raw = (row.features ?? {}) as Record<string, unknown>
    let normalized: Record<string, boolean>

    if (defaultsBySlug.has(row.slug)) {
      normalized = { ...defaultsBySlug.get(row.slug)! }
    } else {
      const merged: Record<string, unknown> = { ...raw }
      for (const [legacy, canonical] of Object.entries(LEGACY_FEATURE_MAP)) {
        if (legacy in merged) {
          merged[canonical] = merged[legacy]
          delete merged[legacy]
        }
      }
      normalized = Object.fromEntries(CANONICAL_FEATURE_KEYS.map((k) => [k, merged[k] === true]))
    }

    const needsUpdate =
      JSON.stringify(raw) !== JSON.stringify(normalized) ||
      Object.keys(raw).length !== Object.keys(normalized).length

    if (needsUpdate) {
      await getDb().update(packages).set({
        features: normalized as unknown as Record<string, unknown>,
        updatedAt: new Date().toISOString(),
      }).where(eq(packages.id, row.id))
      updated++
    }
  }

  if (updated > 0) {
    logger.info({ updated }, 'migrated package features to canonical keys')
  }
  await setConfig('package_features_migration', 'v1')
}

// ---- AI Provider Seeding (from env vars) ----

async function seedDefaultAIProviders(): Promise<void> {
  const existing = await getDb().select().from(aiProviders).limit(1)
  if (existing.length > 0) return

  const now = new Date().toISOString()
  const defaults: AIProviderInput[] = []

  // Groq STT
  const groqKey = process.env.GROQ_API_KEY || ''
  if (groqKey) {
    defaults.push({
      category: 'stt',
      provider: 'groq',
      displayName: 'Groq Whisper',
      apiKey: groqKey,
      baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      model: process.env.GROQ_MODEL || 'whisper-large-v3',
      config: {},
      isActive: true,
      isDefault: true,
    })
  }

  // DeepSeek LLM
  const llmKey = process.env.LLM_API_KEY || ''
  const llmBase = process.env.LLM_BASE_URL || 'https://api.deepseek.com'
  const llmModel = process.env.LLM_MODEL || 'deepseek-chat'
  if (llmKey) {
    const providerName = llmBase.includes('deepseek') ? 'deepseek'
      : llmBase.includes('mistral') ? 'mistral'
      : llmBase.includes('openai') ? 'openai'
      : llmBase.includes('anthropic') ? 'anthropic'
      : 'custom'
    defaults.push({
      category: 'llm',
      provider: providerName,
      displayName: providerName.charAt(0).toUpperCase() + providerName.slice(1),
      apiKey: llmKey,
      baseUrl: llmBase,
      model: llmModel,
      config: {},
      isActive: true,
      isDefault: true,
    })
  }

  // OpenAI Image
  const openaiKey = process.env.OPENAI_API_KEY || ''
  if (openaiKey) {
    defaults.push({
      category: 'image',
      provider: 'openai',
      displayName: 'OpenAI GPT Image',
      apiKey: openaiKey,
      baseUrl: 'https://api.openai.com/v1',
      model: process.env.IMAGE_MODEL || 'gpt-image-1-mini',
      config: {},
      isActive: true,
      isDefault: true,
    })
  }

  for (const d of defaults) {
    await getDb().insert(aiProviders).values({
      id: randomUUID(),
      category: d.category,
      provider: d.provider,
      displayName: d.displayName,
      apiKey: d.apiKey,
      baseUrl: d.baseUrl,
      model: d.model,
      config: d.config as Record<string, unknown>,
      isActive: d.isActive,
      isDefault: d.isDefault,
      createdAt: now,
      updatedAt: now,
    })
  }

  if (defaults.length > 0) {
    logger.info({ count: defaults.length }, 'seeded default AI providers from env vars')
  }
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
  await pool.query('DELETE FROM ai_usage_logs')
  await pool.query('DELETE FROM ai_provider_costs')
  await pool.query('DELETE FROM ai_providers')
  await pool.query('DELETE FROM meta_config')
  await pool.query('DELETE FROM support_tickets')
  await pool.query('DELETE FROM webhook_events')
  await pool.query('DELETE FROM scheduled_posts')
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

// ---- Ad Campaign CRUD ----

function adCampaignFromRow(row: typeof adCampaigns.$inferSelect): AdCampaign {
  return {
    id: row.id,
    phone: row.phone,
    postId: row.postId || undefined,
    name: row.name,
    objective: row.objective,
    status: row.status as AdCampaign['status'],
    adContent: row.adContent as AdCampaign['adContent'],
    targeting: row.targeting as AdCampaign['targeting'],
    budgetCents: row.budgetCents,
    campaignId: row.campaignId || undefined,
    adSetId: row.adSetId || undefined,
    adId: row.adId || undefined,
    imageUrl: row.imageUrl || undefined,
    publishAt: row.publishAt || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function createAdCampaign(data: {
  phone: string
  postId?: string
  name: string
  objective: string
  adContent: AdCampaign['adContent']
  targeting: AdCampaign['targeting']
  budgetCents: number
  imageUrl?: string
  publishAt?: string
}): Promise<AdCampaign> {
  const now = new Date().toISOString()
  const campaign: AdCampaign = {
    id: randomUUID(),
    phone: data.phone,
    postId: data.postId,
    name: data.name,
    objective: data.objective,
    status: data.publishAt ? 'scheduled' : 'pending',
    adContent: data.adContent,
    targeting: data.targeting,
    budgetCents: data.budgetCents,
    imageUrl: data.imageUrl,
    publishAt: data.publishAt,
    createdAt: now,
    updatedAt: now,
  }
  await getDb().insert(adCampaigns).values({
    id: campaign.id,
    phone: campaign.phone,
    postId: campaign.postId || null,
    name: campaign.name,
    objective: campaign.objective,
    status: campaign.status,
    adContent: campaign.adContent as unknown as Record<string, unknown>,
    targeting: campaign.targeting as unknown as Record<string, unknown>,
    budgetCents: campaign.budgetCents,
    imageUrl: campaign.imageUrl || null,
    publishAt: campaign.publishAt || null,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  })
  return campaign
}

export async function getAdCampaign(id: string): Promise<AdCampaign | undefined> {
  const result = await getDb().select().from(adCampaigns).where(eq(adCampaigns.id, id)).limit(1)
  if (result.length === 0) return undefined
  return adCampaignFromRow(result[0])
}

export async function listAdCampaignsByPhone(phone: string): Promise<AdCampaign[]> {
  const result = await getDb().select().from(adCampaigns)
    .where(eq(adCampaigns.phone, phone))
    .orderBy(desc(adCampaigns.createdAt))
  return result.map(adCampaignFromRow)
}

export async function listAllAdCampaigns(limit = 5000): Promise<AdCampaign[]> {
  const result = await getDb().select().from(adCampaigns)
    .orderBy(desc(adCampaigns.createdAt))
    .limit(limit)
  return result.map(adCampaignFromRow)
}

export async function listScheduledAdCampaigns(phone: string): Promise<AdCampaign[]> {
  const userPhone = await resolveUserPhone(phone)
  const result = await getDb().select().from(adCampaigns)
    .where(and(
      eq(adCampaigns.phone, userPhone),
      sql`${adCampaigns.status} IN ('scheduled', 'creating')`,
    ))
    .orderBy(desc(adCampaigns.createdAt))
  return result.map(adCampaignFromRow)
}

export async function cancelScheduledAdCampaign(id: string, phone: string): Promise<boolean> {
  const userPhone = await resolveUserPhone(phone)
  const rows = await getDb().update(adCampaigns)
    .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
    .where(and(eq(adCampaigns.id, id), eq(adCampaigns.phone, userPhone), eq(adCampaigns.status, 'scheduled')))
    .returning()
  return rows.length > 0
}

export async function updateAdCampaign(id: string, patch: Partial<AdCampaign>): Promise<AdCampaign> {
  const existing = await getAdCampaign(id)
  if (!existing) throw new Error(`Ad campaign ${id} not found`)
  const updated: AdCampaign = { ...existing, ...patch, updatedAt: new Date().toISOString() }
  await getDb().update(adCampaigns).set({
    status: updated.status,
    campaignId: updated.campaignId || null,
    adSetId: updated.adSetId || null,
    adId: updated.adId || null,
    imageUrl: updated.imageUrl || null,
    publishAt: updated.publishAt || null,
    updatedAt: updated.updatedAt,
  }).where(eq(adCampaigns.id, id))
  return updated
}

// ---- AI Provider CRUD ----

function aiProviderFromRow(row: typeof aiProviders.$inferSelect): AIProvider {
  return {
    id: row.id,
    category: row.category as AIProviderCategory,
    provider: row.provider,
    displayName: row.displayName,
    apiKey: row.apiKey || '',
    baseUrl: row.baseUrl || '',
    model: row.model || '',
    config: (row.config ?? {}) as Record<string, unknown>,
    isActive: row.isActive,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function createAIProvider(data: AIProviderInput): Promise<AIProvider> {
  const now = new Date().toISOString()
  const id = randomUUID()
  await getDb().insert(aiProviders).values({
    id,
    category: data.category,
    provider: data.provider,
    displayName: data.displayName,
    apiKey: data.apiKey,
    baseUrl: data.baseUrl,
    model: data.model,
    config: data.config as Record<string, unknown>,
    isActive: data.isActive,
    isDefault: data.isDefault,
    createdAt: now,
    updatedAt: now,
  })
  return { id, ...data, createdAt: now, updatedAt: now }
}

export async function getAIProvider(id: string): Promise<AIProvider | undefined> {
  const result = await getDb().select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1)
  if (result.length === 0) return undefined
  return aiProviderFromRow(result[0])
}

export async function listAIProviders(category?: AIProviderCategory): Promise<AIProvider[]> {
  let query
  if (category) {
    query = getDb().select().from(aiProviders).where(eq(aiProviders.category, category))
  } else {
    query = getDb().select().from(aiProviders)
  }
  const result = await query.orderBy(aiProviders.category, aiProviders.displayName)
  return result.map(aiProviderFromRow)
}

export async function updateAIProvider(id: string, patch: Partial<AIProviderInput>): Promise<AIProvider> {
  const existing = await getAIProvider(id)
  if (!existing) throw new Error(`AI provider ${id} not found`)
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() }
  await getDb().update(aiProviders).set({
    category: updated.category,
    provider: updated.provider,
    displayName: updated.displayName,
    apiKey: updated.apiKey,
    baseUrl: updated.baseUrl,
    model: updated.model,
    config: updated.config as Record<string, unknown>,
    isActive: updated.isActive,
    isDefault: updated.isDefault,
    updatedAt: updated.updatedAt,
  }).where(eq(aiProviders.id, id))
  return updated
}

export async function deleteAIProvider(id: string): Promise<void> {
  await getDb().delete(aiProviders).where(eq(aiProviders.id, id))
}

export async function setActiveAIProvider(id: string, category: AIProviderCategory): Promise<void> {
  const provider = await getAIProvider(id)
  if (!provider) throw new Error(`AI provider ${id} not found`)
  await getDb().update(aiProviders).set({ isActive: false })
    .where(eq(aiProviders.category, category))
  await getDb().update(aiProviders).set({ isActive: true, updatedAt: new Date().toISOString() })
    .where(eq(aiProviders.id, id))
}

export async function getActiveAIProvider(category: AIProviderCategory): Promise<AIProvider | undefined> {
  const result = await getDb().select().from(aiProviders)
    .where(and(eq(aiProviders.category, category), eq(aiProviders.isActive, true)))
    .limit(1)
  if (result.length === 0) return undefined
  return aiProviderFromRow(result[0])
}

// ---- AI Usage Logs ----

function aiUsageLogFromRow(row: typeof aiUsageLogs.$inferSelect): AIUsageLog {
  return {
    id: row.id,
    phone: row.phone || '',
    providerId: row.providerId,
    category: row.category as AIProviderCategory,
    model: row.model || '',
    feature: row.feature || '',
    tokensInput: row.tokensInput,
    tokensOutput: row.tokensOutput,
    estimatedCostCents: row.estimatedCostCents,
    durationMs: row.durationMs,
    success: row.success,
    error: row.error || '',
    createdAt: row.createdAt,
  }
}

export async function logAIUsage(data: Omit<AIUsageLog, 'id' | 'createdAt'>): Promise<AIUsageLog> {
  const now = new Date().toISOString()
  const id = randomUUID()
  await getDb().insert(aiUsageLogs).values({
    id,
    phone: data.phone || null,
    providerId: data.providerId,
    category: data.category,
    model: data.model || null,
    feature: data.feature || null,
    tokensInput: data.tokensInput,
    tokensOutput: data.tokensOutput,
    estimatedCostCents: data.estimatedCostCents,
    durationMs: data.durationMs,
    success: data.success,
    error: data.error || null,
    createdAt: now,
  })
  return { id, ...data, createdAt: now }
}

export async function getAIUsageStats(opts: { from?: string; to?: string; category?: AIProviderCategory; providerId?: string } = {}): Promise<{
  totalRequests: number
  totalTokensInput: number
  totalTokensOutput: number
  totalCostCents: number
  byCategory: Record<string, { requests: number; costCents: number }>
  byProvider: Record<string, { requests: number; costCents: number }>
}> {
  const conditions = []
  if (opts.from) conditions.push(sql`${aiUsageLogs.createdAt} >= ${opts.from}`)
  if (opts.to) conditions.push(sql`${aiUsageLogs.createdAt} <= ${opts.to}`)
  if (opts.category) conditions.push(eq(aiUsageLogs.category, opts.category))
  if (opts.providerId) conditions.push(eq(aiUsageLogs.providerId, opts.providerId))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const result = await getDb().select().from(aiUsageLogs).where(where)

  const byCategory: Record<string, { requests: number; costCents: number }> = {}
  const byProvider: Record<string, { requests: number; costCents: number }> = {}

  let totalRequests = 0
  let totalTokensInput = 0
  let totalTokensOutput = 0
  let totalCostCents = 0

  for (const row of result) {
    totalRequests++
    totalTokensInput += row.tokensInput
    totalTokensOutput += row.tokensOutput
    totalCostCents += row.estimatedCostCents

    if (!byCategory[row.category]) byCategory[row.category] = { requests: 0, costCents: 0 }
    byCategory[row.category].requests++
    byCategory[row.category].costCents += row.estimatedCostCents

    if (!byProvider[row.providerId]) byProvider[row.providerId] = { requests: 0, costCents: 0 }
    byProvider[row.providerId].requests++
    byProvider[row.providerId].costCents += row.estimatedCostCents
  }

  return { totalRequests, totalTokensInput, totalTokensOutput, totalCostCents, byCategory, byProvider }
}

export async function listAIUsageLogs(opts: { limit?: number; offset?: number; phone?: string; providerId?: string; category?: AIProviderCategory } = {}): Promise<AIUsageLog[]> {
  const conditions = []
  if (opts.phone) conditions.push(eq(aiUsageLogs.phone, opts.phone))
  if (opts.providerId) conditions.push(eq(aiUsageLogs.providerId, opts.providerId))
  if (opts.category) conditions.push(eq(aiUsageLogs.category, opts.category))

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const limit = opts.limit || 50
  const offset = opts.offset || 0

  const result = await getDb().select().from(aiUsageLogs)
    .where(where)
    .orderBy(desc(aiUsageLogs.createdAt))
    .limit(limit)
    .offset(offset)

  return result.map(aiUsageLogFromRow)
}

// ---- AI Cost Config ----

function aiCostFromRow(row: typeof aiProviderCosts.$inferSelect): AICostConfig {
  return {
    id: row.id,
    provider: row.provider,
    category: row.category as AIProviderCategory,
    costPer1MInputTokens: row.costPer1MInputTokens,
    costPer1MOutputTokens: row.costPer1MOutputTokens,
    costPerImage: row.costPerImage,
    costPerAudioMinute: row.costPerAudioMinute,
    updatedAt: row.updatedAt,
  }
}

export async function listAICosts(): Promise<AICostConfig[]> {
  const result = await getDb().select().from(aiProviderCosts).orderBy(aiProviderCosts.provider)
  return result.map(aiCostFromRow)
}

export async function upsertAICost(data: { provider: string; category: AIProviderCategory; costPer1MInputTokens?: number; costPer1MOutputTokens?: number; costPerImage?: number; costPerAudioMinute?: number }): Promise<AICostConfig> {
  const now = new Date().toISOString()
  const existing = await getDb().select().from(aiProviderCosts)
    .where(and(eq(aiProviderCosts.provider, data.provider), eq(aiProviderCosts.category, data.category)))
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]
    await getDb().update(aiProviderCosts).set({
      costPer1MInputTokens: data.costPer1MInputTokens ?? row.costPer1MInputTokens,
      costPer1MOutputTokens: data.costPer1MOutputTokens ?? row.costPer1MOutputTokens,
      costPerImage: data.costPerImage ?? row.costPerImage,
      costPerAudioMinute: data.costPerAudioMinute ?? row.costPerAudioMinute,
      updatedAt: now,
    }).where(eq(aiProviderCosts.id, row.id))
    return aiCostFromRow({ ...row, ...data, updatedAt: now })
  }

  const id = randomUUID()
  await getDb().insert(aiProviderCosts).values({
    id,
    provider: data.provider,
    category: data.category,
    costPer1MInputTokens: data.costPer1MInputTokens || 0,
    costPer1MOutputTokens: data.costPer1MOutputTokens || 0,
    costPerImage: data.costPerImage || 0,
    costPerAudioMinute: data.costPerAudioMinute || 0,
    updatedAt: now,
  })
  return { id, provider: data.provider, category: data.category, costPer1MInputTokens: data.costPer1MInputTokens || 0, costPer1MOutputTokens: data.costPer1MOutputTokens || 0, costPerImage: data.costPerImage || 0, costPerAudioMinute: data.costPerAudioMinute || 0, updatedAt: now }
}

export async function getAICost(provider: string, category: AIProviderCategory): Promise<AICostConfig | undefined> {
  const result = await getDb().select().from(aiProviderCosts)
    .where(and(eq(aiProviderCosts.provider, provider), eq(aiProviderCosts.category, category)))
    .limit(1)
  if (result.length === 0) return undefined
  return aiCostFromRow(result[0])
}

// ---- Meta Config ----

interface MetaConfigEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  isSensitive: boolean;
  updatedAt: string;
}

export async function getMetaConfig(category?: string): Promise<MetaConfigEntry[]> {
  let query
  if (category) {
    query = getDb().select().from(metaConfig).where(eq(metaConfig.category, category))
  } else {
    query = getDb().select().from(metaConfig)
  }
  const result = await query
  return result.map((r) => ({
    id: r.id,
    category: r.category,
    key: r.key,
    value: r.value || '',
    isSensitive: r.isSensitive,
    updatedAt: r.updatedAt,
  }))
}

export async function getMetaConfigValue(category: string, key: string): Promise<string | undefined> {
  const result = await getDb().select().from(metaConfig)
    .where(and(eq(metaConfig.category, category), eq(metaConfig.key, key)))
    .limit(1)
  if (result.length === 0) return undefined
  const value = result[0].value
  if (!value) return undefined
  if (result[0].isSensitive) {
    return decryptSecret(value)
  }
  return value
}

export async function setMetaConfig(category: string, key: string, value: string, isSensitive = false): Promise<void> {
  const now = new Date().toISOString()
  const stored = isSensitive && value ? await encryptSecret(value) : value

  const existing = await getDb().select().from(metaConfig)
    .where(and(eq(metaConfig.category, category), eq(metaConfig.key, key)))
    .limit(1)

  if (existing.length > 0) {
    await getDb().update(metaConfig).set({
      value: stored,
      isSensitive,
      updatedAt: now,
    }).where(eq(metaConfig.id, existing[0].id))
  } else {
    await getDb().insert(metaConfig).values({
      id: randomUUID(),
      category,
      key,
      value: stored,
      isSensitive,
      updatedAt: now,
    })
  }
}

export async function deleteMetaConfig(category: string, key: string): Promise<void> {
  await getDb().delete(metaConfig)
    .where(and(eq(metaConfig.category, category), eq(metaConfig.key, key)))
}

export async function getAllMetaConfig(): Promise<Record<string, Record<string, string>>> {
  const result = await getDb().select().from(metaConfig)
  const grouped: Record<string, Record<string, string>> = {}
  for (const row of result) {
    if (!grouped[row.category]) grouped[row.category] = {}
    const value = row.value || ''
    grouped[row.category][row.key] = row.isSensitive ? await decryptSecret(value) : value
  }
  return grouped
}

export async function migrateMetaConfigFromEnv(): Promise<void> {
  const existing = await getMetaConfig()
  if (existing.length > 0) return

  const now = new Date().toISOString()
  const migrations: Array<{ category: string; key: string; value: string; isSensitive: boolean }> = []

  // General
  if (process.env.FACEBOOK_APP_ID) migrations.push({ category: 'general', key: 'app_id', value: process.env.FACEBOOK_APP_ID, isSensitive: false })
  if (process.env.FACEBOOK_APP_SECRET) migrations.push({ category: 'general', key: 'app_secret', value: process.env.FACEBOOK_APP_SECRET, isSensitive: true })
  if (process.env.GRAPH_API_VERSION) migrations.push({ category: 'general', key: 'graph_api_version', value: process.env.GRAPH_API_VERSION, isSensitive: false })
  if (process.env.META_APP_MODE) migrations.push({ category: 'general', key: 'app_mode', value: process.env.META_APP_MODE, isSensitive: false })

  // OAuth
  if (process.env.META_OAUTH_REDIRECT_URI) migrations.push({ category: 'oauth', key: 'redirect_uri', value: process.env.META_OAUTH_REDIRECT_URI, isSensitive: false })
  if (process.env.META_CALLBACK_URI) migrations.push({ category: 'oauth', key: 'default_callback_uri', value: process.env.META_CALLBACK_URI, isSensitive: false })

  // Webhook
  if (process.env.WHATSAPP_VERIFY_TOKEN) migrations.push({ category: 'webhook', key: 'verify_token', value: process.env.WHATSAPP_VERIFY_TOKEN, isSensitive: true })
  if (process.env.WHATSAPP_APP_SECRET) migrations.push({ category: 'webhook', key: 'webhook_secret', value: process.env.WHATSAPP_APP_SECRET, isSensitive: true })
  if (process.env.META_WEBHOOK_URL) migrations.push({ category: 'webhook', key: 'webhook_url', value: process.env.META_WEBHOOK_URL, isSensitive: false })

  // WhatsApp
  if (process.env.WHATSAPP_TOKEN) migrations.push({ category: 'whatsapp', key: 'access_token', value: process.env.WHATSAPP_TOKEN, isSensitive: true })
  if (process.env.WHATSAPP_PHONE_NUMBER_ID) migrations.push({ category: 'whatsapp', key: 'phone_number_id', value: process.env.WHATSAPP_PHONE_NUMBER_ID, isSensitive: false })
  if (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) migrations.push({ category: 'whatsapp', key: 'business_account_id', value: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID, isSensitive: false })

  // API Versions
  if (process.env.FACEBOOK_API_VERSION) migrations.push({ category: 'api_versions', key: 'facebook', value: process.env.FACEBOOK_API_VERSION, isSensitive: false })
  if (process.env.INSTAGRAM_API_VERSION) migrations.push({ category: 'api_versions', key: 'instagram', value: process.env.INSTAGRAM_API_VERSION, isSensitive: false })
  if (process.env.META_ADS_API_VERSION) migrations.push({ category: 'api_versions', key: 'meta_ads', value: process.env.META_ADS_API_VERSION, isSensitive: false })

  for (const m of migrations) {
    await getDb().insert(metaConfig).values({
      id: randomUUID(),
      category: m.category,
      key: m.key,
      value: m.isSensitive ? await encryptSecret(m.value) : m.value,
      isSensitive: m.isSensitive,
      updatedAt: now,
    })
  }

  if (migrations.length > 0) {
    logger.info({ count: migrations.length }, 'migrated meta_config from env vars')
  }
}

// ---- Support Tickets ----

function supportTicketFromRow(row: typeof supportTickets.$inferSelect) {
  return {
    id: row.id,
    phone: row.phone,
    subject: row.subject,
    message: row.message,
    status: row.status,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function createSupportTicket(data: {
  phone: string
  subject: string
  message: string
  priority?: string
}) {
  const now = new Date().toISOString()
  const id = randomUUID()
  await getDb().insert(supportTickets).values({
    id,
    phone: data.phone,
    subject: data.subject,
    message: data.message,
    status: 'open',
    priority: data.priority || 'normal',
    createdAt: now,
    updatedAt: now,
  })
  return { id, ...data, status: 'open', createdAt: now, updatedAt: now }
}

export async function getSupportTickets(phone: string) {
  const result = await getDb().select().from(supportTickets)
    .where(eq(supportTickets.phone, phone))
    .orderBy(desc(supportTickets.createdAt))
  return result.map(supportTicketFromRow)
}

export async function getAllSupportTickets() {
  const result = await getDb().select().from(supportTickets)
    .orderBy(desc(supportTickets.createdAt))
  return result.map(supportTicketFromRow)
}

export async function updateSupportTicket(id: string, patch: { status?: string; priority?: string }) {
  const now = new Date().toISOString()
  await getDb().update(supportTickets).set({ ...patch, updatedAt: now }).where(eq(supportTickets.id, id))
}

export async function getSupportTicket(id: string) {
  const result = await getDb().select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1)
  return result.length > 0 ? supportTicketFromRow(result[0]) : undefined
}

export async function createSupportReply(data: { ticketId: string; role: 'admin' | 'user'; body: string }) {
  const now = new Date().toISOString()
  const id = randomUUID()
  await getDb().insert(supportReplies).values({
    id,
    ticketId: data.ticketId,
    role: data.role,
    body: data.body,
    createdAt: now,
  })
  await getDb().update(supportTickets).set({ updatedAt: now }).where(eq(supportTickets.id, data.ticketId))
  return { id, ticketId: data.ticketId, role: data.role, body: data.body, createdAt: now }
}

export async function getSupportReplies(ticketId: string) {
  const result = await getDb().select().from(supportReplies)
    .where(eq(supportReplies.ticketId, ticketId))
    .orderBy(asc(supportReplies.createdAt))
  return result.map((r) => ({
    id: r.id,
    role: r.role,
    body: r.body,
    createdAt: r.createdAt,
  }))
}

export async function listAllSupportReplies(ticketIds: string[]): Promise<Record<string, Array<{ id: string; role: string; body: string; createdAt: string }>>> {
  if (ticketIds.length === 0) return {}
  const result = await getDb().select().from(supportReplies)
    .where(inArray(supportReplies.ticketId, ticketIds))
    .orderBy(asc(supportReplies.createdAt))
  const byTicket: Record<string, Array<{ id: string; role: string; body: string; createdAt: string }>> = {}
  for (const r of result) {
    if (!byTicket[r.ticketId]) byTicket[r.ticketId] = []
    byTicket[r.ticketId].push({ id: r.id, role: r.role, body: r.body, createdAt: r.createdAt })
  }
  return byTicket
}

// ---- Audit Log Queries ----

export async function getRecentAuditLogs(limit = 50) {
  const result = await getDb().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit)
  return result.map((r) => ({
    id: r.id,
    actor: r.actor,
    actorType: r.actorType,
    action: r.action,
    target: r.target || '',
    targetType: r.targetType || '',
    details: r.details as Record<string, unknown>,
    ip: r.ip || '',
    createdAt: r.createdAt,
  }))
}

export async function getAuditLogsByActor(actor: string, limit = 50) {
  const result = await getDb().select().from(auditLogs)
    .where(eq(auditLogs.actor, actor))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
  return result.map((r) => ({
    id: r.id,
    actor: r.actor,
    actorType: r.actorType,
    action: r.action,
    target: r.target || '',
    targetType: r.targetType || '',
    details: r.details as Record<string, unknown>,
    ip: r.ip || '',
    createdAt: r.createdAt,
  }))
}

export { storageDir } from './storage.js'

