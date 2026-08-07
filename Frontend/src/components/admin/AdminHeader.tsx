import React from 'react';
import { BellIcon } from 'lucide-react';
import { notify } from '../ui/Toast';

interface AdminHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function AdminHeader({ title, description, action }: AdminHeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Notifications"
          onClick={() => notify.info('No new notifications', 'You are all caught up.')}
          className="relative hidden h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 sm:grid dark:border-slate-800 dark:bg-slate-900">
          
          <BellIcon className="h-4 w-4" aria-hidden="true" />
          <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-amber-500" />
        </button>
        {action}
      </div>
    </header>);

}