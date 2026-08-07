import { logger } from './logger.js'
import { getMetaConfigValue, getAllMetaConfig, setMetaConfig } from '../store.js'

type MetaConfigCache = Map<string, string>

const DEFAULTS: Record<string, string> = {
  'general.graph_api_version': 'v21.0',
  'general.app_mode': 'development',
  'api_versions.facebook': 'v21.0',
  'api_versions.instagram': 'v21.0',
  'api_versions.meta_ads': 'v21.0',
}

class MetaConfigManager {
  private cache: MetaConfigCache = new Map()
  private loaded = false

  async load(): Promise<void> {
    try {
      const config = await getAllMetaConfig()
      this.cache.clear()

      for (const [category, entries] of Object.entries(config)) {
        for (const [key, value] of Object.entries(entries)) {
          this.cache.set(`${category}.${key}`, value)
        }
      }

      for (const [key, value] of Object.entries(DEFAULTS)) {
        if (!this.cache.has(key)) {
          this.cache.set(key, value)
        }
      }

      this.loaded = true
      logger.info({
        appId: this.getAppId() ? '***' + this.getAppId().slice(-4) : 'not set',
        appMode: this.getAppMode(),
        graphVersion: this.getGraphApiVersion(),
        whatsapp: this.getWhatsAppToken() ? 'set' : 'not set',
      }, 'Meta Configuration loaded')
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to load Meta Config, using defaults + env vars')
      this.loaded = true
    }
  }

  async reload(): Promise<void> {
    await this.load()
  }

  async set(category: string, key: string, value: string, isSensitive = false): Promise<void> {
    await setMetaConfig(category, key, value, isSensitive)
    this.cache.set(`${category}.${key}`, value)
  }

  getValue(category: string, key: string): string {
    return this.cache.get(`${category}.${key}`) || ''
  }

  // ---- General ----

  getAppId(): string {
    return this.getValue('general', 'app_id') || process.env.FACEBOOK_APP_ID || ''
  }

  getAppSecret(): string {
    return this.getValue('general', 'app_secret') || process.env.FACEBOOK_APP_SECRET || ''
  }

  getGraphApiVersion(): string {
    return this.getValue('general', 'graph_api_version') || process.env.GRAPH_API_VERSION || 'v21.0'
  }

  getAppMode(): string {
    return this.getValue('general', 'app_mode') || process.env.META_APP_MODE || 'development'
  }

  // ---- OAuth ----

  getOAuthRedirectUri(): string {
    return this.getValue('oauth', 'redirect_uri') || process.env.META_OAUTH_REDIRECT_URI || ''
  }

  getDefaultCallbackUri(): string {
    return this.getValue('oauth', 'default_callback_uri') || process.env.META_CALLBACK_URI || ''
  }

  // ---- Webhook ----

  getVerifyToken(): string {
    return this.getValue('webhook', 'verify_token') || process.env.WHATSAPP_VERIFY_TOKEN || 'change-me-verify-token'
  }

  getWebhookSecret(): string {
    return this.getValue('webhook', 'webhook_secret') || process.env.WHATSAPP_APP_SECRET || ''
  }

  getWebhookUrl(): string {
    return this.getValue('webhook', 'webhook_url') || process.env.META_WEBHOOK_URL || ''
  }

  // ---- WhatsApp ----

  getWhatsAppToken(): string {
    return this.getValue('whatsapp', 'access_token') || process.env.WHATSAPP_TOKEN || ''
  }

  getWhatsAppPhoneId(): string {
    return this.getValue('whatsapp', 'phone_number_id') || process.env.WHATSAPP_PHONE_NUMBER_ID || ''
  }

  getWhatsAppBusinessAccountId(): string {
    return this.getValue('whatsapp', 'business_account_id') || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || ''
  }

  getWhatsAppApiVersion(): string {
    return this.getValue('whatsapp', 'api_version') || this.getGraphApiVersion()
  }

  // ---- API Versions ----

  getFacebookApiVersion(): string {
    return this.getValue('api_versions', 'facebook') || this.getGraphApiVersion()
  }

  getInstagramApiVersion(): string {
    return this.getValue('api_versions', 'instagram') || this.getGraphApiVersion()
  }

  getMetaAdsApiVersion(): string {
    return this.getValue('api_versions', 'meta_ads') || this.getGraphApiVersion()
  }

  // ---- Status ----

  isConfigured(): boolean {
    return !!(this.getAppId() && this.getAppSecret())
  }

  isWhatsAppConfigured(): boolean {
    return !!(this.getWhatsAppToken() && this.getWhatsAppPhoneId())
  }

  isWebhookConfigured(): boolean {
    return !!(this.getVerifyToken() && this.getWebhookSecret())
  }

  getStatus(): {
    configured: boolean
    appId: string
    appMode: string
    graphApiVersion: string
    whatsappConnected: boolean
    webhookConfigured: boolean
    oauthConfigured: boolean
  } {
    return {
      configured: this.isConfigured(),
      appId: this.getAppId() ? `***${this.getAppId().slice(-4)}` : 'not set',
      appMode: this.getAppMode(),
      graphApiVersion: this.getGraphApiVersion(),
      whatsappConnected: this.isWhatsAppConfigured(),
      webhookConfigured: this.isWebhookConfigured(),
      oauthConfigured: !!this.getOAuthRedirectUri(),
    }
  }
}

export const metaConfig = new MetaConfigManager()
