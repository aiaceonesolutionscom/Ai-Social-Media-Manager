import React from 'react';
import { apiRequest, endpoints } from './api';

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
