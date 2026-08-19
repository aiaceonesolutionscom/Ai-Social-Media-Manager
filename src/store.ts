import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { eq, desc, asc, and, sql, inArray } from 'drizzle-orm'
import { getDb, getPool } from './db.js'
import { posts, messages, conversations, postEdits, userPreferences, brandProfile, packages, topupBundles, users, tokenTransactions, socialAccounts, adminConfig, adminUsers, payments, userSessions, adCampaigns, aiProviders, aiUsageLogs, aiProviderCosts, aiProviderCostVersions, metaConfig, supportTickets, supportReplies, auditLogs, webhookEvents, scheduledPosts, notifications, errorLogs } from './db/schema.js'
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
    tokensCharged: (row.tokensCharged != null ? row.tokensCharged : (data.tokensCharged as number | undefined)) ?? undefined,
    tokensChargedAction: row.tokensChargedAction || (data.tokensChargedAction as string | undefined) || undefined,
    refundedAt: row.refundedAt || (data.refundedAt as string | undefined) || undefined,
    ...data,
  } as Post
}

function postToRow(post: Post) {
  const { id, phone, status, createdAt, updatedAt, tokensCharged, tokensChargedAction, refundedAt, ...rest } = post
  return {
    id,
    phone,
    stage: status ?? 'NEW',
    createdAt,
    updatedAt,
    tokensCharged: tokensCharged ?? 0,
    tokensChargedAction: tokensChargedAction ?? null,
    refundedAt: refundedAt ?? null,
    data: rest as Record<string, unknown>,
  }
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
      package_status TEXT NOT NULL DEFAULT 'none',
      package_started_at TEXT,
      package_expires_at TEXT,
      package_ended_at TEXT,
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
      tax_percent INTEGER,
      mdr_percent INTEGER,
      tax_amount INTEGER,
      mdr_amount INTEGER,
      type TEXT NOT NULL,
      stripe_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payments_phone ON payments(phone);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_stripe ON payments(stripe_session_id);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS tax_percent INTEGER;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS mdr_percent INTEGER;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS tax_amount INTEGER;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS mdr_amount INTEGER;

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
      budget_type TEXT NOT NULL DEFAULT 'daily',
      currency TEXT NOT NULL DEFAULT 'USD',
      start_date TEXT,
      end_date TEXT,
      campaign_id TEXT,
      ad_set_id TEXT,
      ad_id TEXT,
      creative_id TEXT,
      image_url TEXT,
      publish_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      charged_tokens INTEGER NOT NULL DEFAULT 0,
      charged_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_phone ON ad_campaigns(phone);
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status ON ad_campaigns(status);

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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS package_status TEXT NOT NULL DEFAULT 'none'`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS package_started_at TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS package_expires_at TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS package_ended_at TEXT`)
  await pool.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly'`)
  await pool.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS yearly_price_cents INTEGER NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS setup_type TEXT NOT NULL DEFAULT 'none'`)

  // Billing hardening: atomic charge-once columns
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS tokens_charged INTEGER NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS tokens_charged_action TEXT`)
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS refunded_at TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS charged_tokens INTEGER NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS charged_at TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS budget_type TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS currency TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS start_date TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS end_date TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS campaign_id TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS ad_set_id TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS ad_id TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS creative_id TEXT`)
  await pool.query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS image_url TEXT`)
  await pool.query(`ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS audio_seconds INTEGER NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0`)

  // Pricing versioning columns
  await pool.query(`ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS pricing_version_id TEXT`)
  await pool.query(`ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS unpriced BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE token_transactions ADD COLUMN IF NOT EXISTS operation_id TEXT`)

  // Idempotency claims: dedupe existing rows by operation_id, then enforce unique index
  await pool.query(`
    DELETE FROM token_transactions WHERE id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY operation_id ORDER BY created_at DESC) rn
                      FROM token_transactions WHERE operation_id IS NOT NULL) t WHERE rn > 1
    )
  `)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_token_tx_operation_id ON token_transactions(operation_id)`)

  // Stripe idempotency: dedupe existing rows, then enforce unique index
  await pool.query(`
    DELETE FROM payments WHERE id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY stripe_session_id ORDER BY created_at DESC) rn
                      FROM payments WHERE stripe_session_id IS NOT NULL) t WHERE rn > 1
    )
  `)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_unique ON payments(stripe_session_id) WHERE stripe_session_id IS NOT NULL`)

  // Pricing versioning: create table and seed from existing costs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_provider_cost_versions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      category TEXT NOT NULL,
      version INTEGER NOT NULL,
      input_rate INTEGER NOT NULL DEFAULT 0,
      output_rate INTEGER NOT NULL DEFAULT 0,
      cached_input_rate INTEGER NOT NULL DEFAULT 0,
      image_rate INTEGER NOT NULL DEFAULT 0,
      audio_rate INTEGER NOT NULL DEFAULT 0,
      effective_from TEXT NOT NULL,
      effective_until TEXT,
      source TEXT NOT NULL DEFAULT 'seed',
      last_verified_at TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_cost_versions_provider ON ai_provider_cost_versions(provider);
    CREATE INDEX IF NOT EXISTS idx_ai_cost_versions_active ON ai_provider_cost_versions(active);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_cost_versions_pcv ON ai_provider_cost_versions(provider, category, version);
    DROP INDEX IF EXISTS idx_ai_cost_versions_provider_category_active;
  `)
  // Pre-existing tables need the status column backfilled + the legacy active
  // flag normalized BEFORE the "one active version" index can be created.
  await pool.query(`ALTER TABLE ai_provider_cost_versions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_cost_versions_status ON ai_provider_cost_versions(status)`)
  await pool.query(`UPDATE ai_provider_cost_versions SET status = CASE WHEN active THEN 'approved' ELSE 'superseded' END WHERE status = 'pending' AND source <> 'admin'`)
  await pool.query(`
    UPDATE ai_provider_cost_versions SET active = false, status = 'superseded', effective_until = created_at
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY provider, category ORDER BY created_at DESC) rn
        FROM ai_provider_cost_versions WHERE active
      ) t WHERE rn > 1
    )
  `)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_cost_versions_one_active ON ai_provider_cost_versions(provider, category) WHERE active`)
  // Seed initial versions from existing ai_provider_costs (only if no versions exist yet)
  await syncAICostVersionsFromCosts()

  // Backfill pricing_version_id to the REAL version row uuid where a numeric
  // version value was stored, then enforce a guarded FK (non-fatal on failure).
  await pool.query(`
    UPDATE ai_usage_logs u
    SET pricing_version_id = v.id
    FROM ai_provider_cost_versions v
    WHERE u.pricing_version_id IS NOT NULL
      AND u.pricing_version_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND v.provider = u.provider_id
      AND v.category = u.category
      AND v.version::text = u.pricing_version_id
  `)
  await pool.query(`
    UPDATE ai_usage_logs SET pricing_version_id = NULL
    WHERE pricing_version_id IS NOT NULL
      AND pricing_version_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  `)
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE ai_usage_logs ADD CONSTRAINT fk_ai_usage_pricing_version
        FOREIGN KEY (pricing_version_id) REFERENCES ai_provider_cost_versions(id);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // Backfill: users that already own a package (bought before the lifecycle feature) get
  // an active status and a fresh expiry based on the package billing period.
  await pool.query(`
    UPDATE users u
    SET package_status = 'active',
        package_started_at = NOW(),
        package_expires_at = NOW() + CASE p.billing_period WHEN 'yearly' THEN INTERVAL '365 days' ELSE INTERVAL '31 days' END
    FROM packages p
    WHERE u.package_id = p.slug AND u.package_status = 'none'
  `)
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL DEFAULT 'admin',
      target_phone TEXT,
      category TEXT NOT NULL DEFAULT 'system',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_type, target_phone);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'app',
      message TEXT NOT NULL,
      stack TEXT,
      details JSONB NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_error_logs_source ON error_logs(source);
  `)
  await pool.query(`ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS resolved_at TEXT`)
  await pool.query(`ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS last_seen_at TEXT`)
  await pool.query(`UPDATE error_logs SET last_seen_at = created_at WHERE last_seen_at IS NULL`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(resolved)`)

  await seedDefaultPackages()
  await seedDefaultTopUpBundles()
  await migratePackageFeatures()

  await seedDefaultAIProviders()
  await seedDefaultAICosts()
  // Ensure every seeded/legacy cost row has an active v1 pricing version.
  await syncAICostVersionsFromCosts()
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
    tokensCharged: row.tokensCharged ?? 0,
    tokensChargedAction: row.tokensChargedAction ?? null,
    refundedAt: row.refundedAt ?? null,
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
    const prefs = result[0].data as UserPreferences
    return {
      ...prefs,
      brandingEnabled: prefs.brandingEnabled ?? true,
    }
  } catch {
    return { brandingEnabled: true }
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
    packageStatus: (row.packageStatus as User['packageStatus']) || 'none',
    packageStartedAt: row.packageStartedAt || '',
    packageExpiresAt: row.packageExpiresAt || '',
    packageEndedAt: row.packageEndedAt || '',
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

export async function createUser(data: { phone: string; name?: string; email?: string; packageId?: string; packageStatus?: User['packageStatus']; packageStartedAt?: string; packageExpiresAt?: string; tokensRemaining?: number; stripeCustomerId?: string; passwordHash?: string; oauthProvider?: string; oauthId?: string; avatarUrl?: string }): Promise<User> {
  const now = new Date().toISOString()
  const user: User = {
    phone: data.phone,
    name: data.name || '',
    email: data.email || '',
    role: 'user',
    active: 1,
    packageId: data.packageId || '',
    packageStatus: data.packageStatus || 'none',
    packageStartedAt: data.packageStartedAt || '',
    packageExpiresAt: data.packageExpiresAt || '',
    packageEndedAt: '',
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
    packageStatus: user.packageStatus,
    packageStartedAt: user.packageStartedAt || null,
    packageExpiresAt: user.packageExpiresAt || null,
    packageEndedAt: user.packageEndedAt || null,
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
    packageStatus: updated.packageStatus,
    packageStartedAt: updated.packageStartedAt || null,
    packageExpiresAt: updated.packageExpiresAt || null,
    packageEndedAt: updated.packageEndedAt || null,
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

export async function updateSocialAccount(id: string, patch: Partial<{ accessToken: string; refreshToken: string; tokenExpiresAt: string; status: 'active' | 'expired' | 'disconnected' }>): Promise<void> {
  const updateData: Record<string, unknown> = {}
  if (patch.accessToken !== undefined) updateData.accessToken = await import('./lib/crypto.js').then(m => m.encryptSecret(patch.accessToken!))
  if (patch.refreshToken !== undefined) updateData.refreshToken = await import('./lib/crypto.js').then(m => m.encryptSecret(patch.refreshToken!))
  if (patch.tokenExpiresAt !== undefined) updateData.tokenExpiresAt = patch.tokenExpiresAt
  if (patch.status !== undefined) updateData.status = patch.status
  if (Object.keys(updateData).length > 0) {
    await getDb().update(socialAccounts).set(updateData).where(eq(socialAccounts.id, id))
  }
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
    taxPercent: row.taxPercent ?? 0,
    mdrPercent: row.mdrPercent ?? 0,
    taxAmount: row.taxAmount ?? 0,
    mdrAmount: row.mdrAmount ?? 0,
    type: row.type as 'subscription' | 'one_time' | 'token_purchase' | 'topup',
    stripeSessionId: row.stripeSessionId || '',
    status: row.status as 'pending' | 'completed' | 'failed' | 'refunded',
    createdAt: row.createdAt,
  }
}

export async function createPayment(data: { phone: string; packageId?: string | null; tokenCount: number; amountCents: number; type: 'subscription' | 'one_time' | 'token_purchase' | 'topup'; stripeSessionId?: string; taxPercent?: number; mdrPercent?: number; taxAmount?: number; mdrAmount?: number }): Promise<Payment> {
  const payment: Payment = {
    id: randomUUID(),
    phone: data.phone,
    packageId: data.packageId || '',
    tokenCount: data.tokenCount,
    amountCents: data.amountCents,
    taxPercent: data.taxPercent ?? 0,
    mdrPercent: data.mdrPercent ?? 0,
    taxAmount: data.taxAmount ?? 0,
    mdrAmount: data.mdrAmount ?? 0,
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
    taxPercent: payment.taxPercent,
    mdrPercent: payment.mdrPercent,
    taxAmount: payment.taxAmount,
    mdrAmount: payment.mdrAmount,
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

/**
 * Atomically claims a pending payment by id, transitioning it to 'processing'.
 * Returns the claimed payment, or undefined if no pending payment exists.
 */
export async function claimPayment(id: string): Promise<Payment | undefined> {
  const result = await getDb()
    .update(payments)
    .set({ status: 'processing' })
    .where(sql`${payments.id} = ${id} AND ${payments.status} = 'pending'`)
    .returning()
  if (result.length === 0) return undefined
  return paymentFromRow(result[0])
}

/**
 * Atomically claims a pending payment by stripe_session_id, transitioning it to
 * 'processing'. Returns the claimed payment, or undefined if no pending payment
 * exists for that session (already completed, already being processed, or not found).
 * This is the single idempotency gate for concurrent webhook deliveries.
 */
export async function claimPaymentByStripeSession(sessionId: string): Promise<Payment | undefined> {
  const result = await getDb()
    .update(payments)
    .set({ status: 'processing' })
    .where(sql`${payments.stripeSessionId} = ${sessionId} AND ${payments.status} = 'pending'`)
    .returning()
  if (result.length === 0) return undefined
  return paymentFromRow(result[0])
}

/** Marks a claimed (processing) payment as completed. */
export async function completePayment(id: string): Promise<Payment> {
  const result = await getDb()
    .update(payments)
    .set({ status: 'completed' })
    .where(eq(payments.id, id))
    .returning()
  if (result.length === 0) throw new Error(`Payment ${id} not found`)
  return paymentFromRow(result[0])
}

/** Marks a claimed (processing) payment as failed. */
export async function failPayment(id: string): Promise<Payment> {
  const result = await getDb()
    .update(payments)
    .set({ status: 'failed' })
    .where(eq(payments.id, id))
    .returning()
  if (result.length === 0) throw new Error(`Payment ${id} not found`)
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
    taxPercent: updated.taxPercent,
    mdrPercent: updated.mdrPercent,
    taxAmount: updated.taxAmount,
    mdrAmount: updated.mdrAmount,
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

// ---- Notifications ----

export interface AppNotification {
  id: string
  targetType: 'admin' | 'user'
  targetPhone?: string
  category: string
  title: string
  body: string
  data: Record<string, unknown>
  isRead: boolean
  createdAt: string
}

function notificationFromRow(row: typeof notifications.$inferSelect): AppNotification {
  return {
    id: row.id,
    targetType: row.targetType as 'admin' | 'user',
    targetPhone: row.targetPhone || undefined,
    category: row.category,
    title: row.title,
    body: row.body,
    data: (row.data ?? {}) as Record<string, unknown>,
    isRead: row.isRead,
    createdAt: row.createdAt,
  }
}

export async function createNotification(input: {
  targetType: 'admin' | 'user'
  targetPhone?: string
  category: string
  title: string
  body: string
  data?: Record<string, unknown>
}): Promise<AppNotification> {
  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    targetType: input.targetType,
    targetPhone: input.targetPhone || null,
    category: input.category,
    title: input.title,
    body: input.body,
    data: (input.data ?? {}) as Record<string, unknown>,
    isRead: false,
    createdAt: now,
  }
  await getDb().insert(notifications).values(row)
  return notificationFromRow(row as typeof notifications.$inferSelect)
}

export async function listNotifications(opts: {
  targetType?: 'admin' | 'user'
  targetPhone?: string
  unreadOnly?: boolean
  limit?: number
} = {}): Promise<AppNotification[]> {
  const limit = opts.limit ?? 50
  const conditions = []
  if (opts.targetType) conditions.push(eq(notifications.targetType, opts.targetType))
  if (opts.targetPhone) conditions.push(eq(notifications.targetPhone, await resolveUserPhone(opts.targetPhone)))
  if (opts.unreadOnly) conditions.push(eq(notifications.isRead, false))
  const q = getDb().select().from(notifications)
  if (conditions.length === 1) q.where(conditions[0])
  if (conditions.length > 1) q.where(and(...conditions))
  const result = await q.orderBy(desc(notifications.createdAt)).limit(limit)
  return result.map(notificationFromRow)
}

export async function countUnreadNotifications(opts: { targetType?: 'admin' | 'user'; targetPhone?: string } = {}): Promise<number> {
  const conditions = [eq(notifications.isRead, false)]
  if (opts.targetType) conditions.push(eq(notifications.targetType, opts.targetType))
  if (opts.targetPhone) conditions.push(eq(notifications.targetPhone, await resolveUserPhone(opts.targetPhone)))
  const result = await getDb().select({ count: sql<number>`count(*)::int` }).from(notifications)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
  return result[0]?.count ?? 0
}

export async function markNotificationRead(id: string, opts: { targetType?: 'admin' | 'user'; targetPhone?: string } = {}): Promise<boolean> {
  const conditions = [eq(notifications.id, id)]
  if (opts.targetType) conditions.push(eq(notifications.targetType, opts.targetType))
  if (opts.targetPhone) conditions.push(eq(notifications.targetPhone, await resolveUserPhone(opts.targetPhone)))
  const rows = await getDb().update(notifications)
    .set({ isRead: true })
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .returning()
  return rows.length > 0
}

export async function markAllNotificationsRead(opts: { targetType?: 'admin' | 'user'; targetPhone?: string } = {}): Promise<void> {
  const conditions = [eq(notifications.isRead, false)]
  if (opts.targetType) conditions.push(eq(notifications.targetType, opts.targetType))
  if (opts.targetPhone) conditions.push(eq(notifications.targetPhone, await resolveUserPhone(opts.targetPhone)))
  await getDb().update(notifications)
    .set({ isRead: true })
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
}

// ---- Error Logs ----

export interface ErrorLogRecord {
  id: string
  source: string
  message: string
  stack?: string
  details: Record<string, unknown>
  resolved: boolean
  resolvedAt?: string
  lastSeenAt: string
  createdAt: string
}

function errorLogFromRow(row: typeof errorLogs.$inferSelect): ErrorLogRecord {
  return {
    id: row.id,
    source: row.source,
    message: row.message,
    stack: row.stack || undefined,
    details: (row.details ?? {}) as Record<string, unknown>,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt || undefined,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  }
}

export async function createErrorLog(input: {
  source?: string
  message: string
  stack?: string
  details?: Record<string, unknown>
}): Promise<ErrorLogRecord> {
  const now = new Date().toISOString()
  const source = input.source || 'app'

  // Dedupe: if the same source+message exists, refresh lastSeenAt and keep it open
  const existing = await getDb().select({ id: errorLogs.id, resolved: errorLogs.resolved })
    .from(errorLogs)
    .where(and(eq(errorLogs.source, source), eq(errorLogs.message, input.message)))
    .limit(1)

  if (existing.length > 0) {
    const updated = await getDb().update(errorLogs)
      .set({ lastSeenAt: now })
      .where(eq(errorLogs.id, existing[0].id))
      .returning()
    return errorLogFromRow(updated[0])
  }

  const row = {
    id: randomUUID(),
    source,
    message: input.message,
    stack: input.stack || null,
    details: (input.details ?? {}) as Record<string, unknown>,
    resolved: false,
    resolvedAt: null,
    lastSeenAt: now,
    createdAt: now,
  }
  await getDb().insert(errorLogs).values(row)
  return errorLogFromRow(row as typeof errorLogs.$inferSelect)
}

export async function listErrorLogs(opts: { source?: string; resolved?: boolean; limit?: number; offset?: number } = {}): Promise<ErrorLogRecord[]> {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const conditions = []
  if (opts.source) conditions.push(eq(errorLogs.source, opts.source))
  if (opts.resolved !== undefined) conditions.push(eq(errorLogs.resolved, opts.resolved))
  const q = getDb().select().from(errorLogs)
  if (conditions.length === 1) q.where(conditions[0])
  if (conditions.length > 1) q.where(and(...conditions))
  const result = await q.orderBy(desc(errorLogs.createdAt)).limit(limit).offset(offset)
  return result.map(errorLogFromRow)
}

export async function countErrorLogs(opts: { resolved?: boolean } = {}): Promise<number> {
  const q = getDb().select({ count: sql<number>`count(*)::int` }).from(errorLogs)
  if (opts.resolved !== undefined) q.where(eq(errorLogs.resolved, opts.resolved))
  const result = await q
  return result[0]?.count ?? 0
}

export async function markErrorLogResolved(id: string, resolved: boolean): Promise<ErrorLogRecord | undefined> {
  const now = new Date().toISOString()
  const result = await getDb().update(errorLogs)
    .set({ resolved, resolvedAt: resolved ? now : null })
    .where(eq(errorLogs.id, id))
    .returning()
  return result.length > 0 ? errorLogFromRow(result[0]) : undefined
}

// Auto-resolve errors that have not recurred within the threshold (default 24h).
export async function autoResolveErrorLogs(thresholdMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMs).toISOString()
  const result = await getDb().update(errorLogs)
    .set({ resolved: true, resolvedAt: new Date().toISOString() })
    .where(and(eq(errorLogs.resolved, false), sql`${errorLogs.lastSeenAt} < ${cutoff}`))
    .returning({ id: errorLogs.id })
  return result.length
}

export async function clearErrorLogs(): Promise<void> {
  await getDb().delete(errorLogs)
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
  { name: 'Facebook Only', slug: 'facebook-only', description: 'Perfect for Facebook-only creators', priceCents: 500, includedTokens: 15, sortOrder: 0, billingPeriod: 'monthly', yearlyPriceCents: 0, setupType: 'none', features: { facebook_publishing: true, instagram_publishing: false, whatsapp_broadcast: false, web_chat: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: false, priority_support: false, ad_campaigns: true, custom_branding: false, image_generation: true } },
  { name: 'Starter', slug: 'starter', description: 'Get started with social media automation', priceCents: 1500, includedTokens: 100, sortOrder: 1, billingPeriod: 'monthly', yearlyPriceCents: 0, setupType: 'none', features: { facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: false, web_chat: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: false, ad_campaigns: true, custom_branding: false, image_generation: true } },
  { name: 'Pro', slug: 'pro', description: 'For professional content creators', priceCents: 2900, includedTokens: 1000, sortOrder: 2, billingPeriod: 'monthly', yearlyPriceCents: 0, setupType: 'none', features: { facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: true, web_chat: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true, ad_campaigns: true, custom_branding: true, image_generation: true } },
  { name: 'Exclusive', slug: 'exclusive', description: 'Full access to all features', priceCents: 9900, includedTokens: 3000, sortOrder: 3, billingPeriod: 'monthly', yearlyPriceCents: 0, setupType: 'none', features: { facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: true, web_chat: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true, ad_campaigns: true, custom_branding: true, image_generation: true } },
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
  'image_generation',
]

const LEGACY_FEATURE_MAP: Record<string, string> = {
  whatsapp_broadcasts: 'whatsapp_broadcast',
}

// Scheduling token costs
export const SCHEDULE_POST_COST = 1
export const SCHEDULE_AD_COST = 3
export const EDIT_SCHEDULED_COST = 1

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
  if (marker === 'v3') return

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
  await setConfig('package_features_migration', 'v3')
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

  // Image providers — seed whichever keys are present; only the provider
  // selected via IMAGE_PROVIDER becomes the active/default one.
  const imageProvider = (process.env.IMAGE_PROVIDER || 'openai')
  const imageModel = process.env.IMAGE_MODEL || 'gpt-image-1-mini'

  const openaiKey = process.env.OPENAI_API_KEY || ''
  if (openaiKey) {
    defaults.push({
      category: 'image',
      provider: 'openai',
      displayName: 'OpenAI GPT Image',
      apiKey: openaiKey,
      baseUrl: 'https://api.openai.com/v1',
      model: imageProvider === 'openai' ? imageModel : 'gpt-image-1-mini',
      config: {},
      isActive: imageProvider === 'openai',
      isDefault: imageProvider === 'openai',
    })
  }

  const geminiKey = process.env.GEMINI_API_KEY || ''
  if (geminiKey) {
    defaults.push({
      category: 'image',
      provider: 'gemini',
      displayName: 'Gemini',
      apiKey: geminiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-preview-image-generation',
      config: {},
      isActive: imageProvider === 'gemini',
      isDefault: imageProvider === 'gemini',
    })
  }

  const stabilityKey = process.env.STABILITY_API_KEY || ''
  if (stabilityKey) {
    defaults.push({
      category: 'image',
      provider: 'stability',
      displayName: 'Stability AI',
      apiKey: stabilityKey,
      baseUrl: 'https://api.stability.ai/v2beta',
      model: process.env.STABILITY_IMAGE_MODEL || 'stable-image-core',
      config: {},
      isActive: imageProvider === 'stability',
      isDefault: imageProvider === 'stability',
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

/**
 * Seeds approximate cost-per-token rates for common providers so the cost
 * dashboard shows real $ figures out-of-the-box.  Rates are in cents and
 * can be edited by the admin via the AI Providers → Cost Configuration UI.
 */
async function seedDefaultAICosts(): Promise<void> {
  const now = new Date().toISOString()
  const defaults: { provider: string; category: AIProviderCategory; costPer1MInputTokens: number; costPer1MOutputTokens: number; costPerImage: number; costPerAudioMinute: number }[] = [
    // LLM (cents per 1M tokens)
    { provider: 'deepseek',   category: 'llm', costPer1MInputTokens: 27,  costPer1MOutputTokens: 110,  costPerImage: 0, costPerAudioMinute: 0 },
    { provider: 'mistral',    category: 'llm', costPer1MInputTokens: 200, costPer1MOutputTokens: 600,  costPerImage: 0, costPerAudioMinute: 0 },
    { provider: 'openai',     category: 'llm', costPer1MInputTokens: 250, costPer1MOutputTokens: 1000, costPerImage: 0, costPerAudioMinute: 0 },
    { provider: 'anthropic',  category: 'llm', costPer1MInputTokens: 300, costPer1MOutputTokens: 1500, costPerImage: 0, costPerAudioMinute: 0 },
    // STT (cents per minute of audio)
    { provider: 'groq',       category: 'stt', costPer1MInputTokens: 0,   costPer1MOutputTokens: 0,    costPerImage: 0, costPerAudioMinute: 0 },
    { provider: 'openai-stt', category: 'stt', costPer1MInputTokens: 0,   costPer1MOutputTokens: 0,    costPerImage: 0, costPerAudioMinute: 1 },
    // Image (cents per image)
    { provider: 'openai',     category: 'image', costPer1MInputTokens: 0,  costPer1MOutputTokens: 0,   costPerImage: 1, costPerAudioMinute: 0 },
    { provider: 'gemini',     category: 'image', costPer1MInputTokens: 0,  costPer1MOutputTokens: 0,   costPerImage: 4,   costPerAudioMinute: 0 },
    { provider: 'stability',  category: 'image', costPer1MInputTokens: 0,  costPer1MOutputTokens: 0,   costPerImage: 4,   costPerAudioMinute: 0 },
  ]

  for (const d of defaults) {
    const existing = await getDb()
      .select({ id: aiProviderCosts.id })
      .from(aiProviderCosts)
      .where(and(eq(aiProviderCosts.provider, d.provider), eq(aiProviderCosts.category, d.category)))
      .limit(1)
    if (existing.length > 0) continue
    await getDb().insert(aiProviderCosts).values({
      id: randomUUID(),
      provider: d.provider,
      category: d.category,
      costPer1MInputTokens: d.costPer1MInputTokens,
      costPer1MOutputTokens: d.costPer1MOutputTokens,
      costPerImage: d.costPerImage,
      costPerAudioMinute: d.costPerAudioMinute,
      updatedAt: now,
    })
  }

  logger.info({ count: defaults.length }, 'seeded default AI cost rates')
}

async function syncAICostVersionsFromCosts(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    INSERT INTO ai_provider_cost_versions (id, provider, category, version, input_rate, output_rate, cached_input_rate, image_rate, audio_rate, effective_from, source, active, status, created_at, updated_at)
    SELECT
      c.id || '-v1' AS id,
      c.provider,
      c.category,
      1 AS version,
      c.cost_per_1m_input_tokens AS input_rate,
      c.cost_per_1m_output_tokens AS output_rate,
      0 AS cached_input_rate,
      c.cost_per_image AS image_rate,
      c.cost_per_audio_minute AS audio_rate,
      c.updated_at AS effective_from,
      'seed' AS source,
      true AS active,
      'approved' AS status,
      c.updated_at AS created_at,
      c.updated_at AS updated_at
    FROM ai_provider_costs c
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_provider_cost_versions v WHERE v.provider = c.provider AND v.category = c.category
    )
  `)
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
  await pool.query('DELETE FROM ai_provider_cost_versions')
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
      // Refund the publish charge if the post was charged but never published.
      // This prevents a double charge when the user re-approves after recovery.
      const chargedAction = post.tokensChargedAction as 'standard_post' | 'cross_platform' | undefined
      const chargedAmount = post.tokensCharged
      if (chargedAction && chargedAmount && chargedAmount > 0 && !post.refundedAt) {
        try {
          const { tokenEngine } = await import('./lib/TokenEngine.js')
          const userPhone = await resolveUserPhone(post.phone)
          await tokenEngine.refundPost(post.id, userPhone, `Refund after stuck-post recovery: ${post.id}`)
        } catch (err) {
          logger.warn({ postId: post.id, error: (err as Error).message }, 'failed to refund tokens during stuck-post recovery')
        }
      }
      const history = [
        ...(post.history ?? []),
        { stage: 'AWAITING_APPROVAL' as PostStage, at: new Date().toISOString(), note: 'recovered after restart' },
      ]
      await updatePost(post.id, {
        status: 'AWAITING_APPROVAL',
        history,
      })
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
    budgetType: (row.budgetType as AdCampaign['budgetType']) || 'daily',
    currency: row.currency || 'USD',
    startDate: row.startDate || undefined,
    endDate: row.endDate || undefined,
    campaignId: row.campaignId || undefined,
    adSetId: row.adSetId || undefined,
    adId: row.adId || undefined,
    creativeId: row.creativeId || undefined,
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
  budgetType: 'daily' | 'total'
  currency: string
  startDate?: string
  endDate?: string
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
    budgetType: data.budgetType,
    currency: data.currency,
    startDate: data.startDate,
    endDate: data.endDate,
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
    budgetType: campaign.budgetType,
    currency: campaign.currency,
    startDate: campaign.startDate || null,
    endDate: campaign.endDate || null,
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

export async function getAdCampaignByPhone(id: string, phone: string): Promise<AdCampaign | undefined> {
  const userPhone = await resolveUserPhone(phone)
  const result = await getDb().select().from(adCampaigns)
    .where(and(eq(adCampaigns.id, id), eq(adCampaigns.phone, userPhone)))
    .limit(1)
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
    .orderBy(
      sql`${adCampaigns.publishAt} IS NULL ASC`,
      asc(adCampaigns.publishAt),
    )
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

export async function cancelAdCampaign(id: string, phone: string): Promise<boolean> {
  const userPhone = await resolveUserPhone(phone)
  const current = await getDb().select({ status: adCampaigns.status })
    .from(adCampaigns).where(and(eq(adCampaigns.id, id), eq(adCampaigns.phone, userPhone))).limit(1)
  if (current.length === 0) return false
  const status = current[0].status
  const allowed = ['scheduled', 'creating', 'paused', 'active']
  if (!status || !allowed.includes(status)) return false
  const rows = await getDb().update(adCampaigns)
    .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
    .where(and(eq(adCampaigns.id, id), eq(adCampaigns.phone, userPhone), eq(adCampaigns.status, status)))
    .returning()
  return rows.length > 0
}

export type AdCampaignAction = 'pause' | 'resume' | 'stop'
export async function mutateAdCampaignStatus(id: string, phone: string, action: AdCampaignAction): Promise<boolean> {
  const userPhone = await resolveUserPhone(phone)
  const current = await getDb().select({ status: adCampaigns.status })
    .from(adCampaigns).where(and(eq(adCampaigns.id, id), eq(adCampaigns.phone, userPhone))).limit(1)
  if (current.length === 0) return false
  const status = current[0].status
  let next: AdCampaign['status'] | null = null
  if (action === 'pause' && status === 'active') next = 'paused'
  if (action === 'resume' && status === 'paused') next = 'active'
  if (action === 'stop' && (status === 'active' || status === 'paused')) next = 'stopped'
  if (!next) return false
  const rows = await getDb().update(adCampaigns)
    .set({ status: next, updatedAt: new Date().toISOString() })
    .where(and(eq(adCampaigns.id, id), eq(adCampaigns.phone, userPhone), eq(adCampaigns.status, status)))
    .returning()
  return rows.length > 0
}

export async function updateAdCampaign(
  id: string,
  patch: Partial<AdCampaign>,
  options?: { phone?: string },
): Promise<AdCampaign> {
  const existing = options?.phone
    ? await getAdCampaignByPhone(id, options.phone)
    : await getAdCampaign(id)
  if (!existing) throw new Error(`Ad campaign ${id} not found`)
  const updated: AdCampaign = { ...existing, ...patch, updatedAt: new Date().toISOString() }
  const patchObj: Record<string, unknown> = {
    name: updated.name,
    objective: updated.objective,
    status: updated.status,
    adContent: updated.adContent as unknown as Record<string, unknown>,
    targeting: updated.targeting as unknown as Record<string, unknown>,
    budgetCents: updated.budgetCents,
    budgetType: updated.budgetType,
    currency: updated.currency,
    startDate: updated.startDate || null,
    endDate: updated.endDate || null,
    campaignId: updated.campaignId || null,
    adSetId: updated.adSetId || null,
    adId: updated.adId || null,
    creativeId: updated.creativeId || null,
    imageUrl: updated.imageUrl || null,
    publishAt: updated.publishAt || null,
    updatedAt: updated.updatedAt,
  }
  const where = options?.phone
    ? and(eq(adCampaigns.id, id), eq(adCampaigns.phone, await resolveUserPhone(options.phone)))
    : eq(adCampaigns.id, id)
  await getDb().update(adCampaigns).set(patchObj).where(where as any)
  return updated
}

export async function setAdCampaignStatus(id: string, phone: string, status: AdCampaign['status']): Promise<boolean> {
  const userPhone = await resolveUserPhone(phone)
  const rows = await getDb().update(adCampaigns)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(and(eq(adCampaigns.id, id), eq(adCampaigns.phone, userPhone)))
    .returning()
  return rows.length > 0
}

// ---- AI Provider CRUD ----

async function aiProviderFromRow(row: typeof aiProviders.$inferSelect): Promise<AIProvider> {
  const apiKey = row.apiKey ? await decryptSecret(row.apiKey) : ''
  return {
    id: row.id,
    category: row.category as AIProviderCategory,
    provider: row.provider,
    displayName: row.displayName,
    apiKey,
    baseUrl: row.baseUrl || '',
    model: row.model || '',
    config: (row.config ?? {}) as Record<string, unknown>,
    isActive: row.isActive,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function validateProviderConnection(provider: string, category: AIProviderCategory, apiKey: string, baseUrl: string, model: string): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  if (!apiKey) {
    return { ok: false, message: 'No API key configured', latencyMs: 0 }
  }
  try {
    const { groqSTT } = await import('./lib/ai/providers/groq.js')
    const { openaiSTT } = await import('./lib/ai/providers/openai-stt.js')
    const { deepseekLLM } = await import('./lib/ai/providers/deepseek.js')
    const { mistralLLM } = await import('./lib/ai/providers/mistral.js')
    const { openaiLLM } = await import('./lib/ai/providers/openai-llm.js')
    const { anthropicLLM } = await import('./lib/ai/providers/anthropic.js')
    const { openaiImage } = await import('./lib/ai/providers/openai-image.js')
    const { geminiImage } = await import('./lib/ai/providers/gemini.js')
    const { stabilityImage } = await import('./lib/ai/providers/stability.js')

    const adapters: Record<string, any> = {
      groq: groqSTT, 'openai-stt': openaiSTT,
      'groq-whisper': groqSTT, 'openai-whisper': openaiSTT,
      deepseek: deepseekLLM, mistral: mistralLLM, openai: openaiLLM, anthropic: anthropicLLM,
      'openai-image': openaiImage, 'gpt-image': openaiImage, gemini: geminiImage, stability: stabilityImage, 'stability-ai': stabilityImage,
    }

    const adapterKey = category === 'image' && provider === 'openai' ? 'openai-image' : provider
    const adapter = adapters[adapterKey]
    if (!adapter) {
      return { ok: false, message: `No adapter for provider: ${provider}`, latencyMs: 0 }
    }

    return await adapter.testConnection(apiKey, baseUrl, model)
  } catch (err) {
    return { ok: false, message: `Validation error: ${(err as Error).message}`, latencyMs: 0 }
  }
}

export async function createAIProvider(data: AIProviderInput, validate = true): Promise<AIProvider> {
  if (validate && data.apiKey) {
    const validation = await validateProviderConnection(data.provider, data.category, data.apiKey, data.baseUrl, data.model)
    if (!validation.ok) {
      throw new Error(`Validation failed: ${validation.message}`)
    }
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  const encryptedKey = await encryptSecret(data.apiKey || '')
  await getDb().insert(aiProviders).values({
    id,
    category: data.category,
    provider: data.provider,
    displayName: data.displayName,
    apiKey: encryptedKey,
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
  const rows: AIProvider[] = []
  for (const row of result) {
    rows.push(await aiProviderFromRow(row))
  }
  return rows
}

export async function updateAIProvider(id: string, patch: Partial<AIProviderInput>, validate = true): Promise<AIProvider> {
  const existing = await getAIProvider(id)
  if (!existing) throw new Error(`AI provider ${id} not found`)

  // Masked input (bullets) means the admin did not change the secret — keep the existing key.
  const isMasked = patch.apiKey !== undefined && patch.apiKey.includes('••')
  const apiKeyToStore = isMasked ? existing.apiKey : (patch.apiKey ?? existing.apiKey)

  const updated = { ...existing, ...patch, apiKey: apiKeyToStore, updatedAt: new Date().toISOString() }
  if (validate && apiKeyToStore && !isMasked) {
    const validation = await validateProviderConnection(updated.provider, updated.category, apiKeyToStore, updated.baseUrl, updated.model)
    if (!validation.ok) {
      throw new Error(`Validation failed: ${validation.message}`)
    }
  }
  const encryptedKey = isMasked ? existing.apiKey : await encryptSecret(apiKeyToStore || '')
  await getDb().update(aiProviders).set({
    category: updated.category,
    provider: updated.provider,
    displayName: updated.displayName,
    apiKey: encryptedKey,
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
  if (!provider.apiKey) {
    throw new Error(`Cannot activate: Provider "${provider.displayName}" has no API key configured`)
  }
  const cost = await getAICost(provider.provider, category)
  if (!cost) {
    throw new Error(`Cost configuration required for ${provider.provider} (${category}) before activation. Set costs in Admin > AI Providers > Cost Configuration.`)
  }
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
    audioSeconds: row.audioSeconds,
    imageCount: row.imageCount,
    pricingVersionId: row.pricingVersionId || null,
    unpriced: row.unpriced,
    cachedInputTokens: row.cachedInputTokens ?? 0,
  }
}

export async function logAIUsage(data: Omit<AIUsageLog, 'id' | 'createdAt' | 'pricingVersionId' | 'unpriced' | 'cachedInputTokens'> & { pricingVersionId?: string | null; unpriced?: boolean; cachedInputTokens?: number }): Promise<AIUsageLog> {
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
    audioSeconds: data.audioSeconds ?? 0,
    imageCount: data.imageCount ?? 0,
    pricingVersionId: data.pricingVersionId,
    unpriced: data.unpriced ?? false,
    cachedInputTokens: data.cachedInputTokens ?? 0,
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

  const byCategory: Record<string, { requests: number; costCents: number; tokensInput: number; tokensOutput: number }> = {}
  const byProvider: Record<string, { requests: number; costCents: number; tokensInput: number; tokensOutput: number }> = {}

  let totalRequests = 0
  let totalTokensInput = 0
  let totalTokensOutput = 0
  let totalCostCents = 0

  for (const row of result) {
    totalRequests++
    totalTokensInput += row.tokensInput
    totalTokensOutput += row.tokensOutput
    totalCostCents += row.estimatedCostCents

    if (!byCategory[row.category]) byCategory[row.category] = { requests: 0, costCents: 0, tokensInput: 0, tokensOutput: 0 }
    byCategory[row.category].requests++
    byCategory[row.category].costCents += row.estimatedCostCents
    byCategory[row.category].tokensInput += row.tokensInput
    byCategory[row.category].tokensOutput += row.tokensOutput

    if (!byProvider[row.providerId]) byProvider[row.providerId] = { requests: 0, costCents: 0, tokensInput: 0, tokensOutput: 0 }
    byProvider[row.providerId].requests++
    byProvider[row.providerId].costCents += row.estimatedCostCents
    byProvider[row.providerId].tokensInput += row.tokensInput
    byProvider[row.providerId].tokensOutput += row.tokensOutput
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

export async function getActivePricingVersion(provider: string, category: AIProviderCategory): Promise<{ id: string; version: number; inputRate: number; outputRate: number; cachedInputRate: number; imageRate: number; audioRate: number; effectiveFrom: string; effectiveUntil: string | null; source: string; lastVerifiedAt: string | null } | undefined> {
  // Same-vendor alias groups: pricing seeded under one canonical key must be
  // usable by a provider registered under an alias name (e.g. provider
  // 'gpt-image' can use pricing seeded as 'openai:image'). Aliases never cross
  // vendors, so a missing price for 'groq' is never satisfied by 'openai-stt'.
  const PROVIDER_ALIAS_GROUPS: Record<AIProviderCategory, string[][]> = {
    image: [['openai', 'openai-image', 'gpt-image']],
    stt: [['groq', 'groq-whisper'], ['openai-stt', 'openai-whisper']],
    llm: [],
  }
  const group = PROVIDER_ALIAS_GROUPS[category]?.find((g) => g.includes(provider)) || null

  // Prefer the exact provider key; fall back to same-vendor aliases only.
  let result = await getDb().select().from(aiProviderCostVersions)
    .where(and(eq(aiProviderCostVersions.provider, provider), eq(aiProviderCostVersions.category, category), eq(aiProviderCostVersions.active, true)))
    .limit(1)
  if (result.length === 0 && group) {
    result = await getDb().select().from(aiProviderCostVersions)
      .where(and(inArray(aiProviderCostVersions.provider, group), eq(aiProviderCostVersions.category, category), eq(aiProviderCostVersions.active, true)))
      .limit(1)
  }
  if (result.length === 0) return undefined
  const row = result[0]
  return {
    id: row.id,
    version: row.version,
    inputRate: row.inputRate,
    outputRate: row.outputRate,
    cachedInputRate: row.cachedInputRate,
    imageRate: row.imageRate,
    audioRate: row.audioRate,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    source: row.source,
    lastVerifiedAt: row.lastVerifiedAt,
  }
}

export async function upsertAICostVersion(data: { provider: string; category: AIProviderCategory; inputRate: number; outputRate: number; cachedInputRate?: number; imageRate?: number; audioRate?: number; source?: string; lastVerifiedAt?: string }): Promise<{ id: string; version: number; inputRate: number; outputRate: number; cachedInputRate: number; imageRate: number; audioRate: number; effectiveFrom: string; effectiveUntil: string | null; source: string; lastVerifiedAt: string | null }> {
  const now = new Date().toISOString()
  const existingActive = await getDb().select().from(aiProviderCostVersions)
    .where(and(eq(aiProviderCostVersions.provider, data.provider), eq(aiProviderCostVersions.category, data.category), eq(aiProviderCostVersions.active, true)))
    .limit(1)

  let previousCachedInputRate = 0
  if (existingActive.length > 0) {
    // A cost change creates a NEW version — the previous active version is
    // closed (never mutated) so historical usage keeps its pinned pricing.
    const row = existingActive[0]
    previousCachedInputRate = row.cachedInputRate
    await getDb().update(aiProviderCostVersions).set({
      active: false,
      status: 'superseded',
      effectiveUntil: now,
      updatedAt: now,
    }).where(eq(aiProviderCostVersions.id, row.id))
  }

  const versionRows = await getDb().select({ maxV: sql<number>`COALESCE(MAX(${aiProviderCostVersions.version}), 0)` }).from(aiProviderCostVersions)
    .where(and(eq(aiProviderCostVersions.provider, data.provider), eq(aiProviderCostVersions.category, data.category)))
  const version = Number(versionRows[0]?.maxV ?? 0) + 1

  const id = randomUUID()
  await getDb().insert(aiProviderCostVersions).values({
    id,
    provider: data.provider,
    category: data.category,
    version,
    inputRate: data.inputRate,
    outputRate: data.outputRate,
    cachedInputRate: data.cachedInputRate ?? previousCachedInputRate,
    imageRate: data.imageRate ?? 0,
    audioRate: data.audioRate ?? 0,
    effectiveFrom: now,
    source: data.source ?? 'admin',
    lastVerifiedAt: data.lastVerifiedAt,
    active: true,
    status: 'approved',
    createdAt: now,
    updatedAt: now,
  })

  return { id, version: version, inputRate: data.inputRate, outputRate: data.outputRate, cachedInputRate: data.cachedInputRate ?? previousCachedInputRate, imageRate: data.imageRate ?? 0, audioRate: data.audioRate ?? 0, effectiveFrom: now, effectiveUntil: null, source: data.source ?? 'admin', lastVerifiedAt: data.lastVerifiedAt ?? null }
}

export async function listAICostVersions(provider: string, category: AIProviderCategory): Promise<{ id: string; version: number; inputRate: number; outputRate: number; cachedInputRate: number; imageRate: number; audioRate: number; effectiveFrom: string; effectiveUntil: string | null; source: string; lastVerifiedAt: string | null; status: string; active: boolean }[]> {
  const result = await getDb().select().from(aiProviderCostVersions)
    .where(and(eq(aiProviderCostVersions.provider, provider), eq(aiProviderCostVersions.category, category)))
    .orderBy(desc(aiProviderCostVersions.version))
  return result.map(r => ({
    id: r.id,
    version: r.version,
    inputRate: r.inputRate,
    outputRate: r.outputRate,
    cachedInputRate: r.cachedInputRate,
    imageRate: r.imageRate,
    audioRate: r.audioRate,
    effectiveFrom: r.effectiveFrom,
    effectiveUntil: r.effectiveUntil,
    source: r.source,
    lastVerifiedAt: r.lastVerifiedAt,
    status: r.status,
    active: r.active,
  }))
}

// ---- Admin-Reviewed Pricing Versioning ----

/**
 * Creates a NEW pricing version as a PENDING proposal. The currently active
 * version is untouched — only admin approval (approveCostVersion) can make this
 * proposal effective. Historical versions are never mutated.
 */
export async function createCostVersionProposal(data: { provider: string; category: AIProviderCategory; inputRate: number; outputRate: number; cachedInputRate?: number; imageRate?: number; audioRate?: number; source?: string; lastVerifiedAt?: string }): Promise<{ id: string; version: number; inputRate: number; outputRate: number; cachedInputRate: number; imageRate: number; audioRate: number; effectiveFrom: string; effectiveUntil: string | null; source: string; lastVerifiedAt: string | null; status: string; active: boolean }> {
  const now = new Date().toISOString()
  const versionRows = await getDb().select({ maxV: sql<number>`COALESCE(MAX(${aiProviderCostVersions.version}), 0)` }).from(aiProviderCostVersions)
    .where(and(eq(aiProviderCostVersions.provider, data.provider), eq(aiProviderCostVersions.category, data.category)))
  const version = Number(versionRows[0]?.maxV ?? 0) + 1
  const id = randomUUID()
  await getDb().insert(aiProviderCostVersions).values({
    id,
    provider: data.provider,
    category: data.category,
    version,
    inputRate: data.inputRate,
    outputRate: data.outputRate,
    cachedInputRate: data.cachedInputRate ?? 0,
    imageRate: data.imageRate ?? 0,
    audioRate: data.audioRate ?? 0,
    effectiveFrom: now,
    source: data.source ?? 'admin',
    lastVerifiedAt: data.lastVerifiedAt,
    active: false,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  })
  return { id, version, inputRate: data.inputRate, outputRate: data.outputRate, cachedInputRate: data.cachedInputRate ?? 0, imageRate: data.imageRate ?? 0, audioRate: data.audioRate ?? 0, effectiveFrom: now, effectiveUntil: null, source: data.source ?? 'admin', lastVerifiedAt: data.lastVerifiedAt ?? null, status: 'pending', active: false }
}

/**
 * Approves a pending pricing proposal and makes it the single active version.
 * The previously active version is superseded (active=false, effectiveUntil set)
 * and NEVER mutated. Re-runs the margin guard — a proposed change that has since
 * become loss-making cannot be approved.
 */
export async function approveCostVersion(id: string): Promise<{ ok: boolean; error?: string; lossPackages?: string[]; marginStatus?: 'BLOCK' | 'WARNING' | 'PROFITABLE' }> {
  const db = getDb()
  const now = new Date().toISOString()
  const proposal = await db.select().from(aiProviderCostVersions).where(eq(aiProviderCostVersions.id, id)).limit(1)
  if (proposal.length === 0) return { ok: false, error: 'Pricing version not found' }
  const row = proposal[0]
  if (row.status !== 'pending') return { ok: false, error: 'Pricing version is not pending' }

  const { checkProposedMargin } = await import('./lib/profitability.js')
  const margin = await checkProposedMargin([{
    provider: row.provider,
    category: row.category as AIProviderCategory,
    inputRate: row.inputRate,
    outputRate: row.outputRate,
    imageRate: row.imageRate,
    audioRate: row.audioRate,
  }])
  if (margin.result === 'BLOCK') {
    return { ok: false, error: `Cannot approve: this pricing would make package(s) unprofitable: ${margin.lossPackages.join(', ')}`, lossPackages: margin.lossPackages, marginStatus: 'BLOCK' }
  }

  await db.transaction(async (tx) => {
    await tx.update(aiProviderCostVersions).set({ active: false, status: 'superseded', effectiveUntil: now, updatedAt: now })
      .where(and(eq(aiProviderCostVersions.provider, row.provider), eq(aiProviderCostVersions.category, row.category), eq(aiProviderCostVersions.active, true)))

    const activated = await tx.update(aiProviderCostVersions).set({ active: true, status: 'approved', effectiveFrom: now, updatedAt: now })
      .where(and(eq(aiProviderCostVersions.id, id), eq(aiProviderCostVersions.status, 'pending')))
      .returning({ id: aiProviderCostVersions.id })
    if (activated.length === 0) {
      throw new Error('Pricing proposal already processed')
    }
  })

  // Keep the legacy mutable mirror in sync so existing read paths stay consistent.
  await upsertAICost({
    provider: row.provider,
    category: row.category as AIProviderCategory,
    costPer1MInputTokens: row.inputRate,
    costPer1MOutputTokens: row.outputRate,
    costPerImage: row.imageRate,
    costPerAudioMinute: row.audioRate,
  })

  return { ok: true, marginStatus: margin.result }
}

/**
 * Rejects a pending pricing proposal. It never becomes active and historical
 * versions remain untouched.
 */
export async function rejectCostVersion(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await getDb().update(aiProviderCostVersions)
    .set({ status: 'rejected', active: false, updatedAt: new Date().toISOString() })
    .where(and(eq(aiProviderCostVersions.id, id), eq(aiProviderCostVersions.status, 'pending')))
    .returning({ id: aiProviderCostVersions.id })
  if (result.length === 0) return { ok: false, error: 'Pricing version not found or not pending' }
  return { ok: true }
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

