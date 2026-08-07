import React from 'react';
import { cn } from '../../utils/cn';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  emptyMessage?: string;
}

export function DataTable<T>({ columns, rows, rowKey, caption, emptyMessage = 'Nothing here yet.' }: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center">
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      </div>);

  }

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-slate-50 dark:bg-slate-900/60">
            <tr>
              {columns.map((col) =>
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap',
                  col.className
                )}>
                
                  {col.header}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
            {rows.map((row) =>
            <tr key={rowKey(row)} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
                {columns.map((col) =>
              <td key={col.key} className={cn('px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300', col.className)}>
                    {col.render(row)}
                  </td>
              )}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="md:hidden space-y-3">
        {rows.map((row) =>
        <li
          key={rowKey(row)}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          
            <dl className="space-y-2">
              {columns.map((col) =>
            <div key={col.key} className="flex items-start justify-between gap-4">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 shrink-0">{col.header}</dt>
                  <dd className="text-sm text-slate-700 dark:text-slate-300 text-right">{col.render(row)}</dd>
                </div>
            )}
            </dl>
          </li>
        )}
      </ul>
    </>);

}