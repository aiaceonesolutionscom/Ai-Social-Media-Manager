import React from 'react';
import { useNavigate } from 'react-router-dom';
import { EyeIcon, ClockIcon } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PostStatusBadge } from '../components/user/PostCard';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';
import { formatDate } from '../utils/format';
import type { PostStatus } from '../types';

interface Post {
  id: string;
  date: string;
  caption: string;
  platform: string;
  status: PostStatus;
  imageUrl?: string;
}

export function ApprovalQueue() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useUserAuth();
  const [posts, setPosts] = React.useState<Post[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tokens, setTokens] = React.useState(0);
  const [totalTokens, setTotalTokens] = React.useState(0);

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
          const pending = postData.posts
            .filter((p: any) => p.status === 'AWAITING_APPROVAL' || p.status === 'CANCELLED')
            .map((p: any) => ({
              id: p.id,
              date: p.createdAt?.split('T')[0] || '',
              caption: p.content?.caption || p.transcript || 'Draft post',
              platform: 'instagram',
              status: (p.status === 'AWAITING_APPROVAL' ? 'draft' : 'draft') as PostStatus,
              imageUrl: p.imageUrl,
            }));
          setPosts(pending);
        }
      } catch {
        // use fallback
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isAuthenticated, authLoading, navigate]);

  React.useEffect(() => {
    if (user) {
      setTokens(user.tokensRemaining);
      setTotalTokens(user.tokensRemaining + user.tokensUsed);
    }
  }, [user]);

  return (
    <DashboardLayout tokens={tokens} totalTokens={totalTokens}>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Approval Queue</h1>
        <p className="mt-1 text-sm text-slate-500">Posts waiting for your approval before publishing.</p>
      </header>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <Card as="section" hoverable={false}>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ClockIcon className="h-12 w-12 text-slate-300 mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">All caught up!</h3>
            <p className="mt-2 text-sm text-slate-500">No posts waiting for approval.</p>
            <Button className="mt-4" onClick={() => navigate('/dashboard')}>
              Back to Dashboard
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <Card key={post.id} as="section" hoverable={false}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                {post.imageUrl && (
                  <img
                    src={post.imageUrl}
                    alt="Post preview"
                    className="h-24 w-24 rounded-lg object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <PostStatusBadge status={post.status} />
                    <span className="text-xs text-slate-400">{formatDate(post.date)}</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2">
                    {post.caption}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => notify.info('Opening post', post.caption.slice(0, 48) + '…')}
                  >
                    <EyeIcon className="h-4 w-4" /> View
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
