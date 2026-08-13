import React from 'react';
import { NavLink } from 'react-router-dom';
import { LogOutIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface SidebarNavItem {
  label: string;
  to: string;
  icon: React.ComponentType<any>;
  end?: boolean;
}

interface SidebarProps {
  ariaLabel: string;
  navItems: SidebarNavItem[];
  brand?: React.ReactNode;
  footer?: React.ReactNode;
  onLogout: () => void;
  logoutLabel?: string;
}

export function Sidebar({ ariaLabel, navItems, brand, footer, onLogout, logoutLabel = 'Log out' }: SidebarProps) {
  return (
    <>
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        {brand}
        <nav aria-label={ariaLabel} className="mt-6 flex-1 overflow-y-auto">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                        : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-4">
          {footer}
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/10"
          >
            <LogOutIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {logoutLabel}
          </button>
        </div>
      </aside>

      <nav
        aria-label={ariaLabel}
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"
      >
        <ul className="flex w-full items-center gap-1 overflow-x-auto no-scrollbar">
          {navItems.map((item) => (
            <li key={item.to} className="shrink-0">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium transition-colors whitespace-nowrap',
                    isActive
                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300'
                      : 'text-slate-500'
                  )
                }
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
          <li className="ml-1 shrink-0 border-l border-slate-200 pl-1 dark:border-slate-700">
            <button
              type="button"
              onClick={onLogout}
              aria-label="Log out"
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium text-slate-500 dark:text-slate-300"
            >
              <LogOutIcon className="h-4 w-4" aria-hidden="true" />
              {logoutLabel}
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
