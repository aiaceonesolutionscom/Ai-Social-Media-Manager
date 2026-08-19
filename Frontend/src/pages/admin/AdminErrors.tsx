import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCwIcon, Trash2Icon, AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';

interface ErrorRow {
  id: string;
  source: string;
  message: string;
  stack?: string;
  details: Record<string, unknown>;
  resolved: boolean;
  resolvedAt?: string;
  lastSeenAt: string;
  createdAt: string;
}

export function AdminErrors() {
  const navigate = useNavigate();
  const [logs, setLogs] = React.useState<ErrorRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [source, setSource] = React.useState('');
  const [resolvedFilter, setResolvedFilter] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [clearing, setClearing] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const limit = 50;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (source) params.set('source', source);
      if (resolvedFilter) params.set('resolved', resolvedFilter);
      params.set('page', String(page));
      params.set('limit', String(limit));
      const data = await apiRequest<{ logs: ErrorRow[]; total: number }>(`${endpoints.adminErrors}?${params.toString()}`);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        notify.error('Session expired', 'Please login again.');
        navigate('/admin/login');
        return;
      }
      notify.error('Failed to load error log', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { fetchLogs(); }, [source, resolvedFilter, page]);

  const toggleResolve = async (log: ErrorRow) => {
    try {
      await apiRequest(endpoints.adminErrorResolve(log.id), {
        method: 'PATCH',
        body: JSON.stringify({ resolved: !log.resolved }),
      });
      notify.success(log.resolved ? 'Marked unresolved' : 'Marked resolved', log.resolved ? 'This error is now open again.' : 'This error has been resolved.');
      await fetchLogs();
    } catch (err) {
      notify.error('Failed to update', (err as Error).message);
    }
  };

  const applyFilters = () => {
    setPage(1);
    fetchLogs();
  };

  const clearAll = async () => {
    if (!confirm('Delete ALL recorded errors? This cannot be undone.')) return;
    setClearing(true);
    try {
      await apiRequest(endpoints.adminErrors, { method: 'DELETE' });
      notify.success('Error log cleared');
      setLogs([]);
      setTotal(0);
    } catch (err) {
      notify.error('Failed to clear', (err as Error).message);
    } finally {
      setClearing(false);
    }
  };

  const sourceTone = (s: string): 'slate' | 'red' | 'amber' | 'indigo' => {
    if (s === 'uncaught' || s === 'unhandled') return 'red';
    if (s === 'whatsapp' || s === 'meta') return 'amber';
    return 'slate';
  };

  const columns: Array<Column<ErrorRow>> = [
    {
      key: 'time', header: 'Time',
      render: (l) => (
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {new Date(l.createdAt).toLocaleDateString()}
          </p>
          <p className="font-mono text-xs text-slate-500">{new Date(l.createdAt).toLocaleTimeString()}</p>
        </div>
      ),
    },
    {
      key: 'source', header: 'Source',
      render: (l) => <Badge tone={sourceTone(l.source)}>{l.source}</Badge>,
    },
    {
      key: 'status', header: 'Status',
      render: (l) => l.resolved ? (
        <Badge tone="emerald"><CheckCircle2Icon className="mr-1 h-3 w-3" /> Resolved</Badge>
      ) : (
        <Badge tone="red"><AlertTriangleIcon className="mr-1 h-3 w-3" /> Open</Badge>
      ),
    },
    {
      key: 'message', header: 'Message',
      render: (l) => (
        <button
          type="button"
          onClick={() => setExpanded(expanded === l.id ? null : l.id)}
          className="block max-w-md text-left text-sm text-slate-700 hover:text-indigo-600 dark:text-slate-300"
        >
          <span className="line-clamp-2 font-medium">{l.message}</span>
        </button>
      ),
    },
    {
      key: 'details', header: 'Details',
      render: (l) => {
        const keys = Object.keys(l.details || {});
        if (keys.length === 0) return <span className="text-xs text-slate-400">—</span>;
        const preview = keys
          .filter((k) => k !== 'stack' && k !== 'time' && k !== 'level')
          .slice(0, 3)
          .map((k) => `${k}: ${String(l.details[k] ?? '')}`)
          .join(', ');
        return <span className="text-xs text-slate-500">{preview}</span>;
      },
    },
    {
      key: 'trace', header: '',
      render: (l) => (
        <div className="flex justify-end gap-2">
          <Button
            variant={l.resolved ? 'ghost' : 'secondary'}
            size="sm"
            onClick={() => toggleResolve(l)}
          >
            {l.resolved ? 'Reopen' : 'Mark resolved'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setExpanded(expanded === l.id ? null : l.id)}
          >
            {expanded === l.id ? 'Hide' : 'View'}
          </Button>
        </div>
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <AdminLayout>
      <AdminHeader
        title="Error Log"
        description="Runtime errors recorded by the system. Click View to inspect a stack trace."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={fetchLogs}>
              <RefreshCwIcon className="h-4 w-4" aria-hidden="true" /> Refresh
            </Button>
            {total > 0 && (
              <Button variant="danger" onClick={clearAll} loading={clearing}>
                <Trash2Icon className="h-4 w-4" aria-hidden="true" /> Clear all
              </Button>
            )}
          </div>
        }
      />

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <label className="block min-w-40 flex-1">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Source</span>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            placeholder="e.g. app, whatsapp, meta"
          />
        </label>
        <label className="block min-w-40">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Status</span>
          <select
            value={resolvedFilter}
            onChange={(e) => setResolvedFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="">All</option>
            <option value="false">Open</option>
            <option value="true">Resolved</option>
          </select>
        </label>
        <Button onClick={applyFilters}>Apply</Button>
      </div>

      {loading ? (
        <div className="mt-6 space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="mt-6">
            <DataTable columns={columns} rows={logs} rowKey={(l) => l.id} caption={`${total} errors`} emptyMessage="No errors recorded yet. Nice and clean." />
          </div>

          {expanded && logs.some((l) => l.id === expanded) && (
            (() => {
              const log = logs.find((l) => l.id === expanded)!;
              return (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-500/30 dark:bg-red-500/5">
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
                    <AlertTriangleIcon className="h-4 w-4" /> {log.message}
                  </p>
                  {log.stack ? (
                    <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-200">
                      {log.stack}
                    </pre>
                  ) : (
                    <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-200">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })()
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-slate-500">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
}