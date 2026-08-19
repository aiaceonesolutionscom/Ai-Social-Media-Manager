import React from 'react';
import { BellIcon, CheckCheckIcon } from 'lucide-react';
import { apiRequest, endpoints } from '../../utils/api';
import { cn } from '../../utils/cn';

interface AdminNotification {
  id: string;
  title: string;
  body: string;
  category: string;
  isRead: boolean;
  createdAt: string;
}

interface AdminHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function AdminHeader({ title, description, action }: AdminHeaderProps) {
  const [open, setOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const fetchNotifications = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{ notifications: AdminNotification[]; unreadCount: number }>(endpoints.adminNotifications);
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // Keep last state; degrade gracefully without a live backend.
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  React.useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchNotifications();
  };

  const markRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await apiRequest(endpoints.adminNotificationRead(id), { method: 'POST' });
    } catch {
      // Ignore
    }
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      await apiRequest(endpoints.adminNotificationsReadAll, { method: 'POST' });
    } catch {
      // Ignore
    }
  };

  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative" ref={containerRef}>
          <button
            type="button"
            aria-label="Notifications"
            onClick={toggleOpen}
            className="relative hidden h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 sm:grid dark:border-slate-800 dark:bg-slate-900">

            <BellIcon className="h-4 w-4" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute right-2.5 top-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Notifications</p>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    <CheckCheckIcon className="h-3.5 w-3.5" /> Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {loading && notifications.length === 0 ? (
                  <p className="p-4 text-center text-sm text-slate-400">Loading…</p>
                ) : notifications.length === 0 ? (
                  <p className="p-4 text-center text-sm text-slate-400">No notifications yet.</p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      className={cn(
                        'block w-full border-b border-slate-50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800',
                        !n.isRead && 'bg-indigo-50/50 dark:bg-indigo-500/5',
                      )}
                    >
                      <p className={cn('text-sm font-medium text-slate-900 dark:text-slate-50', !n.isRead && 'font-semibold')}>
                        {n.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        {action}
      </div>
    </header>);

}