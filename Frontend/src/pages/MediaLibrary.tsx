import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageIcon } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { Card } from '../components/ui/Card';
import { apiRequest, endpoints } from '../utils/api';
import { Pagination } from '../components/ui/Pagination';
import { useUserAuth } from '../contexts/UserAuthContext';
import { formatDate } from '../utils/format';

const PAGE_SIZE = 12;

interface MediaItem {
  id: string;
  imageUrl: string;
  caption: string;
  date: string;
}

export function MediaLibrary() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useUserAuth();
  const [media, setMedia] = React.useState<MediaItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(1);

  const paginated = React.useMemo(() => media.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [media, page]);

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
          const withImages = postData.posts
            .filter((p: any) => p.imageUrl)
            .map((p: any) => ({
              id: p.id,
              imageUrl: p.imageUrl,
              caption: p.content?.caption || p.transcript || '',
              date: p.createdAt?.split('T')[0] || '',
            }));
          setMedia(withImages);
        }
      } catch {
        // use fallback
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isAuthenticated, authLoading, navigate]);

  return (
    <DashboardLayout>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Media Library</h1>
        <p className="mt-1 text-sm text-slate-500">All generated images from your posts.</p>
      </header>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="aspect-square rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <Card as="section" hoverable={false}>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ImageIcon className="h-12 w-12 text-slate-300 mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">No images yet</h3>
            <p className="mt-2 text-sm text-slate-500">Generate your first post on WhatsApp to see images here.</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {paginated.map((item) => (
            <div key={item.id} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100">
              <img
                src={item.imageUrl}
                alt={item.caption.slice(0, 50)}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="text-xs text-white line-clamp-2">{item.caption.slice(0, 80)}</p>
                  <p className="text-xs text-white/70 mt-1">{formatDate(item.date)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-6">
        <Pagination page={page} total={media.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>
    </DashboardLayout>
  );
}
