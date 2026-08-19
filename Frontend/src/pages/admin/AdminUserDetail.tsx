import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeftIcon, CoinsIcon, PackageIcon, PaletteIcon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints } from '../../utils/api';
import { formatDate } from '../../utils/format';

interface TxRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  balance: number;
}

interface AuditRow {
  id: string;
  action: string;
  actor: string;
  details: Record<string, unknown>;
  createdAt: string;
}

interface PaymentRow {
  id: string;
  date: string;
  plan: string;
  amount: number;
  status: string;
}

const txColumns: Array<Column<TxRow>> = [
  { key: 'date', header: 'Date', render: (t) => <span className="whitespace-nowrap">{formatDate(t.date)}</span> },
  { key: 'description', header: 'Description', render: (t) => t.description },
  {
    key: 'amount', header: 'Amount',
    render: (t) => <span className={t.amount > 0 ? 'font-mono text-emerald-600' : 'font-mono text-slate-600 dark:text-slate-300'}>
      {t.amount > 0 ? '+' : ''}{t.amount}
    </span>
  },
  { key: 'balance', header: 'Balance', render: (t) => <span className="font-mono">{t.balance.toLocaleString()}</span> }
];

const paymentColumns: Array<Column<PaymentRow>> = [
  { key: 'date', header: 'Date', render: (p) => <span className="whitespace-nowrap">{formatDate(p.date)}</span> },
  { key: 'plan', header: 'Plan', render: (p) => p.plan },
  { key: 'amount', header: 'Amount', render: (p) => <span className="font-mono">${(p.amount / 100).toFixed(2)}</span> },
  { key: 'status', header: 'Status', render: (p) => <Badge tone={p.status === 'completed' ? 'emerald' : 'slate'}>{p.status}</Badge> }
];

