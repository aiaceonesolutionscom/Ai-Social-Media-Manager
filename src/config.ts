import 'dotenv/config'

function required(name: string, opts: { soft?: boolean } = {}): string {
  const value = process.env[name]
  if (value && value.trim().length > 0) return value.trim()
  if (opts.soft) return ''
  throw new Error(`Missing required env var: ${name}. See .env.example`)
}

export const config = {
  port: Number(process.env.PORT || 8787),
  webhookPath: process.env.WEBHOOK_PATH || '/webhooks/whatsapp',
  publicBaseUrl: required('PUBLIC_BASE_URL', { soft: true }) || 'http://localhost:8787',
  frontendUrl: required('FRONTEND_URL', { soft: true }) || 'http://localhost:5173',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  storageDir: process.env.STORAGE_DIR || './storage',
  logLevel: process.env.LOG_LEVEL || 'info',

  dev: {
    // Testing mode: mocks external integrations when their real key is missing.
    // NEVER enable in production.
    enabled: process.env.DEV_MODE === 'true',
  },

  admin: {
    email: required('ADMIN_EMAIL', { soft: true }) || 'admin@example.com',
    password: required('ADMIN_PASSWORD', { soft: true }) || 'admin123',
    phone: required('SUPER_ADMIN_PHONE', { soft: true }),
  },

  clerk: {
    secretKey: required('CLERK_SECRET_KEY', { soft: true }),
    publishableKey: required('CLERK_PUBLISHABLE_KEY', { soft: true }) || required('VITE_CLERK_PUBLISHABLE_KEY', { soft: true }),
  },

  whatsapp: {
    token: required('WHATSAPP_TOKEN', { soft: true }),
    phoneNumberId: required('WHATSAPP_PHONE_NUMBER_ID', { soft: true }),
    verifyToken: required('WHATSAPP_VERIFY_TOKEN', { soft: true }) || 'change-me-verify-token',
    appSecret: required('WHATSAPP_APP_SECRET', { soft: true }),
    recipientPhone: required('WHATSAPP_RECIPIENT_PHONE', { soft: true }),
    displayPhoneNumber: required('WHATSAPP_DISPLAY_PHONE_NUMBER', { soft: true }),
  },

  instagram: {
    accessToken: required('INSTAGRAM_ACCESS_TOKEN', { soft: true }),
    igUserId: required('INSTAGRAM_IG_USER_ID', { soft: true }),
    apiVersion: process.env.GRAPH_API_VERSION || 'v21.0',
  },

  facebook: {
    pageId: required('FACEBOOK_PAGE_ID', { soft: true }),
    accessToken: required('FACEBOOK_ACCESS_TOKEN', { soft: true }),
    appId: required('FACEBOOK_APP_ID', { soft: true }),
    appSecret: required('FACEBOOK_APP_SECRET', { soft: true }),
  },

  metaAds: {
    adAccountId: required('META_ADS_ACCOUNT_ID', { soft: true }),
    accessToken: required('META_ADS_ACCESS_TOKEN', { soft: true }),
    pixelId: process.env.META_ADS_PIXEL_ID || '',
  },

  stripe: {
    secretKey: required('STRIPE_SECRET_KEY', { soft: true }),
    webhookSecret: required('STRIPE_WEBHOOK_SECRET', { soft: true }),
    priceId: required('STRIPE_PRICE_ID', { soft: true }),
  },

  oauth: {
    google: {
      clientId: required('GOOGLE_CLIENT_ID', { soft: true }),
      clientSecret: required('GOOGLE_CLIENT_SECRET', { soft: true }),
      callbackUrl: required('GOOGLE_CALLBACK_URL', { soft: true }) || 'http://localhost:8787/api/auth/google/callback',
    },
    facebook: {
      clientId: required('FACEBOOK_OAUTH_APP_ID', { soft: true }) || required('FACEBOOK_APP_ID', { soft: true }),
      clientSecret: required('FACEBOOK_OAUTH_APP_SECRET', { soft: true }) || required('FACEBOOK_APP_SECRET', { soft: true }),
      callbackUrl: required('FACEBOOK_OAUTH_CALLBACK_URL', { soft: true }) || 'http://localhost:8787/api/auth/facebook/callback',
    },
    github: {
      clientId: required('GITHUB_CLIENT_ID', { soft: true }),
      clientSecret: required('GITHUB_CLIENT_SECRET', { soft: true }),
      callbackUrl: required('GITHUB_CALLBACK_URL', { soft: true }) || 'http://localhost:8787/api/auth/github/callback',
    },
  },

  stt: {
    apiKey: required('GROQ_API_KEY', { soft: true }),
    model: process.env.GROQ_MODEL || 'whisper-large-v3',
    baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  },

  llm: {
    apiKey: process.env.LLM_API_KEY || required('LLM_API_KEY', { soft: true }),
    baseUrl: process.env.LLM_BASE_URL || 'https://api.mistral.ai/v1',
    model: process.env.LLM_MODEL || 'mistral-large-latest',
  },

  image: {
    provider: (process.env.IMAGE_PROVIDER || 'openai') as 'openai' | 'gemini' | 'stability',
    model: process.env.IMAGE_MODEL || 'gpt-image-1-mini',
    geminiKey: required('GEMINI_API_KEY', { soft: true }),
    openaiKey: required('OPENAI_API_KEY', { soft: true }),
    stabilityKey: required('STABILITY_API_KEY', { soft: true }),
  },

  retry: {
    attempts: Number(process.env.RETRY_ATTEMPTS || 3),
    baseDelayMs: Number(process.env.RETRY_BASE_DELAY_MS || 800),
    timeoutMs: Number(process.env.HTTP_TIMEOUT_MS || 60_000),
  },

  tokenCosts: {
    standardPost: 1,
    crossPlatform: 2,
    imageRegenerate: 1,
    adCampaign: 5,
  },

  // Scheduling token costs
  scheduling: {
    schedulePost: 1,
    scheduleAd: 3,
    editScheduled: 1,
  },
}

