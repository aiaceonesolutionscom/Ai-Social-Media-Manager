import React from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react';
import { cn } from '../../utils/cn';
import { ProgressBar } from './ProgressBar';

interface StatsCardProps {
  label: string;
  value: string;
  icon: React.ComponentType<{className?: string;}>;
  tone?: 'indigo' | 'emerald' | 'amber' | 'slate';
  change?: {value: string;positive: boolean;};
  progress?: {value: number;max: number;};
  index?: number;
}

const iconTones = {
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
};

export function StatsCard({ label, value, icon: Icon, tone = 'indigo', change, progress, index = 0 }: StatsCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05 }}
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 p-6">
      
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={cn('grid h-9 w-9 place-items-center rounded-xl', iconTones[tone])}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-3 font-mono text-2xl font-bold text-slate-900 dark:text-slate-50">{value}</p>
      {change &&
      <p
        className={cn(
          'mt-2 inline-flex items-center gap-1 text-xs font-semibold',
          change.positive ? 'text-emerald-600' : 'text-red-600'
        )}>
        
          {change.positive ? <ArrowUpRightIcon className="h-3.5 w-3.5" /> : <ArrowDownRightIcon className="h-3.5 w-3.5" />}
          {change.value}
        </p>
      }
      {progress &&
      <div className="mt-4">
          <ProgressBar value={progress.value} max={progress.max} tone={tone === 'slate' ? 'indigo' : tone} />
        </div>
      }
    </motion.div>);

}