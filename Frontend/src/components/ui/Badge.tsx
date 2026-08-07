import React from 'react';
import { cn } from '../../utils/cn';

export type BadgeTone = 'indigo' | 'emerald' | 'amber' | 'red' | 'slate';

const tones: Record<BadgeTone, string> = {
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20',
  emerald:
  'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
  amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
  red: 'bg-red-50 text-red-700 border-red-100 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20',
  slate: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
};

export function Badge({
  children,
  tone = 'slate',
  className




}: {children: React.ReactNode;tone?: BadgeTone;className?: string;}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize',
        tones[tone],
        className
      )}>
      
      {children}
    </span>);

}