export type AppConfig = typeof config

/**
 * Production-security guard: encrypted secrets (social access tokens, AI provider keys,
 * meta config) are AES-256-GCM encrypted with a key derived from MASTER_ENCRYPTION_KEY.
 * Without it, crypto.ts falls back to a hardcoded dev key that ships in the repo, making
 * every "encrypted" secret decryptable. In production (DEV_MODE=false) that is
 * unacceptable, so startup refuses to proceed. Callers must convert the thrown error into
 * a fatal shutdown.
 */
export function assertProductionSecurityConfig(): void {
  if (!config.dev.enabled && !process.env.MASTER_ENCRYPTION_KEY) {
    throw new Error('FATAL: MASTER_ENCRYPTION_KEY is required when DEV_MODE=false. Refusing to start — encrypted secrets (social tokens, AI keys) would use the insecure hardcoded dev key.')
  }

  // P5-8 — the built-in default admin credentials are only safe for local dev.
  // Production must ship with explicit, strong ADMIN_EMAIL / ADMIN_PASSWORD values.
  if (
    !config.dev.enabled &&
    (!process.env.ADMIN_EMAIL ||
      !process.env.ADMIN_PASSWORD ||
      config.admin.email === 'admin@example.com' ||
      config.admin.password === 'admin123')
  ) {
    throw new Error(
      'FATAL: default admin credentials (admin@example.com / admin123) are not allowed in production. Set ADMIN_EMAIL and ADMIN_PASSWORD to strong, unique values.',
    )
  }

  // P5-9 — the placeholder WhatsApp verify token must never be used in production.
  if (!config.dev.enabled && config.whatsapp.verifyToken === 'change-me-verify-token') {
    throw new Error('FATAL: WHATSAPP_VERIFY_TOKEN is still set to the placeholder "change-me-verify-token". Set a real, unique value before deploying to production.')
  }
}

export function ensureReady(): void {
  ensureWhatsappReady()
  ensureInstagramReady()
  ensureSTTReady()
  ensureImageProviderReady()
  ensureLLMReady()
}

function ensureWhatsappReady(): void {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    throw new Error('WhatsApp Cloud API env vars missing (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)')
  }
}

function ensureInstagramReady(): void {
  if (!config.instagram.accessToken) throw new Error('INSTAGRAM_ACCESS_TOKEN is not set')
  if (!config.instagram.igUserId) throw new Error('INSTAGRAM_IG_USER_ID is not set')
}

function ensureSTTReady(): void {
  if (!config.stt.apiKey) throw new Error('GROQ_API_KEY is not set')
}

export function ensureImageProviderReady(): void {
  const provider = config.image.provider
  if (provider === 'gemini' && !config.image.geminiKey) throw new Error('GEMINI_API_KEY is not set (required when IMAGE_PROVIDER=gemini)')
  if (provider === 'stability' && !config.image.stabilityKey) throw new Error('STABILITY_API_KEY is not set (required when IMAGE_PROVIDER=stability)')
  if (!config.image.openaiKey) throw new Error('OPENAI_API_KEY is not set (required for image generation)')
}

export function ensureLLMReady(): void {
  if (!config.llm.apiKey) throw new Error('LLM_API_KEY is not set')
}

/**
 * Returns a warning string if the Clerk publishable and secret keys appear to
 * belong to different Clerk applications (different key payloads). When they
 * mismatch, `verifyToken` rejects every session with 401, so this surfaces the
 * misconfiguration loudly at startup instead of failing silently per-request.
 */
export function clerkKeyMismatchWarning(): string | null {
  const { secretKey, publishableKey } = config.clerk
  if (!secretKey || !publishableKey) return null

  const issues: string[] = []
  // Modern Clerk secret keys are opaque (their payload does NOT decode to the
  // instance), so we can't reliably compare secret vs publishable payloads.
  // The reliable misconfiguration is a wrong key *prefix* — e.g. a publishable
  // key accidentally holding a secret (sk_...) value.
  if (!/^pk_(test|live)_/.test(publishableKey)) {
    issues.push('CLERK_PUBLISHABLE_KEY must start with "pk_" (it looks like a secret key)')
  }
  if (!/^sk_(test|live)_/.test(secretKey)) {
    issues.push('CLERK_SECRET_KEY must start with "sk_"')
  }
  if (issues.length === 0) return null
  return (
    'CLERK_CONFIG_WARNING: ' +
    issues.join('; ') +
    '. Clerk login will fail with 401 "Invalid or expired Clerk session". ' +
    'Use the publishable + secret key from the SAME Clerk app for frontend and backend.'
  )
}
