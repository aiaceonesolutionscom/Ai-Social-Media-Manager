/**
 * API client. Points at the backend defined by VITE_API_URL.
 * Every call degrades gracefully so the UI stays usable without a live backend.
 */

const metaEnv = (import.meta as { env?: { VITE_API_URL?: string } }).env;
export const API_URL = metaEnv?.VITE_API_URL || '';

export const endpoints = {
  packages: '/api/packages',
  meta: '/api/meta',
  tokenCosts: '/api/token-costs',
  userPackage: '/api/user/package',
  checkout: '/api/checkout',
  posts: '/api/posts',
  // Chat
  chatMessages: '/api/chat/messages',
  chat: '/api/chat',
  // User auth
  signup: '/api/auth/signup',
  login: '/api/auth/login',
  clerkBridge: '/api/auth/clerk',
  userMe: '/api/auth/me',
  logout: '/api/auth/logout',
  providers: '/api/auth/providers',
  // Social accounts
  socialAccounts: '/api/social/accounts',
  socialConnect: (platform: string) => `/api/social/connect/${platform}`,
  socialDisconnect: (id: string) => `/api/social/disconnect/${id}`,
  // Admin
  adminLogin: '/api/admin/login',
  adminLogout: '/api/admin/logout',
  adminMe: '/api/admin/me',
  adminStats: '/api/admin/stats',
  adminStatsChart: '/api/admin/stats/chart',
  adminPackages: '/api/admin/packages',
  adminPackage: (id: string) => `/api/admin/packages/${id}`,
  adminDefaultPackage: '/api/admin/packages/default',
  adminUsers: '/api/admin/users',
  adminCreateUser: '/api/admin/users',
  adminUser: (phone: string) => `/api/admin/users/${phone}`,
  adminUserActivate: (phone: string) => `/api/admin/users/${phone}/activate`,
  adminUserDeactivate: (phone: string) => `/api/admin/users/${phone}/deactivate`,
  adminUserTransactions: (phone: string) => `/api/admin/users/${phone}/transactions`,
  adminGrantTokens: '/api/admin/tokens/grant',
  adminGrantPackage: (phone: string) => `/api/admin/users/${phone}/grant-package`,
  adminPayments: '/api/admin/payments',
  adminPaymentStats: '/api/admin/payments/stats',
  adminSettings: '/api/admin/settings',
  adminSettingsApiKeys: '/api/admin/settings/api-keys',
  adminSettingsTest: (integration: string) => `/api/admin/settings/test/${integration}`,
  adminMetaSettings: '/api/admin/meta-settings',
  adminMetaSettingsCategory: (category: string) => `/api/admin/meta-settings/${category}`,
  adminMetaSettingsTest: '/api/admin/meta-settings/test',
  adminMetaSettingsTestIntegration: (integration: string) => `/api/admin/meta-settings/test/${integration}`,
  adminAIProviders: '/api/admin/ai-providers',
  adminAIProvidersActive: '/api/admin/ai-providers/active',
  adminAIProvidersCosts: '/api/admin/ai-providers/costs',
  adminAIProvidersStats: '/api/admin/ai-providers/stats',
  adminAIProvidersHistory: '/api/admin/ai-providers/history',
  // Support
  supportTickets: '/api/support/tickets',
  adminSupportTickets: '/api/admin/support/tickets',
  adminSupportTicketUpdate: (id: string) => `/api/admin/support/tickets/${id}`,
  // Stripe
  stripeWebhook: '/webhooks/stripe',
} as const;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getAuthToken(): string | null {
  return localStorage.getItem('admin_token');
}

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem('admin_token', token);
  } else {
    localStorage.removeItem('admin_token');
  }
}

export function getAdminPhone(): string | null {
  return localStorage.getItem('admin_phone');
}

export function setAdminPhone(phone: string | null) {
  if (phone) {
    localStorage.setItem('admin_phone', phone);
  } else {
    localStorage.removeItem('admin_phone');
  }
}

export function isLoggedIn(): boolean {
  return !!getAuthToken();
}

// User token management (separate from admin)
export function getUserToken(): string | null {
  return localStorage.getItem('user_token');
}

export function setUserToken(token: string | null) {
  if (token) {
    localStorage.setItem('user_token', token);
  } else {
    localStorage.removeItem('user_token');
  }
}

export function isUserLoggedIn(): boolean {
  return !!getUserToken();
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headerRecord = (init?.headers as Record<string, string> | undefined) ?? {};
  const explicit = headerRecord['Authorization']?.replace('Bearer ', '');
  const token = explicit || (path.startsWith('/api/admin') ? getAuthToken() : getUserToken()) || getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headerRecord,
  };
  if (token && !explicit) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.error || `Request to ${path} failed`, response.status);
  }

  return (await response.json()) as T;
}

export function delay(ms = 900): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
