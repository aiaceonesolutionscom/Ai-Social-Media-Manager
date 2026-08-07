import React from 'react';
import { ArrowUpCircleIcon, CreditCardIcon, PenLineIcon, UserPlusIcon } from 'lucide-react';
import type { ActivityItem } from '../../types';
import { cn } from '../../utils/cn';

const config: Record<ActivityItem['type'], {icon: React.ComponentType<{className?: string;}>;tone: string;}> = {
  registration: { icon: UserPlusIcon, tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' },
  post: { icon: PenLineIcon, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' },
  upgrade: { icon: ArrowUpCircleIcon, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300' },
  payment: { icon: CreditCardIcon, tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' }
};

export function ActivityFeed({ items }: {items: ActivityItem[];}) {
  return (
    <ul className="space-y-4">
      {items.map((item) => {
        const { icon: Icon, tone } = config[item.type];
        return (
          <li key={item.id} className="flex items-start gap-3">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', tone)}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-slate-700 dark:text-slate-300">{item.message}</p>
              <p className="mt-0.5 font-mono text-xs text-slate-400">{item.time}</p>
            </div>
          </li>);

      })}
    </ul>);

}