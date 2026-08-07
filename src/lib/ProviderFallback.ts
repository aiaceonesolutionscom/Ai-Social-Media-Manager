import { logger } from './logger.js'
import { getActiveAIProvider, listAIProviders } from '../store.js'
import type { AIProvider } from '../types.js'

export type ProviderCategory = 'stt' | 'llm' | 'image'

interface ProviderHealth {
  providerId: string
  lastFailure: number
  failureCount: number
  cooldownUntil: number
}

const COOLDOWN_MS = 60_000
const MAX_FAILURES = 3

class ProviderFallbackManager {
  private health = new Map<string, ProviderHealth>()

  async getProviderWithFallback(category: string): Promise<{
    primary: AIProvider | null
    fallbacks: AIProvider[]
  }> {
    const allProviders = await listAIProviders(category as ProviderCategory)
    const activeProviders = allProviders.filter((p) => p.isActive)

    if (activeProviders.length === 0) {
      const allInCategory = allProviders.filter((p) => p.isDefault)
      return {
        primary: null,
        fallbacks: this.filterHealthyProviders(allInCategory),
      }
    }

    const healthy = this.filterHealthyProviders(activeProviders)
    const unhealthy = activeProviders.filter((p) => !this.isHealthy(p.id))

    if (healthy.length > 0) {
      return { primary: healthy[0], fallbacks: healthy.slice(1) }
    }

    if (unhealthy.length > 0) {
      logger.warn({ category }, 'all primary providers in cooldown, using unhealthy')
      return { primary: unhealthy[0], fallbacks: unhealthy.slice(1) }
    }

    const defaults = allProviders.filter((p) => p.isDefault)
    return { primary: null, fallbacks: this.filterHealthyProviders(defaults) }
  }

  async executeWithFallback<T>(
    category: string,
    operation: (provider: AIProvider) => Promise<T>,
  ): Promise<T> {
    const { primary, fallbacks } = await this.getProviderWithFallback(category)
    const chain: AIProvider[] = primary ? [primary, ...fallbacks] : fallbacks

    if (chain.length === 0) {
      throw new Error(`No providers available for category: ${category}`)
    }

    let lastError: Error | undefined

    for (const provider of chain) {
      try {
        logger.info({ provider: provider.provider, category }, 'trying provider')
        const result = await operation(provider)
        this.recordSuccess(provider.id)
        return result
      } catch (err) {
        lastError = err as Error
        this.recordFailure(provider.id)
        logger.warn({ provider: provider.provider, category, error: lastError.message }, 'provider failed, trying next')
      }
    }

    throw lastError || new Error(`All providers failed for category: ${category}`)
  }

  isHealthy(providerId: string): boolean {
    const health = this.health.get(providerId)
    if (!health) return true
    if (health.failureCount < MAX_FAILURES) return true
    return Date.now() > health.cooldownUntil
  }

  private filterHealthyProviders(providers: AIProvider[]): AIProvider[] {
    return providers.filter((p) => this.isHealthy(p.id))
  }

  private recordSuccess(providerId: string): void {
    this.health.delete(providerId)
  }

  private recordFailure(providerId: string): void {
    const existing = this.health.get(providerId)
    const now = Date.now()
    const failureCount = (existing?.failureCount ?? 0) + 1

    this.health.set(providerId, {
      providerId,
      lastFailure: now,
      failureCount,
      cooldownUntil: now + COOLDOWN_MS,
    })

    logger.warn({ providerId, failureCount, cooldownUntil: now + COOLDOWN_MS }, 'provider recorded as unhealthy')
  }

  getHealthStatus(): Array<{
    providerId: string
    failureCount: number
    inCooldown: boolean
  }> {
    return Array.from(this.health.values()).map((h) => ({
      providerId: h.providerId,
      failureCount: h.failureCount,
      inCooldown: Date.now() < h.cooldownUntil,
    }))
  }
}

export const providerFallback = new ProviderFallbackManager()
