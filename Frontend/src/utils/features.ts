import React from 'react';
import { apiRequest, endpoints } from './api';
import type { PackageFeature } from '../types';

export interface FeatureDef {
  key: string;
  label: string;
}

export const FEATURES: FeatureDef[] = [
  { key: 'facebook_publishing', label: 'Facebook publishing' },
  { key: 'instagram_publishing', label: 'Instagram publishing' },
  { key: 'whatsapp_broadcast', label: 'WhatsApp broadcasts' },
  { key: 'web_chat', label: 'Website support chat' },
  { key: 'voice_transcription', label: 'Voice to post transcription' },
  { key: 'scheduled_publishing', label: 'Scheduled auto-publishing' },
  { key: 'analytics_dashboard', label: 'Full analytics dashboard' },
  { key: 'priority_support', label: 'Priority support' },
  { key: 'ad_campaigns', label: 'Meta Ads' },
  { key: 'custom_branding', label: 'Custom branding' },
];

export const FEATURE_KEYS: readonly string[] = FEATURES.map((f) => f.key);

export const FEATURE_OPTIONS: readonly string[] = FEATURES.map((f) => f.label);

export const FEATURE_KEY_MAP: Record<string, string> = Object.fromEntries(FEATURES.map((f) => [f.label, f.key]));

export function featureLabel(key: string): string {
  return FEATURES.find((f) => f.key === key)?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildFeatureList(features: Record<string, boolean>): PackageFeature[] {
  return FEATURE_KEYS.map((key) => ({
    label: featureLabel(key),
    included: features[key] === true,
  }));
}

type Features = Record<string, boolean>;

let cached: Features | null = null;
let cacheTime = 0;
const CACHE_TTL = 30_000;

export async function fetchUserFeatures(force = false): Promise<Features> {
  if (!force && cached && Date.now() - cacheTime < CACHE_TTL) return cached;
  try {
    const data = await apiRequest<{ features: Features }>(endpoints.userPackage);
    cached = data.features || {};
  } catch {
    cached = cached || {};
  }
  cacheTime = Date.now();
  return cached;
}

export interface UserFeatures {
  loading: boolean;
  features: Features;
  hasFeature: (key: string) => boolean;
  anyFeature: (keys: string[]) => boolean;
}

export function useUserFeatures(): UserFeatures {
  const [features, setFeatures] = React.useState<Features>(cached || {});
  const [loading, setLoading] = React.useState(!cached);

  React.useEffect(() => {
    let active = true;
    fetchUserFeatures().then((f) => {
      if (active) setFeatures(f);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return {
    loading,
    features,
    hasFeature: (key: string) => features[key] === true,
    anyFeature: (keys: string[]) => keys.some((k) => features[k] === true),
  };
}
