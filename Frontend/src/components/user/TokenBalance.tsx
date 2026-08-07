import React from 'react';
import { CoinsIcon } from 'lucide-react';
import { ProgressBar } from '../ui/ProgressBar';

interface TokenBalanceProps {
  tokens: number;
  total: number;
  compact?: boolean;
}

export function TokenBalance({ tokens, total, compact = false }: TokenBalanceProps) {
  const low = tokens / total < 0.2;
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
      <div className="flex items-center gap-2">
        <CoinsIcon className="h-4 w-4 text-amber-500" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Token balance</span>
      </div>
      <p className="mt-2 font-mono text-xl font-bold text-slate-900 dark:text-slate-50">
        {tokens.toLocaleString()}
        <span className="text-sm font-medium text-slate-400"> / {total.toLocaleString()}</span>
      </p>
      <div className="mt-3">
        <ProgressBar value={tokens} max={total} tone={low ? 'amber' : 'indigo'} />
      </div>
      {!compact &&
      <p className="mt-2 text-xs text-slate-500">
          {low ? 'Running low — top up to keep publishing.' : 'Resets on the 1st of each month.'}
        </p>
      }
    </div>);

}