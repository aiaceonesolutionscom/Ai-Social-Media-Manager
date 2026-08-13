import { getUser, getPackage, resolveUserPhone } from '../store.js'
import { isPackageExpired } from './packageLifecycle.js'

const CACHE_TTL_MS = 30_000

interface FeatureCacheEntry {
  features: Record<string, boolean>
  expiresAt: number
}

const featureCache = new Map<string, FeatureCacheEntry>()

function getCachedFeatures(phone: string): Record<string, boolean> | null {
  const entry = featureCache.get(phone)
  if (entry && entry.expiresAt > Date.now()) {
    return entry.features
  }
  featureCache.delete(phone)
  return null
}

function setCachedFeatures(phone: string, features: Record<string, boolean>): void {
  featureCache.set(phone, { features, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function clearFeatureCache(phone?: string): void {
  if (phone) {
    featureCache.delete(phone)
  } else {
    featureCache.clear()
  }
}

export async function getUserFeatures(phone: string): Promise<Record<string, boolean>> {
  const cached = getCachedFeatures(phone)
  if (cached) return cached

  const userPhone = await resolveUserPhone(phone)
  const user = await getUser(userPhone)
  if (!user || !user.packageId) {
    return {}
  }

  // Expired or manually-ended packages are locked — no features until renewed.
  if (isPackageExpired(user)) {
    setCachedFeatures(phone, {})
    return {}
  }

  const pkg = await getPackage(user.packageId)
  const features = (pkg?.features ?? {}) as Record<string, boolean>
  setCachedFeatures(phone, features)
  return features
}

export async function checkPackageFeature(phone: string, feature: string): Promise<boolean> {
  const features = await getUserFeatures(phone)
  return features[feature] === true
}

export class FeatureNotIncludedError extends Error {
  feature: string
  constructor(feature: string) {
    super(`This feature is not included in your current package. Please upgrade your subscription to access ${feature}.`)
    this.name = 'FeatureNotIncludedError'
    this.feature = feature
  }
}

export async function requireFeature(phone: string, feature: string): Promise<void> {
  const hasFeature = await checkPackageFeature(phone, feature)
  if (!hasFeature) {
    throw new FeatureNotIncludedError(feature)
  }
}

export async function requireAnyFeature(phone: string, features: string[]): Promise<void> {
  for (const feature of features) {
    if (await checkPackageFeature(phone, feature)) {
      return
    }
  }
  throw new FeatureNotIncludedError(features.join(' or '))
}
