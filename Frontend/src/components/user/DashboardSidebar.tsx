import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboardIcon, LogOutIcon, SettingsIcon, ClockIcon, HistoryIcon, ImageIcon, HelpCircleIcon, MessageCircleIcon, CalendarClockIcon, PaletteIcon, UserRoundIcon, BookOpenIcon } from 'lucide-react';
import { Logo } from '../ui/Logo';
import { notify } from '../ui/Toast';
import { cn } from '../../utils/cn';
import { useUserFeatures } from '../../utils/features';
import { useUserAuth } from '../../contexts/UserAuthContext';

const PUBLISHING_FEATURES = ['facebook_publishing', 'instagram_publishing'];

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<any>;
  feature?: string | string[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboardIcon },
  { label: 'Chat', to: '/dashboard/chat', icon: MessageCircleIcon, feature: 'web_chat' },
  { label: 'Approval Queue', to: '/dashboard/approval', icon: ClockIcon, feature: PUBLISHING_FEATURES },
  { label: 'History', to: '/dashboard/history', icon: HistoryIcon, feature: PUBLISHING_FEATURES },
  { label: 'Scheduled', to: '/dashboard/scheduled', icon: CalendarClockIcon, feature: 'scheduled_publishing' },
  { label: 'Media', to: '/dashboard/media', icon: ImageIcon, feature: PUBLISHING_FEATURES },
  { label: 'Support', to: '/dashboard/support', icon: HelpCircleIcon, feature: 'priority_support' },
  { label: 'Branding', to: '/dashboard/branding', icon: PaletteIcon, feature: 'custom_branding' },
  { label: 'Settings', to: '/connect', icon: SettingsIcon },
  { label: 'Guide', to: '/dashboard/guide', icon: BookOpenIcon },
  { label: 'Profile', to: '/dashboard/profile', icon: UserRoundIcon }];


export function DashboardSidebar() {
  const navigate = useNavigate();
  const { hasFeature, anyFeature } = useUserFeatures();

  const visibleItems = navItems.filter((item) => {
    if (!item.feature) return true;
    return Array.isArray(item.feature) ? anyFeature(item.feature) : hasFeature(item.feature);
  });

  const { logout } = useUserAuth();
  const { user } = useUserAuth();

  const handleLogout = async () => {
    await logout();
    notify.success('Signed out', 'You have been logged out of EchoPost.');
    navigate('/login', { replace: true });
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <Logo />
        <nav aria-label="Dashboard" className="mt-8 flex-1 overflow-y-auto">
          <ul className="space-y-1">
            {visibleItems.map((item) =>
            <li key={item.label}>
                <NavLink
                to={item.to}
                end
                className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ?
                  'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' :
                  'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                )
                }>
                
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            )}
          </ul>
        </nav>
        <div className="space-y-4">
          {user?.packageName && (
            <button
              type="button"
              onClick={() => navigate('/packages')}
              className="flex w-full items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
              title="Upgrade or buy more credits"
            >
              <span>Plan: {user.packageName}</span>
              <span className="font-mono text-[10px] uppercase">+ credits</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/10">
            
            <LogOutIcon className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav — horizontally scrollable so every item fits */}
      <nav
        aria-label="Dashboard"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        
        <ul className="flex w-full items-center gap-1 overflow-x-auto px-2 py-2 no-scrollbar">
          {visibleItems.map((item) =>
          <li key={item.label} className="shrink-0">
              <NavLink
              to={item.to}
              end
              className={({ isActive }) =>
              cn(
                'flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium transition-colors whitespace-nowrap',
                isActive ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'text-slate-500'
              )
              }>
              
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          )}
          <li className="shrink-0">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium text-slate-500">
              
              <LogOutIcon className="h-4 w-4" aria-hidden="true" />
              Log out
            </button>
          </li>
        </ul>
      </nav>
    </>);

}

