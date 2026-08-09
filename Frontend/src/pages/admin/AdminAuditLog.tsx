import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCwIcon, ShieldAlertIcon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';

interface AuditRow {
  id: string;
  actor: string;
  actorType: string;
  action: string;
  target: string | null;
  targetType: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  'admin.login': 'Admin login',
  'admin.logout': 'Admin logout',
  'admin.password_change': 'Password changed',
  'admins.create': 'Admin created',
  'admins.update': 'Admin updated',
  'admins.delete': 'Admin deleted',
  'user.create': 'User created',
  'user.update': 'User updated',
  'user.activate': 'User activated',
  'user.deactivate': 'User deactivated',
  'user.delete': 'User deleted',
  'user.grant_package': 'Package granted',
  'tokens.grant': 'Tokens granted',
  'packages.create': 'Package created',
  'packages.update': 'Package updated',
  'packages.delete': 'Package deleted',
  'packages.set_default': 'Default package changed',
  'topups.create': 'Top-up created',
  'topups.update': 'Top-up updated',
  'topups.delete': 'Top-up deleted',
  'settings.update': 'Settings updated',
  'meta.update': 'Meta settings updated',
  'ai_providers.update': 'AI provider updated',
  'support.reply': 'Support reply',
};

const ACTION_TONES: Record<string, 'slate' | 'emerald' | 'amber' | 'red' | 'indigo'> = {
  'admin.login': 'indigo',
  'user.delete': 'red',
  'admins.delete': 'red',
  'packages.delete': 'red',
  'topups.delete': 'red',
  'user.create': 'emerald',
  'admins.create': 'emerald',
  'user.activate': 'emerald',
  'tokens.grant': 'emerald',
  'settings.update': 'amber',
  'meta.update': 'amber',
  'admins.update': 'amber',
};

function formatDetails(details?: Record<string, unknown>): string {
  if (!details) return '';
  const keys = Object.keys(details);
  if (keys.length === 0) return '';
  if (keys.length === 1) return String(details[keys[0]] ?? '');
  return keys
    .slice(0, 2)
    .map((k) => `${k}: ${String(details[k] ?? '')}`)
    .join(', ');
}

export function AdminAuditLog() {
  const navigate = useNavigate();
  const [logs, setLogs] = React.useState<AuditRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [action, setAction] = React.useState('');
  const [actor, setActor] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const limit = 50;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (actor) params.set('actor', actor);
      params.set('page', String(page));
      params.set('limit', String(limit));
      const data = await apiRequest<{ logs: AuditRow[]; total: number }>(`${endpoints.adminAuditLogs}?${params.toString()}`);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        notify.error('Session expired', 'Please login again.');
        navigate('/admin/login');
        return;
      }
      notify.error('Failed to load audit log', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { fetchLogs(); }, [action, actor, page]);

  const applyFilters = () => {
    setPage(1);
    fetchLogs();
  };

  const columns: Array<Column<AuditRow>> = [
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
      key: 'actor', header: 'Who',
      render: (l) => (
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{l.actor}</p>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">{l.actorType}</p>
        </div>
      ),
    },
    {
      key: 'action', header: 'Action',
      render: (l) => (
        <Badge tone={ACTION_TONES[l.action] || 'slate'}>{ACTION_LABELS[l.action] || l.action}</Badge>
      ),
    },
    {
      key: 'target', header: 'Target',
      render: (l) => <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{l.target || '—'}</span>,
    },
    {
      key: 'details', header: 'Details',
      render: (l) => <span className="text-xs text-slate-500">{formatDetails(l.details)}</span>,
    },
    {
      key: 'ip', header: 'IP',
      render: (l) => <span className="font-mono text-xs text-slate-400">{l.ip || '—'}</span>,
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <AdminLayout>
      <AdminHeader
        title="Audit Log"
        description="Every important action in the admin panel, tracked and timestamped."
        action={
          <Button variant="secondary" onClick={fetchLogs}>
            <RefreshCwIcon className="h-4 w-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <label className="block min-w-40 flex-1">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Action</span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-40 flex-1">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Who</span>
          <input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            placeholder="admin@example.com"
          />
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
            <DataTable columns={columns} rows={logs} rowKey={(l) => l.id} caption={`${total} entries`} emptyMessage="No activity found." />
          </div>
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

      {!loading && logs.length === 0 && (
        <p className="mt-8 flex items-center justify-center gap-2 text-sm text-slate-400">
          <ShieldAlertIcon className="h-4 w-4" /> No events recorded yet.
        </p>
      )}
    </AdminLayout>
  );
}
