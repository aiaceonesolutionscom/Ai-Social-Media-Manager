import { boolean, integer, jsonb, pgTable, text, uniqueIndex, index } from 'drizzle-orm/pg-core'

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull(),
  stage: text('stage').notNull().default('NEW'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  data: jsonb('data').notNull().default({}),
}, (table) => [
  index('idx_posts_phone').on(table.phone),
  index('idx_posts_stage').on(table.stage),
])

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull(),
  role: text('role').notNull(),
  type: text('type').notNull(),
  content: text('content').notNull(),
  waMsgId: text('wa_msg_id'),
  postId: text('post_id'),
  meta: text('meta'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_messages_phone').on(table.phone, table.createdAt),
  uniqueIndex('idx_messages_wa').on(table.phone, table.waMsgId),
])

export const conversations = pgTable('conversations', {
  phone: text('phone').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const postEdits = pgTable('post_edits', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull(),
  editRequest: text('edit_request').notNull(),
  contentSnapshot: text('content_snapshot').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_edits_post').on(table.postId),
])

export const userPreferences = pgTable('user_preferences', {
  phone: text('phone').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const brandProfile = pgTable('brand_profile', {
  phone: text('phone').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---- SaaS Platform Tables ----

export const packages = pgTable('packages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  description: text('description'),
  priceCents: integer('price_cents').notNull(),
  currency: text('currency').notNull().default('usd'),
  includedTokens: integer('included_tokens').notNull(),
  features: jsonb('features').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  billingPeriod: text('billing_period').notNull().default('monthly'),
  yearlyPriceCents: integer('yearly_price_cents').notNull().default(0),
  setupType: text('setup_type').notNull().default('none'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_packages_slug').on(table.slug),
  index('idx_packages_active').on(table.isActive),
])

export const topupBundles = pgTable('topup_bundles', {
  id: text('id').primaryKey(),
  tokens: integer('tokens').notNull(),
  priceCents: integer('price_cents').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_topup_active').on(table.isActive),
])

export const users = pgTable('users', {
  phone: text('phone').primaryKey(),
  name: text('name'),
  email: text('email'),
  role: text('role').notNull().default('user'),
  active: integer('active').notNull().default(1),
  packageId: text('package_id'),
  tokensRemaining: integer('tokens_remaining').notNull().default(0),
  tokensUsed: integer('tokens_used').notNull().default(0),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  passwordHash: text('password_hash'),
  oauthProvider: text('oauth_provider'),
  oauthId: text('oauth_id'),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_users_email').on(table.email),
  index('idx_users_role').on(table.role),
  index('idx_users_active').on(table.active),
])

export const tokenTransactions = pgTable('token_transactions', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull(),
  type: text('type').notNull(),
  amount: integer('amount').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  description: text('description').notNull(),
  postId: text('post_id'),
  adminId: text('admin_id'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_token_tx_phone').on(table.phone, table.createdAt),
  index('idx_token_tx_type').on(table.type),
])

export const socialAccounts = pgTable('social_accounts', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull(),
  platform: text('platform').notNull(),
  accountId: text('account_id').notNull(),
  accountName: text('account_name'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: text('token_expires_at'),
  status: text('status').notNull().default('active'),
  connectedAt: text('connected_at').notNull(),
}, (table) => [
  index('idx_social_phone').on(table.phone),
  index('idx_social_platform').on(table.platform),
  index('idx_social_status').on(table.status),
  uniqueIndex('idx_social_phone_platform').on(table.phone, table.platform),
])

export const userSessions = pgTable('user_sessions', {
  token: text('token').primaryKey(),
  userEmail: text('user_email').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})

export const adminConfig = pgTable('admin_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const adminUsers = pgTable('admin_users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  permissions: jsonb('permissions').notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: text('created_by'),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_admin_users_email').on(table.email),
])

export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull(),
  packageId: text('package_id'),
  tokenCount: integer('token_count').notNull(),
  amountCents: integer('amount_cents').notNull(),
  type: text('type').notNull(),
  stripeSessionId: text('stripe_session_id'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_payments_phone').on(table.phone),
  index('idx_payments_status').on(table.status),
  index('idx_payments_stripe').on(table.stripeSessionId),
])

export const adCampaigns = pgTable('ad_campaigns', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull(),
  postId: text('post_id'),
  name: text('name').notNull(),
  objective: text('objective').notNull(),
  status: text('status').notNull().default('pending'),
  adContent: jsonb('ad_content').notNull(),
  targeting: jsonb('targeting').notNull(),
  budgetCents: integer('budget_cents').notNull(),
  campaignId: text('campaign_id'),
  adSetId: text('ad_set_id'),
  adId: text('ad_id'),
  imageUrl: text('image_url'),
  publishAt: text('publish_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_ad_campaigns_phone').on(table.phone),
  index('idx_ad_campaigns_status').on(table.status),
])

// ---- AI Provider Tables ----

export const aiProviders = pgTable('ai_providers', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  provider: text('provider').notNull(),
  displayName: text('display_name').notNull(),
  apiKey: text('api_key'),
  baseUrl: text('base_url'),
  model: text('model'),
  config: jsonb('config').notNull().default({}),
  isActive: boolean('is_active').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_ai_providers_category').on(table.category),
  index('idx_ai_providers_active').on(table.isActive),
])

export const aiUsageLogs = pgTable('ai_usage_logs', {
  id: text('id').primaryKey(),
  phone: text('phone'),
  providerId: text('provider_id').notNull(),
  category: text('category').notNull(),
  model: text('model'),
  feature: text('feature'),
  tokensInput: integer('tokens_input').notNull().default(0),
  tokensOutput: integer('tokens_output').notNull().default(0),
  estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  success: boolean('success').notNull().default(true),
  error: text('error'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_ai_usage_provider').on(table.providerId),
  index('idx_ai_usage_category').on(table.category),
  index('idx_ai_usage_created').on(table.createdAt),
  index('idx_ai_usage_phone').on(table.phone),
])

export const aiProviderCosts = pgTable('ai_provider_costs', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  category: text('category').notNull(),
  costPer1MInputTokens: integer('cost_per_1m_input_tokens').notNull().default(0),
  costPer1MOutputTokens: integer('cost_per_1m_output_tokens').notNull().default(0),
  costPerImage: integer('cost_per_image').notNull().default(0),
  costPerAudioMinute: integer('cost_per_audio_minute').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_ai_costs_provider').on(table.provider),
  uniqueIndex('idx_ai_costs_provider_category').on(table.provider, table.category),
])

// ---- Meta Platform Tables ----

export const metaConfig = pgTable('meta_config', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  key: text('key').notNull(),
  value: text('value'),
  isSensitive: boolean('is_sensitive').notNull().default(false),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_meta_config_category').on(table.category),
  uniqueIndex('idx_meta_config_key').on(table.category, table.key),
])

