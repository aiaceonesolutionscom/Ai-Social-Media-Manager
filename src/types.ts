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
  | 'unclear'

export interface AgentDecision {
  action: AgentAction
  reply?: string
  question?: string
  intent?: Partial<Intent>
  editRequest?: string
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

export type TokenTransactionType = 'grant' | 'deduct' | 'refund' | 'bonus'

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

export type SocialPlatform = 'instagram' | 'facebook' | 'whatsapp'

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

export type PaymentType = 'subscription' | 'one_time' | 'token_purchase'

export interface Payment {
  id: string
  phone: string
  packageId: string
  tokenCount: number
  amountCents: number
  type: PaymentType
  stripeSessionId: string
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  createdAt: string
}

export type TokenAction = 'standard_post' | 'cross_platform' | 'image_regenerate' | 'ad_campaign'

export interface UserSession {
  token: string
  userEmail: string
  createdAt: string
  expiresAt: string
}
