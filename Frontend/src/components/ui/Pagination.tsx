import React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
}

export function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  const pages = React.useMemo(() => {
    const out: number[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - current) <= 1) {
        out.push(i);
      }
    }
    const withGaps: Array<number | '…'> = [];
    for (let i = 0; i < out.length; i++) {
      if (i > 0 && out[i] - out[i - 1] > 1) withGaps.push('…');
      withGaps.push(out[i]);
    }
    return withGaps;
  }, [totalPages, current]);

  if (total <= pageSize) return null;

  return (
    <div className="mt-6 flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-xs text-slate-500" aria-live="polite">
        Showing <span className="font-medium text-slate-700 dark:text-slate-200">{from}–{to}</span> of{' '}
        <span className="font-medium text-slate-700 dark:text-slate-200">{total}</span>
      </p>

      <nav aria-label="Pagination" className="flex items-center gap-1">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
          aria-label="Previous page"
          className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
        </button>

        <ul className="hidden items-center gap-1 sm:flex">
          {pages.map((p, i) =>
            p === '…' ? (
              <li key={`gap-${i}`} className="px-1 text-xs text-slate-400">…</li>
            ) : (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => onPageChange(p)}
                  aria-current={p === current ? 'page' : undefined}
                  className={cn(
                    'grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-medium transition-colors',
                    p === current
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  )}
                >
                  {p}
                </button>
              </li>
            )
          )}
        </ul>

        <span className="px-2 text-xs text-slate-500 sm:hidden">
          {current} / {totalPages}
        </span>

        <button
          type="button"
          disabled={current >= totalPages}
          onClick={() => onPageChange(current + 1)}
          aria-label="Next page"
          className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </nav>

      {pageSizeOptions && onPageSizeChange && (
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Show
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          per page
        </label>
      )}
    </div>
  );
}