export function AdminUserDetail() {
  const { phone = '' } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = React.useState<any>(null);
  const [transactions, setTransactions] = React.useState<TxRow[]>([]);
  const [payments, setPayments] = React.useState<PaymentRow[]>([]);
  const [audit, setAudit] = React.useState<AuditRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [brandingEnabled, setBrandingEnabled] = React.useState(true);

  const load = async () => {
    try {
      const userData = await apiRequest<{ user: any; transactions: any[]; payments: any[]; auditLogs: any[] }>(
        endpoints.adminUserDetail(phone)
      );
      setUser(userData.user);
      const hasCustomBranding = userData.user?.packageFeatures?.custom_branding === true;
      if (hasCustomBranding) {
        try {
          const brandingData = await apiRequest<{ brandingEnabled: boolean }>(endpoints.adminUserBranding(phone));
          setBrandingEnabled(brandingData.brandingEnabled ?? true);
        } catch {
          setBrandingEnabled(true);
        }
      }
      setTransactions(userData.transactions.map((t) => ({
        id: t.id,
        date: t.createdAt?.split('T')[0] || '',
        description: t.description,
        amount: t.type === 'grant' || t.type === 'refund' || t.type === 'bonus' ? t.amount : -Math.abs(t.amount),
        balance: t.balanceAfter,
      })));
      setPayments(userData.payments.map((p) => ({
        id: p.id,
        date: p.createdAt?.split('T')[0] || '',
        plan: p.packageId || p.type || '—',
        amount: p.amountCents,
        status: p.status,
      })));
      setAudit(userData.auditLogs.map((l) => ({
        id: l.id,
        action: l.action,
        actor: l.actor,
        details: l.details || {},
        createdAt: l.createdAt,
      })));
    } catch (err) {
      notify.error('Failed to load user', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, [phone]);

  const statusBadge = () => {
    if (!user) return null;
    const map: Record<string, string> = {
      none: 'slate', active: 'emerald', expired: 'amber', ended: 'red',
    };
    return <Badge tone={(map[user.packageStatus] || 'slate') as any}>{user.packageStatus || 'none'}</Badge>;
  };

  const endPackage = async () => {
    if (!user) return;
    if (!window.confirm(`End ${user.name || user.phone}'s active package? Remaining tokens will be forfeited.`)) return;
    try {
      await apiRequest(endpoints.adminEndPackage(user.phone), { method: 'POST' });
      notify.success('Package ended', `${user.name || user.phone} is now on no package.`);
      await load();
    } catch (err) {
      notify.error('Failed to end package', (err as Error).message);
    }
  };

  const toggleBranding = async (enabled: boolean) => {
    setBrandingEnabled(enabled);
    try {
      await apiRequest(endpoints.adminUserBranding(user.phone), {
        method: 'PUT',
        body: JSON.stringify({ brandingEnabled: enabled }),
      });
      notify.success(
        enabled ? 'Branding enabled' : 'Branding disabled',
        enabled ? 'User branding will be applied to future posts.' : 'User branding will be skipped for future posts.'
      );
    } catch (err) {
      setBrandingEnabled(!enabled); // Revert on error
      notify.error('Failed to update', (err as Error).message);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      </AdminLayout>
    );
  }

  if (!user) {
    return (
      <AdminLayout>
        <p className="text-sm text-slate-500">User not found.</p>
      </AdminLayout>
    );
  }

  const tokensUsed = user.tokensUsed || 0;
  const tokensRemaining = user.tokensRemaining || 0;
  const totalTokens = tokensUsed + tokensRemaining;
  const hasCustomBranding = user?.packageFeatures?.custom_branding === true;

  return (
    <AdminLayout>
      <AdminHeader
        title={user.name || user.phone}
        description={user.email || 'No email on file'}
        action={
          <Button variant="secondary" onClick={() => navigate('/admin/users')}>
            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" /> Back to users
          </Button>
        }
      />

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Phone', value: user.phone, mono: true },
          { label: 'Package', value: user.packageInfo?.name || user.packageName || 'Free', mono: false },
          { label: 'Tokens remaining', value: tokensRemaining.toLocaleString(), mono: true },
          { label: 'Tokens used', value: tokensUsed.toLocaleString(), mono: true },
          { label: 'Total tokens', value: totalTokens.toLocaleString(), mono: true },
          { label: 'Started', value: user.packageStartedAt ? formatDate(user.packageStartedAt.split('T')[0]) : '—', mono: false },
          { label: 'Expires', value: user.packageExpiresAt ? formatDate(user.packageExpiresAt.split('T')[0]) : '—', mono: false },
          { label: 'Joined', value: user.createdAt ? formatDate(user.createdAt.split('T')[0]) : '—', mono: false },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
            <dt className="text-xs text-slate-500">{item.label}</dt>
            <dd className={item.mono ? 'font-mono text-sm font-semibold text-slate-900 dark:text-slate-50' : 'text-sm font-semibold text-slate-900 dark:text-slate-50'}>
              {item.value}
            </dd>
          </div>
        ))}
        <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
          <dt className="text-xs text-slate-500">Package status</dt>
          <dd className="mt-1">{statusBadge()}</dd>
        </div>
      </dl>

      {/* Branding Settings */}
      {hasCustomBranding ? (
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <PaletteIcon className="h-5 w-5 text-indigo-500" />
                Branding on Posts
              </h3>
              <p className="text-sm text-slate-500 mt-1">When enabled, the user's brand logo, colors, and voice will be applied to generated posts. They can still choose per-post in chat.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={brandingEnabled}
                onChange={(e) => toggleBranding(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
            </label>
          </div>
        </Card>
      ) : (
        <Card className="mt-6 border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <PaletteIcon className="h-5 w-5 text-slate-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-500">Branding on Posts</h3>
              <p className="text-xs text-slate-400 mt-0.5">Custom branding is not included in this user's package. Assign a plan with "Custom branding" to manage it.</p>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => navigate(`/admin/users?grant=${user.phone}`)}>
          <CoinsIcon className="h-4 w-4" aria-hidden="true" /> Grant tokens
        </Button>
        {user.packageStatus === 'active' && (
          <Button variant="danger" onClick={endPackage}>
            <PackageIcon className="h-4 w-4" aria-hidden="true" /> End package
          </Button>
        )}
        <Link to={`/admin/packages`}>
          <Button variant="secondary">
            <PackageIcon className="h-4 w-4" aria-hidden="true" /> Assign package
          </Button>
        </Link>
      </div>

      <div className="mt-10 space-y-10">
        <section aria-labelledby="tx-heading">
          <h2 id="tx-heading" className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-50">Token transactions</h2>
          <DataTable columns={txColumns} rows={transactions} rowKey={(t) => t.id} caption="Token transactions" emptyMessage="No transactions yet." />
        </section>

        <section aria-labelledby="pay-heading">
          <h2 id="pay-heading" className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-50">Payments</h2>
          <DataTable columns={paymentColumns} rows={payments} rowKey={(p) => p.id} caption="Payments" emptyMessage="No payments yet." />
        </section>

        <section aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-50">Activity / Audit log</h2>
          {audit.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-slate-800/60">No activity recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {audit.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{entry.action}</p>
                    <p className="truncate text-xs text-slate-500">
                      {entry.actor} · {Object.entries(entry.details).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
