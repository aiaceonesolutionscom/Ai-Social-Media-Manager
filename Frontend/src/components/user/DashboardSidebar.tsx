import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { FileTextIcon, LayoutDashboardIcon, LogOutIcon, SettingsIcon } from 'lucide-react';
import { Logo } from '../ui/Logo';
import { TokenBalance } from './TokenBalance';
import { notify } from '../ui/Toast';
import { cn } from '../../utils/cn';

const navItems = [
{ label: 'Dashboard', to: '/dashboard', icon: LayoutDashboardIcon },
{ label: 'Posts', to: '/dashboard#recent-posts-heading', icon: FileTextIcon },
{ label: 'Settings', to: '/connect', icon: SettingsIcon }];


interface DashboardSidebarProps {
  tokens: number;
  totalTokens: number;
}

export function DashboardSidebar({ tokens, totalTokens }: DashboardSidebarProps) {
  const navigate = useNavigate();

  const logout = () => {
    notify.success('Signed out', 'You have been logged out of EchoPost.');
    navigate('/login');
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <Logo />
        <nav aria-label="Dashboard" className="mt-8 flex-1">
          <ul className="space-y-1">
            {navItems.map((item) =>
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
          <TokenBalance tokens={tokens} total={totalTokens} compact />
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/10">
            
            <LogOutIcon className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Dashboard"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        
        <ul className="grid grid-cols-4">
          {navItems.map((item) =>
          <li key={item.label}>
              <NavLink
              to={item.to}
              end
              className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors',
                isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500'
              )
              }>
              
                <item.icon className="h-5 w-5" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          )}
          <li>
            <button
              type="button"
              onClick={logout}
              className="flex w-full flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium text-slate-500">
              
              <LogOutIcon className="h-5 w-5" aria-hidden="true" />
              Log out
            </button>
          </li>
        </ul>
      </nav>
    </>);

}