// ---- Support Tickets ----

export const supportTickets = pgTable('support_tickets', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('open'),
  priority: text('priority').notNull().default('normal'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_support_phone').on(table.phone),
  index('idx_support_status').on(table.status),
])

export const supportReplies = pgTable('support_replies', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull(),
  role: text('role').notNull().default('user'),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_support_replies_ticket').on(table.ticketId),
])

// ---- Audit Logs ----

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  actor: text('actor').notNull(),
  actorType: text('actor_type').notNull().default('user'),
  action: text('action').notNull(),
  target: text('target'),
  targetType: text('target_type'),
  details: jsonb('details').notNull().default({}),
  ip: text('ip'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_audit_actor').on(table.actor),
  index('idx_audit_action').on(table.action),
  index('idx_audit_created').on(table.createdAt),
])

// ---- Webhook Events ----

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  headers: jsonb('headers').notNull().default({}),
  status: text('status').notNull().default('received'),
  responseCode: integer('response_code'),
  error: text('error'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_webhook_source').on(table.source),
  index('idx_webhook_status').on(table.status),
  index('idx_webhook_created').on(table.createdAt),
])

// ---- Scheduled Posts ----

export const scheduledPosts = pgTable('scheduled_posts', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull(),
  phone: text('phone').notNull(),
  publishAt: text('publish_at').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  processedAt: text('processed_at'),
}, (table) => [
  index('idx_scheduled_publish_at').on(table.publishAt),
  index('idx_scheduled_status').on(table.status),
  index('idx_scheduled_phone').on(table.phone),
])
