import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLinkIcon } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { Card } from '../components/ui/Card';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';
import { PostStatusBadge, PlatformPublishBadges } from '../components/user/PostCard';
import { apiRequest, endpoints } from '../utils/api';
import { Pagination } from '../components/ui/Pagination';
import { useUserAuth } from '../contexts/UserAuthContext';
import { formatDate } from '../utils/format';
import type { PostStatus, PlatformPublishState } from '../types';

const PAGE_SIZE = 10;

interface Post {
  id: string;
  date: string;
  caption: string;
  platform: string;
  status: PostStatus;
  permalink?: string;
  image?: string;
  platformStatuses?: Partial<Record<'instagram' | 'facebook', PlatformPublishState>>;
}

export function PublishingHistory() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useUserAuth();
  const [posts, setPosts] = React.useState<Post[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Post | null>(null);

  const paginated = React.useMemo(() => posts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [posts, page]);

  React.useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    async function fetchData() {
      try {
        const postData = await apiRequest<{ posts: any[] }>(endpoints.posts);
        if (postData.posts) {
          const published = postData.posts
            .filter((p: any) => p.status === 'DONE' || p.status === 'PARTIAL_SUCCESS' || p.status === 'FAILED')
            .map((p: any) => ({
              id: p.id,
              date: p.createdAt?.split('T')[0] || '',
              caption: p.content?.caption || p.transcript || 'Draft post',
              platform: 'instagram',
              status: (p.status === 'DONE' ? 'published' : p.status === 'PARTIAL_SUCCESS' ? 'partial' : 'failed') as PostStatus,
              permalink: p.permalink,
              image: p.imageUrl || undefined,
              platformStatuses: p.platformStatuses || undefined,
            }));
          setPosts(published);
        }
      } catch {
        // use fallback
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isAuthenticated, authLoading, navigate]);

  const columns: Array<Column<Post>> = [
    { key: 'date', header: 'Date', render: (p) => <span className="whitespace-nowrap">{formatDate(p.date)}</span> },
    {
      key: 'caption', header: 'Caption',
      render: (p) => <span className="block max-w-xs truncate text-slate-900 dark:text-slate-100 md:max-w-md">{p.caption}</span>
    },
    { key: 'status', header: 'Status', render: (p) => p.platformStatuses && Object.keys(p.platformStatuses).length > 1
      ? <PlatformPublishBadges statuses={p.platformStatuses} />
      : <PostStatusBadge status={p.status} /> },
    {
      key: 'actions', header: 'Link',
      render: (p) => p.permalink ? (
        <a href={p.permalink} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 text-sm font-medium">
          <ExternalLinkIcon className="h-3.5 w-3.5" /> View post
        </a>
      ) : <span className="text-xs text-slate-400">—</span>
    }
  ];

  return (
    <DashboardLayout>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Publishing History</h1>
        <p className="mt-1 text-sm text-slate-500">All your published and failed posts.</p>
      </header>

      <Card as="section" hoverable={false}>
        {loading ? (
          <div className="space-y-4 p-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={paginated}
              rowKey={(p) => p.id}
              caption="Your publishing history"
              emptyMessage="No published posts yet."
              onRowClick={(p) => setSelected(p)}
            />
            <div className="p-6 pt-0">
              <Pagination page={page} total={posts.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </div>
          </>
        )}
      </Card>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Post details"
        description={selected ? formatDate(selected.date) : undefined}
      >
        {selected && (
          <div className="space-y-5">
            {selected.image && (
              <img
                src={selected.image}
                alt="Post creative"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 object-cover"
              />
            )}
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Caption</h3>
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{selected.caption}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Status</h3>
                {selected.platformStatuses && Object.keys(selected.platformStatuses).length > 1
                  ? <PlatformPublishBadges statuses={selected.platformStatuses} />
                  : <PostStatusBadge status={selected.status} />}
              </div>
              {selected.permalink && (
                <a
                  href={selected.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  <ExternalLinkIcon className="h-3.5 w-3.5" /> View on platform
                </a>
              )}
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
}
