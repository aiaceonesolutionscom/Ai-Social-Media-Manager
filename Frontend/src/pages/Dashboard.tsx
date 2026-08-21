import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpenIcon, CoinsIcon, ExternalLinkIcon, FileTextIcon, InstagramIcon, FacebookIcon, MegaphoneIcon, MessageCircleIcon, SparklesIcon, XIcon
} from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { StatsCard } from '../components/ui/StatsCard';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { PostStatusBadge, PlatformPublishBadges } from '../components/user/PostCard';
import { PlatformStatusBadge, platformIcons } from '../components/user/PlatformStatus';
import { UsageChart } from '../components/user/UsageChart';
import { RequireFeature } from '../components/RequireFeature';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';
import type { Post } from '../types';
import { formatDate } from '../utils/format';
import { cn } from '../utils/cn';

const fallbackPosts: Post[] = [];

type PlatformFilter = 'all' | 'instagram' | 'facebook';

export function Dashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading, endPackage } = useUserAuth();
  const [posts, setPosts] = React.useState<Post[]>(fallbackPosts);
  const [platforms, setPlatforms] = React.useState<Array<{ id: string; name: string; status: string; account?: string }>>([]);
  const [accounts, setAccounts] = React.useState<any[]>([]);
  const [whatsappNumber, setWhatsappNumber] = React.useState('');
  const [features, setFeatures] = React.useState<Record<string, boolean>>({});
  const [metaAdsCount, setMetaAdsCount] = React.useState(0);
  const [platformFilter, setPlatformFilter] = React.useState<PlatformFilter>('all');
  const [tokens, setTokens] = React.useState(0);
  const [totalTokens, setTotalTokens] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const gettingStartedKey = `echopost_getting_started_${user?.phone || 'anon'}`;
  const [showGettingStarted, setShowGettingStarted] = React.useState(() => {
    try {
      return localStorage.getItem(gettingStartedKey) !== 'dismissed';
    } catch {
      return true;
    }
  });

  const dismissGettingStarted = () => {
    setShowGettingStarted(false);
    try {
      localStorage.setItem(gettingStartedKey, 'dismissed');
    } catch {
      // ignore
    }
  };

  const whatsappConnected = accounts.some((a) => a.platform === 'whatsapp' && (a.status === 'active' || a.status === 'connected'));

  const whatsappChatTitle = !whatsappNumber
    ? 'WhatsApp number is not configured by the admin'
    : !whatsappConnected
      ? 'Connect your WhatsApp first'
      : 'Open the bot chat on WhatsApp';

  const openWhatsAppChat = () => {
    if (!whatsappConnected) {
      notify.info('Please connect your WhatsApp number first.');
      navigate('/connect');
      return;
    }
    if (!whatsappNumber) {
      notify.error('WhatsApp number is not configured yet.');
      return;
    }
    const digits = whatsappNumber.replace(/\D/g, '');
    window.open(`https://wa.me/${digits}`, '_blank', 'noopener,noreferrer');
  };

  React.useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) return;

    async function fetchData() {
      try {
        // Fetch user's posts
        const postData = await apiRequest<{ posts: any[] }>(endpoints.posts);
        if (postData.posts) {
          setPosts(postData.posts.map((p: any) => ({
            id: p.id,
            date: p.createdAt?.split('T')[0] || '',
            caption: p.content?.caption || p.transcript || 'Draft post',
            platform: ((p.platforms && p.platforms[0]) || 'instagram') as 'instagram' | 'facebook',
            status: p.status === 'DONE' ? 'published' : p.status === 'PARTIAL_SUCCESS' ? 'partial' : p.status === 'FAILED' ? 'failed' : p.scheduledAt ? 'scheduled' : 'draft',
            tokens: 1,
            platformStatuses: p.platformStatuses || undefined,
          })));
        }

        // Fetch connected social accounts and package features
        const [accounts, pkgData, metaData, adsData] = await Promise.all([
          apiRequest<any[]>(endpoints.socialAccounts).catch(() => []),
          apiRequest<{ features: Record<string, boolean> }>(endpoints.userPackage).catch(() => ({ features: {} })),
          apiRequest<{ whatsapp?: { number?: string } }>(endpoints.meta).catch(() => ({}) as { whatsapp?: { number?: string } }),
          apiRequest<{ campaigns: any[] }>(endpoints.ads).catch(() => ({ campaigns: [] }) as { campaigns: any[] }),
        ]);
        setAccounts(accounts);
        setWhatsappNumber(metaData?.whatsapp?.number || '');
        setMetaAdsCount(adsData.campaigns?.length || 0);

        const features: Record<string, boolean> = (pkgData.features || {}) as Record<string, boolean>;
        setFeatures(features);
        const hasAnyFeature = Object.keys(features).length > 0;

        // Platform-feature mapping
        const PLATFORM_FEATURE_MAP: Record<string, string> = {
          facebook: 'facebook_publishing',
          instagram: 'instagram_publishing',
          meta_ads: 'ad_campaigns',
          whatsapp: 'whatsapp_broadcast',
        };

        const ALL_PLATFORMS = [
          { id: 'facebook', name: 'Facebook', status: 'disconnected' as string },
          { id: 'instagram', name: 'Instagram', status: 'disconnected' as string },
          { id: 'meta_ads', name: 'Meta Ads', status: 'disconnected' as string },
          { id: 'whatsapp', name: 'WhatsApp', status: 'disconnected' as string },
        ];

        // Filter platforms based on package features
        const platformList = ALL_PLATFORMS.filter((p) => {
          const featureKey = PLATFORM_FEATURE_MAP[p.id];
          if (!featureKey) return true;
          if (!hasAnyFeature) return true; // Show all if no features set
          return features[featureKey] === true;
        });

        // Match connected accounts
        for (const acc of accounts) {
          const p = platformList.find(pl => pl.id === acc.platform);
          if (p) {
            p.status = acc.status || 'connected';
          }
        }
        setPlatforms(platformList);
      } catch {
        // use fallback
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isAuthenticated, authLoading]);

  React.useEffect(() => {
    if (user) {
      setTokens(user.tokensRemaining);
      setTotalTokens(user.tokensRemaining + user.tokensUsed);
    }
  }, [user]);

  const hasFeature = (key: string): boolean => {
    if (Object.keys(features).length === 0) return true;
    return features[key] === true;
  };

  const showInstagram = hasFeature('instagram_publishing');
  const showFacebook = hasFeature('facebook_publishing');
  const showMetaAds = hasFeature('ad_campaigns');

  const filteredPosts = React.useMemo(() => {
    if (platformFilter === 'all') return posts;
    return posts.filter((p) => p.platform === platformFilter);
  }, [posts, platformFilter]);

  const onInstagram = (p: Post): boolean => p.platform === 'instagram' || p.platformStatuses?.instagram !== undefined;
  const onFacebook = (p: Post): boolean => p.platform === 'facebook' || p.platformStatuses?.facebook !== undefined;

  const columns: Array<Column<Post>> = [
    { key: 'date', header: 'Date', render: (p) => <span className="whitespace-nowrap">{formatDate(p.date)}</span> },
    {
      key: 'caption', header: 'Caption',
      render: (p) => <span className="block max-w-xs truncate text-slate-900 dark:text-slate-100 md:max-w-md">{p.caption}</span>
    },
    {
      key: 'platform', header: 'Platform',
      render: (p) => {
        const platforms = p.platformStatuses && Object.keys(p.platformStatuses).length > 0
          ? Object.keys(p.platformStatuses)
          : [p.platform];
        return (
          <span className="inline-flex items-center gap-2 capitalize">
            {platforms.map((id) => {
              const Icon = platformIcons[id as keyof typeof platformIcons] ?? platformIcons.instagram;
              return <span key={id} className="inline-flex items-center gap-1"><Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />{id}</span>;
            })}
          </span>
        );
      }
    },
    {
      key: 'status', header: 'Status',
      render: (p) => p.platformStatuses && Object.keys(p.platformStatuses).length > 1
        ? <PlatformPublishBadges statuses={p.platformStatuses} />
        : <PostStatusBadge status={p.status} />
    },
    {
      key: 'actions', header: 'Actions',
      render: (p) => (
        <div className="flex items-center justify-end gap-2 md:justify-start">
          <button type="button" onClick={() => notify.info('Opening post', p.caption.slice(0, 48) + '…')}
            aria-label={`View post from ${formatDate(p.date)}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden="true" /> View
          </button>
        </div>
      )
    }
  ];

  return (
    <DashboardLayout>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {user ? `Welcome back, ${user.name || user.email}!` : "Welcome back! Here's how this month is going."}
          </p>
          {user?.packageName && (
            <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
              Current plan: {user.packageName}
              {user.packageExpiresAt && user.packageStatus === 'active' && (
                <span className="font-normal text-indigo-500 dark:text-indigo-400">
                  · Expires {formatDate(user.packageExpiresAt)}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {user && !user.packageName && (
            <Button variant="secondary" onClick={() => navigate('/packages')}>
              Choose a plan
            </Button>
          )}
          {user?.packageStatus === 'active' && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!window.confirm('End your current package? Remaining tokens will be forfeited.')) return;
                const result = await endPackage();
                if (result.success) {
                  notify.success('Package ended. You can now buy a new plan.');
                } else {
                  notify.error(result.error || 'Failed to end package');
                }
              }}>
              End package
            </Button>
          )}
          <Button onClick={() => navigate('/packages')}>
            <CoinsIcon className="h-4 w-4" aria-hidden="true" /> Buy tokens
          </Button>
        </div>
      </header>

      {(user?.packageStatus === 'expired' || user?.packageStatus === 'ended') && (
        <section aria-labelledby="expired-package-heading" className="mb-8 rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5 dark:border-amber-500/40 dark:from-amber-500/10 dark:to-slate-900">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 id="expired-package-heading" className="text-base font-bold text-slate-900 dark:text-slate-50">
                Your package has {user?.packageStatus === 'expired' ? 'expired' : 'ended'}
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Your features are locked. Renew a package to keep generating and publishing posts.
              </p>
            </div>
            <Button onClick={() => navigate('/packages')}>
              <CoinsIcon className="h-4 w-4" aria-hidden="true" /> Renew package
            </Button>
          </div>
        </section>
      )}

      {showGettingStarted && (
        <section aria-labelledby="getting-started-heading" className="mb-8 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6 dark:border-indigo-500/30 dark:from-indigo-500/10 dark:to-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white">
                <SparklesIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="getting-started-heading" className="text-base font-bold text-slate-900 dark:text-slate-50">
                  {user ? `Welcome back, ${user.name || user.email}!` : 'Welcome to EchoPost!'}
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                  Record a voice note on WhatsApp and EchoPost turns it into a publish-ready post. Approve it, schedule it,
                  or let it go out across your connected channels. Tokens are spent when posts are generated — see the full
                  guide for everything about credits and features.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissGettingStarted}
              aria-label="Dismiss getting started"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-800"
            >
              <XIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button size="sm" onClick={() => navigate('/dashboard/chat')}>
              <MessageCircleIcon className="h-4 w-4" aria-hidden="true" /> Start in Chat
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate('/connect')}>
              <ExternalLinkIcon className="h-4 w-4" aria-hidden="true" /> Connect accounts
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate('/packages')}>
              <CoinsIcon className="h-4 w-4" aria-hidden="true" /> Buy credits
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/dashboard/guide')}>
              <BookOpenIcon className="h-4 w-4" aria-hidden="true" /> Read the full guide
            </Button>
          </div>
        </section>
      )}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard label="Tokens remaining" value={`${tokens} / ${totalTokens}`} icon={CoinsIcon} tone="amber"
          progress={{ value: tokens, max: totalTokens }} index={0} />
        {showInstagram && (
          <StatsCard label="Instagram posts" value={String(posts.filter(onInstagram).length)} icon={InstagramIcon} tone="indigo" index={1} />
        )}
        {showFacebook && (
          <StatsCard label="Facebook posts" value={String(posts.filter(onFacebook).length)} icon={FacebookIcon} tone="emerald" index={2} />
        )}
        {showMetaAds && (
          <StatsCard label="Meta Ads" value={String(metaAdsCount)} icon={MegaphoneIcon} tone="slate" index={3} />
        )}
        {!showInstagram && !showFacebook && (
          <StatsCard label="Total posts" value={String(posts.length)} icon={FileTextIcon} tone="indigo" index={1} />
        )}
      </div>

      <div className="mt-6">
        <RequireFeature phone={user?.phone || ''} feature="analytics_dashboard">
          <Card as="section" hoverable={false}>
            <CardHeader title="Usage overview" />
            <UsageChart
              data={(() => {
                const byDate: Record<string, number> = {};
                posts.forEach(p => {
                  const d = p.date || 'Unknown';
                  byDate[d] = (byDate[d] || 0) + 1;
                });
                const sorted = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).slice(-7);
                return sorted.length > 0 ? sorted.map(([label, value]) => ({ label, value })) : [{ label: 'No data', value: 0 }];
              })()}
              variant="area"
              ariaLabel="Posts usage over time"
            />
          </Card>
        </RequireFeature>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card as="section" hoverable={false} className="lg:col-span-2">
          <CardHeader title="Connected platforms" />
          <ul className="space-y-4">
            {platforms.map((platform) => {
              const Icon = platformIcons[platform.id as keyof typeof platformIcons] || platformIcons.instagram;
              return (
                <li key={platform.id} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                    <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" /> {platform.name}
                    {platform.account && <span className="text-xs text-slate-400">({platform.account})</span>}
                  </span>
                  <PlatformStatusBadge status={platform.status as any} />
                </li>
              );
            })}
          </ul>
          <Button variant="secondary" fullWidth className="mt-6" onClick={() => navigate('/connect')}>
            Manage connections
          </Button>
        </Card>

        <Card as="section" hoverable={false}>
          <CardHeader title="Quick actions" />
          <div className="space-y-3">
            <Button fullWidth onClick={() => navigate('/packages')}>
              <CoinsIcon className="h-4 w-4" aria-hidden="true" /> Buy tokens
            </Button>
            <Button variant="secondary" fullWidth onClick={() => navigate('/connect')}>
              <ExternalLinkIcon className="h-4 w-4" aria-hidden="true" /> Connect platforms
            </Button>
            <Button variant="secondary" fullWidth onClick={openWhatsAppChat} title={whatsappChatTitle}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
              </svg> WhatsApp Chat
            </Button>
          </div>
        </Card>
      </div>

      <section className="mt-6" aria-labelledby="recent-posts-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="recent-posts-heading" className="text-lg font-bold text-slate-900 dark:text-slate-50">Recent posts</h2>
          {(showInstagram || showFacebook) && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
              {([
                { id: 'all' as PlatformFilter, label: 'All' },
                ...(showInstagram ? [{ id: 'instagram' as PlatformFilter, label: 'Instagram' }] : []),
                ...(showFacebook ? [{ id: 'facebook' as PlatformFilter, label: 'Facebook' }] : []),
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPlatformFilter(opt.id)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                    platformFilter === opt.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : (
          <DataTable columns={columns} rows={filteredPosts} rowKey={(p) => p.id} caption="Your most recent posts"
            emptyMessage="No posts yet — send a voice note on WhatsApp to get started!" />
        )}
      </section>
    </DashboardLayout>
  );
}
