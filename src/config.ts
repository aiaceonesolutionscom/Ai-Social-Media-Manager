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
    apiKey: required('LLM_API_KEY', { soft: true }),
    baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    model: process.env.LLM_MODEL || 'deepseek-chat',
  },

  image: {
    provider: (process.env.IMAGE_PROVIDER || 'openai') as 'openai', // | 'gemini' | 'stability' (uncomment to use)
    model: process.env.IMAGE_MODEL || 'gpt-image-1-mini',
    // geminiKey: required('GEMINI_API_KEY', { soft: true }),
    openaiKey: required('OPENAI_API_KEY', { soft: true }),
    // stabilityKey: required('STABILITY_API_KEY', { soft: true }),
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
}

export type AppConfig = typeof config

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
  if (!config.image.openaiKey) throw new Error('OPENAI_API_KEY is not set (required for image generation)')
  // Uncomment below to validate other providers:
  // if (config.image.provider === 'gemini' && !config.image.geminiKey) throw new Error('GEMINI_API_KEY is not set')
  // if (config.image.provider === 'stability' && !config.image.stabilityKey) throw new Error('STABILITY_API_KEY is not set')
}

export function ensureLLMReady(): void {
  if (!config.llm.apiKey) throw new Error('LLM_API_KEY is not set')
}
