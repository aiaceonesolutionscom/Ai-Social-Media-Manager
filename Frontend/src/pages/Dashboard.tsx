import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRightIcon, CalendarIcon, CoinsIcon, ExternalLinkIcon, FileTextIcon, SendIcon, Trash2Icon
} from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { StatsCard } from '../components/ui/StatsCard';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';
import { PostStatusBadge } from '../components/user/PostCard';
import { PlatformStatusBadge, platformIcons } from '../components/user/PlatformStatus';
import { UsageChart } from '../components/user/UsageChart';
import { RequireFeature } from '../components/RequireFeature';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints, getUserToken } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';
import type { Post } from '../types';
import { formatDate } from '../utils/format';

const fallbackPosts: Post[] = [];

export function Dashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useUserAuth();
  const [posts, setPosts] = React.useState<Post[]>(fallbackPosts);
  const [platforms, setPlatforms] = React.useState<Array<{ id: string; name: string; status: string; account?: string }>>([]);
  const [pendingDelete, setPendingDelete] = React.useState<Post | null>(null);
  const [tokens, setTokens] = React.useState(0);
  const [totalTokens, setTotalTokens] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

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
        };

        const ALL_PLATFORMS = [
          { id: 'facebook', name: 'Facebook', status: 'disconnected' as string },
          { id: 'instagram', name: 'Instagram', status: 'disconnected' as string },
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
    <DashboardLayout tokens={tokens} totalTokens={totalTokens}>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {user ? `Welcome back, ${user.name || user.email}!` : "Welcome back! Here's how this month is going."}
          </p>
        </div>
        <Button onClick={() => navigate('/packages')}>
          <CoinsIcon className="h-4 w-4" aria-hidden="true" /> Buy tokens
        </Button>
      </header>

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
