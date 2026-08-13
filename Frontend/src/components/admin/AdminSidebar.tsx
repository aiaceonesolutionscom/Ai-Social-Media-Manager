import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3Icon,
  CoinsIcon,
  CreditCardIcon,
  HelpCircleIcon,
  LayoutDashboardIcon,
  PackageIcon,
  SettingsIcon,
  UsersIcon,
  BrainIcon,
  ShieldIcon,
  UserCogIcon,
  ScrollTextIcon,
  UserRoundIcon } from
'lucide-react';
import { Logo } from '../ui/Logo';
import { notify } from '../ui/Toast';
import { setAuthToken, apiRequest, endpoints } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { Sidebar, type SidebarNavItem } from '../layout/Sidebar';

const navItems: Array<SidebarNavItem & { permission: string }> = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboardIcon, end: true, permission: 'dashboard.view' },
  { label: 'Audit Log', to: '/admin/audit', icon: ScrollTextIcon, permission: 'logs.view' },
  { label: 'Reports', to: '/admin/reports', icon: BarChart3Icon, permission: 'reports.view' },
  { label: 'Users', to: '/admin/users', icon: UsersIcon, permission: 'users.view' },
  { label: 'Packages', to: '/admin/packages', icon: PackageIcon, permission: 'packages.view' },
  { label: 'Top-ups', to: '/admin/topups', icon: CoinsIcon, permission: 'topups.view' },
  { label: 'Payments', to: '/admin/payments', icon: CreditCardIcon, permission: 'payments.view' },
  { label: 'AI Providers', to: '/admin/ai-providers', icon: BrainIcon, permission: 'ai_providers.view' },
  { label: 'Meta Platform', to: '/admin/meta-platform', icon: ShieldIcon, permission: 'meta.view' },
  { label: 'Admins', to: '/admin/admins', icon: UserCogIcon, permission: 'admins.view' },
  { label: 'Support', to: '/admin/support', icon: HelpCircleIcon, permission: 'support.view' },
  { label: 'Settings', to: '/admin/settings', icon: SettingsIcon, permission: 'settings.view' },
  { label: 'Profile', to: '/admin/profile', icon: UserRoundIcon },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

export function AdminSidebar() {
  const navigate = useNavigate();
  const { hasPermission, adminEmail, adminName } = useAuth();

  const logout = async () => {
    try {
      await apiRequest(endpoints.adminLogout, { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    notify.success('Signed out of the admin panel');
    navigate('/admin/login');
  };

  const visibleItems = navItems.filter((item) => hasPermission(item.permission));

  const brand = (
    <div className="px-1">
      <Logo to="/admin/dashboard" />
      <button
        type="button"
        onClick={() => navigate('/admin/profile')}
        className="mt-3 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
        title="Open profile"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
          {initials(adminName || adminEmail || '?')}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{adminName || 'Admin'}</span>
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{adminEmail || ''}</span>
        </span>
      </button>
    </div>
  );

  return <Sidebar ariaLabel="Admin" navItems={visibleItems} brand={brand} onLogout={logout} />;
}
