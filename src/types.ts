export type PostStage =
  | 'NEW'
  | 'TRANSCRIBED'
  | 'INTENT'
  | 'PLANNED'
  | 'WRITTEN'
  | 'IMAGE'
  | 'CHECKED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'PREPARING_TO_PUBLISH'
  | 'PUBLISHING'
  | 'DONE'
  | 'CANCELLED'
  | 'FAILED'

export interface Intent {
  topic: string
  audience: string
  tone: string
  goal: string
  language: string
  emotion: string
}

export interface PlannedContent {
  positioning: string
  angle: string
  suggestedTime: string
}

export interface WrittenContent {
  hook: string
  caption: string
  cta: string
  emojis: string
  hashtags: string
  seoKeywords: string[]
}

export interface PlatformContent {
  facebook?: WrittenContent
  instagram?: WrittenContent
}

export interface BrandCheck {
  passed: boolean
  grammar: string
  brandVoice: string
  copyright: string
  policy: string
  fixedCaption?: string
}

export interface StageEvent {
  stage: PostStage
  at: string
  note?: string
}

export interface Post {
  id: string
  phone: string
  status: PostStage
  error?: string
  transcript?: string
  intent?: Intent
  plan?: PlannedContent
  content?: WrittenContent
  platformContent?: PlatformContent
  brandCheck?: BrandCheck
  imagePrompt?: string
  imagePath?: string
  imageUrl?: string
  publishAt?: string
  publishedAt?: string
  mediaId?: string
  permalink?: string
  createdAt: string
  updatedAt: string
  history?: StageEvent[]
  tokensCharged?: number
  tokensChargedAction?: string
}

export type MessageRole = 'user' | 'bot'
export type MessageType = 'text' | 'voice' | 'image' | 'preview' | 'error' | 'system'

export interface MessageRecord {
  id: string
  phone: string
  role: MessageRole
  type: MessageType
  content: string
  waMsgId?: string
  postId?: string
  meta?: string
  createdAt: string
}

export interface EditRecord {
  id: string
  postId: string
  editRequest: string
  contentSnapshot: string
  createdAt: string
}

export type ConversationState =
  | { kind: 'idle'; postId?: string }
  | { kind: 'gathering'; postId: string; intent: Partial<Intent> }
  | { kind: 'generating'; postId: string }
  | { kind: 'processing'; postId: string }
  | { kind: 'awaiting_approval'; postId: string }
  | { kind: 'editing'; postId: string }
  | { kind: 'preparing_publish'; postId: string }
  | { kind: 'publishing'; postId: string }
  | { kind: 'ad_gathering'; postId: string; step: string; data: Record<string, unknown> }
  | { kind: 'ad_preview'; postId: string }

export type PendingConversation = ConversationState

export type AgentAction =
  | 'smalltalk'
  | 'ask_question'
  | 'generate_post'
  | 'edit_request'
  | 'approve'
  | 'regenerate'
  | 'cancel_publish'
  | 'new_post'
  | 'create_ad'
  | 'schedule_post'
  | 'unclear'

export interface AgentDecision {
  action: AgentAction
  reply?: string
  question?: string
  intent?: Partial<Intent>
  editRequest?: string
  scheduleAt?: string
}

export type EditScope = 'caption' | 'image' | 'both' | 'full'

export interface EditDecision {
  scope: EditScope
  content?: WrittenContent
  imagePrompt?: string
}

export interface UserPreferences {
  language?: string
  tone?: string
  audience?: string
  brandVoice?: string
  [key: string]: unknown
}

export interface BrandProfile {
  voice?: string
  values?: string[]
  prohibitedWords?: string[]
  toneGuidelines?: string
  [key: string]: unknown
}

// ---- SaaS Platform Types ----

export interface Package {
  id: string
  name: string
  slug: string
  description: string
  priceCents: number
  currency: string
  includedTokens: number
  features: Record<string, unknown>
  isActive: boolean
  sortOrder: number
  billingPeriod: 'monthly' | 'yearly'
  yearlyPriceCents: number
  setupType: 'none' | 'standard' | 'premium'
  createdAt: string
  updatedAt: string
}

export interface TopUpBundle {
  id: string
  tokens: number
  priceCents: number
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface User {
  phone: string
  name: string
  email: string
  role: 'user' | 'admin'
  active: number
  packageId: string
  packageStatus: 'none' | 'active' | 'expired' | 'ended'
  packageStartedAt: string
  packageExpiresAt: string
  packageEndedAt: string
  tokensRemaining: number
  tokensUsed: number
  stripeCustomerId: string
  stripeSubscriptionId: string
  passwordHash?: string
  oauthProvider?: string
  oauthId?: string
  avatarUrl?: string
  createdAt: string
  updatedAt: string
}

export type TokenTransactionType = 'grant' | 'deduct' | 'refund' | 'bonus' | 'revoke'

export interface TokenTransaction {
  id: string
  phone: string
  type: TokenTransactionType
  amount: number
  balanceAfter: number
  description: string
  postId: string
  adminId: string
  createdAt: string
}

export type SocialPlatform = 'instagram' | 'facebook' | 'whatsapp' | 'meta_ads'

export interface SocialAccount {
  id: string
  phone: string
  platform: SocialPlatform
  accountId: string
  accountName: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
  status: 'active' | 'expired' | 'disconnected'
  connectedAt: string
}

export interface AdminConfig {
  key: string
  value: string
  updatedAt: string
}

export type PaymentType = 'subscription' | 'one_time' | 'token_purchase' | 'topup'

export interface Payment {
  id: string
  phone: string
  packageId: string
  tokenCount: number
  amountCents: number
  taxPercent: number
  mdrPercent: number
  taxAmount: number
  mdrAmount: number
  type: PaymentType
  stripeSessionId: string
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  createdAt: string
}

export type TokenAction = 'standard_post' | 'cross_platform' | 'image_regenerate' | 'ad_campaign'

export interface AdContent {
  headline: string
  primaryText: string
  description: string
  callToAction: string
  linkUrl?: string
}

export interface AdTargeting {
  ageMin: number
  ageMax: number
  genders: string[]
  locations: string[]
  interests: string[]
}

export interface AdCampaign {
  id: string
  phone: string
  postId?: string
  name: string
  objective: string
  status: 'pending' | 'creating' | 'scheduled' | 'active' | 'paused' | 'cancelled' | 'failed'
  adContent: AdContent
  targeting: AdTargeting
  budgetCents: number
  campaignId?: string
  adSetId?: string
  adId?: string
  imageUrl?: string
  publishAt?: string
  createdAt: string
  updatedAt: string
}

export interface UserSession {
  token: string
  userEmail: string
  createdAt: string
  expiresAt: string
}

// ---- AI Provider Types ----

export type AIProviderCategory = 'stt' | 'llm' | 'image'

export interface AIProvider {
  id: string
  category: AIProviderCategory
  provider: string
  displayName: string
  apiKey: string
  baseUrl: string
  model: string
  config: Record<string, unknown>
  isActive: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export type AIProviderInput = Omit<AIProvider, 'id' | 'createdAt' | 'updatedAt'>

export interface AIUsageLog {
  id: string
  phone: string
  providerId: string
  category: AIProviderCategory
  model: string
  feature: string
  tokensInput: number
  tokensOutput: number
  estimatedCostCents: number
  durationMs: number
  success: boolean
  error: string
  createdAt: string
}

export interface AICostConfig {
  id: string
  provider: string
  category: AIProviderCategory
  costPer1MInputTokens: number
  costPer1MOutputTokens: number
  costPerImage: number
  costPerAudioMinute: number
  updatedAt: string
}
