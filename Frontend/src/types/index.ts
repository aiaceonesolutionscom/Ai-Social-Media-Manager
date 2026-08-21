export type PlatformId = 'instagram' | 'facebook' | 'whatsapp' | 'meta_ads';

export type ConnectionStatus = 'connected' | 'disconnected' | 'pending' | 'error';

export interface Platform {
  id: PlatformId;
  name: string;
  description: string;
  status: ConnectionStatus;
  account?: string;
}

export interface PackageFeature {
  label: string;
  included: boolean;
}

export interface PricingPackage {
  id: string;
  name: string;
  description: string;
  price: number;
  tokens: number;
  popular?: boolean;
  features: PackageFeature[];
  status: 'active' | 'inactive';
  users: number;
  sortOrder: number;
  billingPeriod?: 'monthly' | 'yearly';
  yearlyPrice?: number;
  setupType?: 'none' | 'standard' | 'premium';
}

export interface TopUpBundle {
  id: string;
  tokens: number;
  price: number;
  status: 'active' | 'inactive';
  sortOrder: number;
}

export type PostStatus = 'published' | 'scheduled' | 'draft' | 'failed' | 'partial';

export interface PlatformPublishState {
  status: 'published' | 'failed' | 'skipped';
  permalink?: string;
  error?: string;
}

export interface Post {
  id: string;
  date: string;
  caption: string;
  platform: PlatformId;
  status: PostStatus;
  tokens: number;
  platformStatuses?: Partial<Record<'instagram' | 'facebook', PlatformPublishState>>;
}

export type UserStatus = 'active' | 'inactive';

export interface PlatformUser {
  id: string;
  phone: string;
  name: string;
  email: string;
  packageName: string;
  tokens: number;
  status: UserStatus;
  joined: string;
}

export interface TokenTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  balance: number;
}

export type PaymentStatus = 'succeeded' | 'pending' | 'refunded' | 'failed';
export type PaymentMethod = 'stripe' | 'local' | 'gateway';

export interface Payment {
  id: string;
  date: string;
  user: string;
  plan: string;
  amount: number;
  status: PaymentStatus;
  method?: PaymentMethod;
  referenceId?: string;
  taxPercent?: number;
  mdrPercent?: number;
  taxAmount?: number;
  mdrAmount?: number;
}

export interface ActivityItem {
  id: string;
  type: 'registration' | 'post' | 'upgrade' | 'payment';
  message: string;
  time: string;
}

export interface ChartPoint {
  label: string;
  value: number;
}