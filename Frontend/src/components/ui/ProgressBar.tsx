import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../utils/cn';

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  tone?: 'indigo' | 'emerald' | 'amber' | 'red';
  showValue?: boolean;
}

const tones = {
  indigo: 'bg-indigo-600',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-600'
};

export function ProgressBar({ value, max = 100, label, tone = 'indigo', showValue = false }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value / max * 100));
  return (
    <div className="w-full">
      {(label || showValue) &&
      <div className="flex items-center justify-between mb-1.5">
          {label && <span className="text-xs font-medium text-slate-500">{label}</span>}
          {showValue &&
        <span className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300">
              {value.toLocaleString()} / {max.toLocaleString()}
            </span>
        }
        </div>
      }
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={cn('h-full rounded-full', tones[tone])} />
        
      </div>
    </div>);

}