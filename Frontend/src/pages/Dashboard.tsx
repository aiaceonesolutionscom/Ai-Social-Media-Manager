import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpenIcon, CalendarIcon, CoinsIcon, ExternalLinkIcon, FileTextIcon, MessageCircleIcon, SendIcon, SparklesIcon, XIcon
} from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { StatsCard } from '../components/ui/StatsCard';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { PostStatusBadge } from '../components/user/PostCard';
import { PlatformStatusBadge, platformIcons } from '../components/user/PlatformStatus';
import { UsageChart } from '../components/user/UsageChart';
import { RequireFeature } from '../components/RequireFeature';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';
import type { Post } from '../types';
import { formatDate } from '../utils/format';

const fallbackPosts: Post[] = [];

export function Dashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading, endPackage } = useUserAuth();
  const [posts, setPosts] = React.useState<Post[]>(fallbackPosts);
  const [platforms, setPlatforms] = React.useState<Array<{ id: string; name: string; status: string; account?: string }>>([]);
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
            platform: 'instagram' as const,
            status: p.status === 'DONE' ? 'published' : p.status === 'FAILED' ? 'failed' : 'draft',
            tokens: 1,
          })));
        }

        // Fetch connected social accounts and package features
        const [accounts, pkgData] = await Promise.all([
          apiRequest<any[]>(endpoints.socialAccounts).catch(() => []),
          apiRequest<{ features: Record<string, boolean> }>(endpoints.userPackage).catch(() => ({ features: {} })),
        ]);

        const features: Record<string, boolean> = (pkgData.features || {}) as Record<string, boolean>;
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

  const columns: Array<Column<Post>> = [
    { key: 'date', header: 'Date', render: (p) => <span className="whitespace-nowrap">{formatDate(p.date)}</span> },
    {
      key: 'caption', header: 'Caption',
      render: (p) => <span className="block max-w-xs truncate text-slate-900 dark:text-slate-100 md:max-w-md">{p.caption}</span>
    },
    {
      key: 'platform', header: 'Platform',
      render: (p) => {
        const Icon = platformIcons[p.platform];
        return (
          <span className="inline-flex items-center gap-2 capitalize">
            <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" /> {p.platform}
          </span>
        );
      }
    },
    { key: 'status', header: 'Status', render: (p) => <PostStatusBadge status={p.status} /> },
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
        <StatsCard label="Total posts" value={String(posts.length)} icon={FileTextIcon} tone="indigo" index={1} />
        <StatsCard label="Published" value={String(posts.filter(p => p.status === 'published').length)} icon={SendIcon} tone="emerald" index={2} />
        <StatsCard label="This month" value={String(posts.length)} icon={CalendarIcon} tone="slate" index={3} />
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
          </div>
        </Card>
      </div>

      <section className="mt-6" aria-labelledby="recent-posts-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="recent-posts-heading" className="text-lg font-bold text-slate-900 dark:text-slate-50">Recent posts</h2>
        </div>
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : (
          <DataTable columns={columns} rows={posts} rowKey={(p) => p.id} caption="Your most recent posts"
            emptyMessage="No posts yet — send a voice note on WhatsApp to get started!" />
        )}
      </section>
    </DashboardLayout>
  );
}
