import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3Icon,
  CoinsIcon,
  CreditCardIcon,
  HelpCircleIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PackageIcon,
  SettingsIcon,
  UsersIcon,
  BrainIcon,
  ShieldIcon,
  UserCogIcon,
  ScrollTextIcon } from
'lucide-react';
import { Logo } from '../ui/Logo';
import { notify } from '../ui/Toast';
import { setAuthToken, apiRequest, endpoints } from '../../utils/api';
import { cn } from '../../utils/cn';
import { useAuth } from '../../contexts/AuthContext';

const navItems = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboardIcon, permission: 'dashboard.view' },
  { label: 'Reports', to: '/admin/reports', icon: BarChart3Icon, permission: 'reports.view' },
  { label: 'Packages', to: '/admin/packages', icon: PackageIcon, permission: 'packages.view' },
  { label: 'Top-ups', to: '/admin/topups', icon: CoinsIcon, permission: 'topups.view' },
  { label: 'Users', to: '/admin/users', icon: UsersIcon, permission: 'users.view' },
  { label: 'Payments', to: '/admin/payments', icon: CreditCardIcon, permission: 'payments.view' },
  { label: 'AI Providers', to: '/admin/ai-providers', icon: BrainIcon, permission: 'ai_providers.view' },
  { label: 'Meta Platform', to: '/admin/meta-platform', icon: ShieldIcon, permission: 'meta.view' },
  { label: 'Support', to: '/admin/support', icon: HelpCircleIcon, permission: 'support.view' },
  { label: 'Settings', to: '/admin/settings', icon: SettingsIcon, permission: 'settings.view' },
  { label: 'Admins', to: '/admin/admins', icon: UserCogIcon, permission: 'admins.view' },
  { label: 'Audit Log', to: '/admin/audit', icon: ScrollTextIcon, permission: 'logs.view' },
];


export function AdminSidebar() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

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

  return (
    <>
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="px-2">
          <Logo to="/admin/dashboard" />
          <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-indigo-600 dark:text-indigo-300">
            admin panel
          </p>
        </div>
        <nav aria-label="Admin" className="mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
          <ul className="space-y-1">
            {visibleItems.map((item) =>
            <li key={item.to}>
                <NavLink
                to={item.to}
                className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ?
                  'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' :
                  'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                )
                }>
                
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              </li>
            )}
          </ul>
        </nav>
        <div className="mt-3 shrink-0 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/10">
            
            <LogOutIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      <nav
        aria-label="Admin"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        
        <ul className="flex w-full items-center gap-1 overflow-x-auto no-scrollbar">
          {visibleItems.map((item) =>
          <li key={item.to} className="shrink-0">
              <NavLink
              to={item.to}
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
          <li className="ml-1 shrink-0 border-l border-slate-200 pl-1 dark:border-slate-700">
            <button
              type="button"
              onClick={logout}
              aria-label="Log out"
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
              <LogOutIcon className="h-4 w-4" aria-hidden="true" />
              Log out
            </button>
          </li>
        </ul>
      </nav>
    </>);

}