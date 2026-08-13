import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboardIcon, ClockIcon, HistoryIcon, ImageIcon, HelpCircleIcon, MessageCircleIcon, CalendarClockIcon, PaletteIcon, UserRoundIcon, BookOpenIcon, PlugIcon } from 'lucide-react';
import { Logo } from '../ui/Logo';
import { notify } from '../ui/Toast';
import { useUserFeatures } from '../../utils/features';
import { useUserAuth } from '../../contexts/UserAuthContext';
import { Sidebar, type SidebarNavItem } from '../layout/Sidebar';
import { cn } from '../../utils/cn';

const PUBLISHING_FEATURES = ['facebook_publishing', 'instagram_publishing'];

interface UserNavItem extends SidebarNavItem {
  feature?: string | string[];
}

const navItems: UserNavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboardIcon, end: true },
  { label: 'History', to: '/dashboard/history', icon: HistoryIcon, feature: PUBLISHING_FEATURES },
  { label: 'Chat', to: '/dashboard/chat', icon: MessageCircleIcon, feature: 'web_chat' },
  { label: 'Approval Queue', to: '/dashboard/approval', icon: ClockIcon, feature: PUBLISHING_FEATURES },
  { label: 'Scheduled', to: '/dashboard/scheduled', icon: CalendarClockIcon, feature: 'scheduled_publishing' },
  { label: 'Media', to: '/dashboard/media', icon: ImageIcon, feature: PUBLISHING_FEATURES },
  { label: 'Branding', to: '/dashboard/branding', icon: PaletteIcon, feature: 'custom_branding' },
  { label: 'Support', to: '/dashboard/support', icon: HelpCircleIcon, feature: 'priority_support' },
  { label: 'Guide', to: '/dashboard/guide', icon: BookOpenIcon },
  { label: 'Connect', to: '/connect', icon: PlugIcon },
  { label: 'Profile', to: '/dashboard/profile', icon: UserRoundIcon },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

export function DashboardSidebar() {
  const navigate = useNavigate();
  const { hasFeature, anyFeature } = useUserFeatures();
  const { user, logout } = useUserAuth();

  const visibleItems = navItems.filter((item) => {
    if (!item.feature) return true;
    return Array.isArray(item.feature) ? anyFeature(item.feature) : hasFeature(item.feature);
  });

  const handleLogout = async () => {
    await logout();
    notify.success('Signed out', 'You have been logged out of EchoPost.');
    navigate('/login', { replace: true });
  };

  const brand = (
    <div>
      <Logo />
      <button
        type="button"
        onClick={() => navigate('/dashboard/profile')}
        className="mt-4 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
        title="Open profile"
      >
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
            {initials(user?.name || user?.email || '?')}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{user?.name || 'My account'}</span>
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{user?.email || ''}</span>
        </span>
      </button>
    </div>
  );

  const footer = user?.packageName ? (
    <button
      type="button"
      onClick={() => navigate('/packages')}
      className={cn(
        'flex w-full items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100',
        'dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20'
      )}
      title="Upgrade or buy more credits"
    >
      <span>Plan: {user.packageName}</span>
      <span className="font-mono text-[10px] uppercase">+ credits</span>
    </button>
  ) : undefined;

  return <Sidebar ariaLabel="Dashboard" navItems={visibleItems} brand={brand} footer={footer} onLogout={handleLogout} />;
}
