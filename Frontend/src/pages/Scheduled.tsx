import React from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { BotIcon, CalendarClockIcon, ImagePlusIcon, XCircleIcon } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';
import { useUserFeatures } from '../utils/features';
import { cn } from '../utils/cn';

interface ScheduledPost {
  id: string;
  postId: string;
  publishAt: string;
  status: string;
  caption?: string;
}

interface ScheduledAd {
  id: string;
  name: string;
  publishAt?: string;
  status: string;
  imageUrl?: string;
  adContent?: { primaryText?: string; headline?: string };
}

function formatDateTime(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy h:mm a');
  } catch {
    return iso;
  }
}

export function Scheduled() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useUserAuth();
  const { hasFeature, loading: featuresLoading } = useUserFeatures();
  const [posts, setPosts] = React.useState<ScheduledPost[]>([]);
  const [ads, setAds] = React.useState<ScheduledAd[]>([]);
  const [loadingPosts, setLoadingPosts] = React.useState(false);
  const [loadingAds, setLoadingAds] = React.useState(false);

  const [caption, setCaption] = React.useState('');
  const [publishAt, setPublishAt] = React.useState('');
  const [imageBase64, setImageBase64] = React.useState('');
  const [imageName, setImageName] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const hasSchedule = !featuresLoading && hasFeature('scheduled_publishing');
  const hasAds = !featuresLoading && hasFeature('ad_campaigns');

  const fetchPosts = React.useCallback(async () => {
    if (!hasSchedule) return;
    setLoadingPosts(true);
    try {
      const data = await apiRequest<{ posts: ScheduledPost[] }>(endpoints.scheduledPosts);
      setPosts(data.posts || []);
    } catch (err) {
      if ((err as { status?: number }).status !== 403) {
        notify.error('Failed to load scheduled posts', (err as Error).message);
      }
    } finally {
      setLoadingPosts(false);
    }
  }, [hasSchedule]);

  const fetchAds = React.useCallback(async () => {
    if (!hasSchedule || !hasAds) return;
    setLoadingAds(true);
    try {
      const data = await apiRequest<{ campaigns: ScheduledAd[] }>(endpoints.adsScheduled);
      setAds(data.campaigns || []);
    } catch (err) {
      if ((err as { status?: number }).status !== 403) {
        notify.error('Failed to load scheduled ads', (err as Error).message);
      }
    } finally {
      setLoadingAds(false);
    }
  }, [hasSchedule, hasAds]);

  React.useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    fetchPosts();
    fetchAds();
  }, [isAuthenticated, authLoading, navigate, fetchPosts, fetchAds]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageBase64(reader.result as string);
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const submitSchedule = async () => {
    if (!caption.trim()) {
      notify.error('Caption required', 'Add a caption for the post.');
      return;
    }
    if (!publishAt) {
      notify.error('Time required', 'Pick when the post should be published.');
      return;
    }
    if (!imageBase64) {
      notify.error('Image required', 'Upload an image for the post.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(endpoints.schedulePost, {
        method: 'POST',
        body: JSON.stringify({ caption: caption.trim(), publishAt, imageBase64 }),
      });
      notify.success('Post scheduled', 'Your post will be published automatically.');
      setCaption('');
      setPublishAt('');
      setImageBase64('');
      setImageName('');
      await fetchPosts();
    } catch (err) {
      notify.error('Failed to schedule', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const cancelPost = async (item: ScheduledPost) => {
    try {
      await apiRequest(endpoints.cancelScheduledPost(item.id), { method: 'POST' });
      notify.success('Cancelled', 'Scheduled post cancelled.');
      await fetchPosts();
    } catch (err) {
      notify.error('Failed to cancel', (err as Error).message);
    }
  };

  const cancelAd = async (item: ScheduledAd) => {
    try {
      await apiRequest(endpoints.cancelScheduledAd(item.id), { method: 'POST' });
      notify.success('Cancelled', 'Scheduled ad cancelled.');
      await fetchAds();
    } catch (err) {
      notify.error('Failed to cancel', (err as Error).message);
    }
  };

  const sectionHeader = (icon: React.ReactNode, title: string) => (
    <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
      {icon}
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
    </div>
  );

  return (
    <DashboardLayout>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Scheduled Publishing</h1>
        <p className="mt-1 text-sm text-slate-500">Schedule posts and ads to publish automatically at your chosen time.</p>
      </header>

      <Card as="section" hoverable={false} padded={false} className="mb-6">
        <button
          type="button"
          onClick={() => navigate('/dashboard/chat')}
          className="flex w-full items-center gap-3 px-6 py-4 text-left transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <BotIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">
              Create posts &amp; ads with the AI chatbot
            </span>
            <span className="mt-0.5 block text-sm text-slate-500">
              Chat with the AI to build a post (image + caption), then say "schedule for tomorrow at 5pm" — it will appear below. You can schedule ads the same way.
            </span>
          </span>
          <span className="ml-auto shrink-0 text-sm font-semibold text-indigo-600">Open Chat →</span>
        </button>
      </Card>

      {hasSchedule ? (
        <Card as="section" hoverable={false} padded={false} className="mb-6">
          {sectionHeader(<CalendarClockIcon className="h-5 w-5 text-indigo-600" aria-hidden="true" />, 'Schedule a post')}
          <div className="space-y-4 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:hover:border-indigo-500">
                <ImagePlusIcon className="h-5 w-5" aria-hidden="true" />
                {imageName || 'Upload an image'}
                <input type="file" accept="image/*" className="sr-only" onChange={onFileChange} />
              </label>
              <Input
                label="Publish time"
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)} />
            </div>
            <Textarea
              label="Caption"
              placeholder="Write the caption for your post..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)} />
            <div className="flex justify-end">
              <Button onClick={submitSchedule} loading={submitting}>Schedule post</Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card as="section" hoverable={false} padded={false} className="mb-6">
          <div className="p-6">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              ⚡ Scheduled auto-publishing is not included in your current plan. Upgrade your package to schedule posts.
            </p>
          </div>
        </Card>
      )}

      {hasSchedule && (
        <Card as="section" hoverable={false} padded={false} className="mb-6">
          {sectionHeader(<CalendarClockIcon className="h-5 w-5 text-indigo-600" aria-hidden="true" />, 'Upcoming scheduled posts')}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {loadingPosts ? (
              <div className="space-y-4 p-6">
                {[1, 2].map(i => <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />)}
              </div>
            ) : posts.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No scheduled posts yet.</p>
            ) : (
              posts.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {item.caption || 'Untitled post'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">Publishes {formatDateTime(item.publishAt)}</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => cancelPost(item)}>
                    <XCircleIcon className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {hasSchedule && hasAds && (
        <Card as="section" hoverable={false} padded={false}>
          {sectionHeader(<CalendarClockIcon className="h-5 w-5 text-indigo-600" aria-hidden="true" />, 'Upcoming scheduled ads')}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {loadingAds ? (
              <div className="space-y-4 p-6">
                {[1, 2].map(i => <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />)}
              </div>
            ) : ads.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No scheduled ads yet.</p>
            ) : (
              ads.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {item.name || 'Untitled ad'}
                    </p>
                    <p className={cn('mt-0.5 text-xs', item.publishAt ? 'text-slate-500' : 'text-slate-400')}>
                      {item.publishAt
                        ? `Launches ${formatDateTime(item.publishAt)}`
                        : item.status}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => cancelAd(item)}>
                    <XCircleIcon className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      )}
    </DashboardLayout>
  );
}
