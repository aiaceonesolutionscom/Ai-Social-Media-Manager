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
  topupOptions: '/api/topup/options',
  topup: '/api/topup',
  posts: '/api/posts',
  scheduledPosts: '/api/posts/scheduled',
  schedulePost: '/api/posts/schedule',
  cancelScheduledPost: (id: string) => `/api/posts/scheduled/${id}/cancel`,
  reschedulePost: (id: string) => `/api/posts/scheduled/${id}/reschedule`,
  adsScheduled: '/api/ads/scheduled',
  ads: '/api/ads',
  cancelScheduledAd: (id: string) => `/api/ads/scheduled/${id}/cancel`,
  rescheduleAd: (id: string) => `/api/ads/scheduled/${id}/edit`,
  // Chat
  chatMessages: '/api/chat/messages',
  chat: '/api/chat',
  chatThreads: '/api/chat/threads',
  chatThreadsCreate: '/api/chat/threads',
  // User auth
  signup: '/api/auth/signup',
  login: '/api/auth/login',
  clerkBridge: '/api/auth/clerk',
  authExchange: '/api/auth/exchange',
  userMe: '/api/auth/me',
  logout: '/api/auth/logout',
  userProfile: '/api/user/profile',
  userAvatar: '/api/user/avatar',
  userPassword: '/api/user/password',
  preferences: '/api/preferences',
  userEndPackage: '/api/user/package/end',
  // Social accounts
  socialAccounts: '/api/social/accounts',
  socialConnect: (platform: string) => `/api/social/connect/${platform}`,
  socialConnectIntent: '/api/social/connect/intent',
  socialDisconnect: (id: string) => `/api/social/disconnect/${id}`,
  // Admin
  adminLogin: '/api/admin/login',
  adminLogout: '/api/admin/logout',
  adminMe: '/api/admin/me',
  adminProfile: '/api/admin/profile',
  adminStats: '/api/admin/stats',
  adminStatsChart: '/api/admin/stats/chart',
  adminReports: '/api/admin/reports',
  adminPackages: '/api/admin/packages',
  adminPackage: (id: string) => `/api/admin/packages/${id}`,
  adminDefaultPackage: '/api/admin/packages/default',
  adminBillingSummary: '/api/admin/billing/summary',
  adminBillingProfitability: '/api/admin/billing/profitability',
  adminTopUps: '/api/admin/topups',
  adminTopUp: (id: string) => `/api/admin/topups/${id}`,
  adminUsers: '/api/admin/users',
  adminCreateUser: '/api/admin/users',
  adminUserActivate: (phone: string) => `/api/admin/users/${phone}/activate`,
  adminUserDeactivate: (phone: string) => `/api/admin/users/${phone}/deactivate`,
  adminUserDelete: (phone: string) => `/api/admin/users/${phone}`,
  adminGrantTokens: '/api/admin/tokens/grant',
  adminEndPackage: (phone: string) => `/api/admin/users/${phone}/end-package`,
  adminUserDetail: (phone: string) => `/api/admin/users/${phone}/detail`,
  adminUserBranding: (phone: string) => `/api/admin/users/${phone}/branding`,
  adminImpersonate: (phone: string) => `/api/admin/users/${phone}/impersonate`,
  adminAdmins: '/api/admin/admins',
  adminAdmin: (id: string) => `/api/admin/admins/${id}`,
  adminAuditLogs: '/api/admin/audit-logs',
  adminErrors: '/api/admin/errors',
  adminErrorResolve: (id: string) => `/api/admin/errors/${id}/resolve`,
  adminNotifications: '/api/admin/notifications',
  adminNotificationRead: (id: string) => `/api/admin/notifications/${id}/read`,
  adminNotificationsReadAll: '/api/admin/notifications/read-all',
  notifications: '/api/notifications',
  notificationRead: (id: string) => `/api/notifications/${id}/read`,
  notificationsReadAll: '/api/notifications/read-all',
  assistant: '/api/public/assistant',
  adminPayments: '/api/admin/payments',
  adminPaymentMethods: '/api/admin/payments/methods',
  adminSettings: '/api/admin/settings',
  adminSettingsApiKeys: '/api/admin/settings/api-keys',
  adminMetaSettings: '/api/admin/meta-settings',
  adminMetaSettingsTest: '/api/admin/meta-settings/test',
  adminMetaSettingsTestIntegration: (integration: string) => `/api/admin/meta-settings/test/${integration}`,
  adminAIProviders: '/api/admin/ai-providers',
  adminAIProvidersActive: '/api/admin/ai-providers/active',
  adminAIProvidersCosts: '/api/admin/ai-providers/costs',
  adminAIProvidersCostVersions: (provider: string, category: string) => `/api/admin/ai-providers/cost-versions?provider=${encodeURIComponent(provider)}&category=${encodeURIComponent(category)}`,
  adminAIProviderCostVersionApprove: (id: string) => `/api/admin/ai-providers/cost-versions/${encodeURIComponent(id)}/approve`,
  adminAIProviderCostVersionReject: (id: string) => `/api/admin/ai-providers/cost-versions/${encodeURIComponent(id)}/reject`,
  adminAIProvidersStats: '/api/admin/ai-providers/stats',
  adminAIProvidersHistory: '/api/admin/ai-providers/history',
  // Support
  supportTickets: '/api/support/tickets',
  supportTicket: (id: string) => `/api/support/tickets/${id}`,
  supportTicketReply: (id: string) => `/api/support/tickets/${id}/reply`,
  adminSupportTickets: '/api/admin/support/tickets',
  adminSupportTicket: (id: string) => `/api/admin/support/tickets/${id}`,
  adminSupportTicketUpdate: (id: string) => `/api/admin/support/tickets/${id}`,
  adminSupportTicketReply: (id: string) => `/api/admin/support/tickets/${id}/reply`,
  // Branding
  brandProfile: '/api/brand/profile',
  brandLogo: '/api/brand/logo',
  brandSettings: '/api/brand/settings',
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
