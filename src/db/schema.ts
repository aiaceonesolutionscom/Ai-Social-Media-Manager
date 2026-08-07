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
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_packages_slug').on(table.slug),
  index('idx_packages_active').on(table.isActive),
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
