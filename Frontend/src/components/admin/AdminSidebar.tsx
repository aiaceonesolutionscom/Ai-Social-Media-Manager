import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  CreditCardIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PackageIcon,
  SettingsIcon,
  UsersIcon } from
'lucide-react';
import { Logo } from '../ui/Logo';
import { notify } from '../ui/Toast';
import { setAuthToken, apiRequest, endpoints } from '../../utils/api';
import { cn } from '../../utils/cn';

const navItems = [
{ label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboardIcon },
{ label: 'Packages', to: '/admin/packages', icon: PackageIcon },
{ label: 'Users', to: '/admin/users', icon: UsersIcon },
{ label: 'Payments', to: '/admin/payments', icon: CreditCardIcon },
{ label: 'Settings', to: '/admin/settings', icon: SettingsIcon }];


export function AdminSidebar() {
  const navigate = useNavigate();

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

  return (
    <>
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <Logo to="/admin/dashboard" />
        <p className="mt-1.5 font-mono text-[11px] uppercase tracking-widest text-indigo-600 dark:text-indigo-300">
          admin panel
        </p>
        <nav aria-label="Admin" className="mt-8 flex-1">
          <ul className="space-y-1">
            {navItems.map((item) =>
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
                
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            )}
          </ul>
        </nav>
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/10">
          
          <LogOutIcon className="h-4 w-4" aria-hidden="true" />
          Log out
        </button>
      </aside>

      <nav
        aria-label="Admin"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 px-1 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        
        <ul className="grid grid-cols-5">
          {navItems.map((item) =>
          <li key={item.to}>
              <NavLink
              to={item.to}
              className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium transition-colors',
                isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500'
              )
              }>
              
                <item.icon className="h-5 w-5" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          )}
        </ul>
      </nav>
    </>);

}