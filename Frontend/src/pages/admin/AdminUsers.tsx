import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { UserTable } from '../../components/admin/UserTable';
import { TokenGrantForm, type TokenGrantValues } from '../../components/admin/TokenGrantForm';
import { CreateUserForm, type CreateUserFormValues } from '../../components/admin/CreateUserForm';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { PostStatusBadge } from '../../components/user/PostCard';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import type { PlatformUser, Post, TokenTransaction } from '../../types';
import { formatDate } from '../../utils/format';

function fromApiUser(u: any): PlatformUser {
  return {
    id: u.phone,
    phone: u.phone,
    name: u.name || 'Unknown',
    email: u.email || '',
    packageName: u.packageId || 'Free',
    tokens: u.tokensRemaining || 0,
    status: u.active === 1 ? 'active' : 'inactive',
    joined: u.createdAt?.split('T')[0] || '',
  };
}

const transactionColumns: Array<Column<TokenTransaction>> = [
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

export function AdminUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = React.useState<PlatformUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<PlatformUser | null>(null);
  const [grantOpen, setGrantOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [userTransactions, setUserTransactions] = React.useState<TokenTransaction[]>([]);
  const [packages, setPackages] = React.useState<Array<{ id: string; name: string; tokens: number }>>([]);

  const fetchUsers = async () => {
    try {
      const data = await apiRequest<{ users: any[] }>(endpoints.adminUsers);
      setUsers(data.users.map(fromApiUser));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        notify.error('Session expired', 'Please login again.');
        navigate('/admin/login');
        return;
      }
      notify.error('Failed to load users', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPackages = async () => {
    try {
      const data = await apiRequest<{ packages: any[] }>(endpoints.adminPackages);
      setPackages(data.packages.map((p: any) => ({ id: p.slug || p.id, name: p.name, tokens: p.includedTokens })));
    } catch {
      // ignore
    }
  };

  React.useEffect(() => { fetchUsers(); fetchPackages(); }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      u.name.toLowerCase().includes(q) || u.phone.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) || u.packageName.toLowerCase().includes(q)
    );
  }, [users, query]);

  const toggleStatus = async (user: PlatformUser) => {
    try {
      if (user.status === 'active') {
        await apiRequest(endpoints.adminUserDeactivate(user.phone), { method: 'PUT' });
        notify.success('User deactivated', user.name);
      } else {
        await apiRequest(endpoints.adminUserActivate(user.phone), { method: 'PUT' });
        notify.success('User activated', user.name);
      }
      await fetchUsers();
    } catch (err) {
      notify.error('Failed to update user', (err as Error).message);
    }
  };

  const grantTokens = async (values: TokenGrantValues) => {
    if (!selected) return;
    try {
      await apiRequest(endpoints.adminGrantTokens, {
        method: 'POST',
        body: JSON.stringify({ phone: selected.phone, amount: values.amount, description: values.reason }),
      });
      notify.success('Tokens granted', `${values.amount.toLocaleString()} tokens added to ${selected.name}`);
      await fetchUsers();
    } catch (err) {
      notify.error('Failed to grant tokens', (err as Error).message);
    }
    setGrantOpen(false);
  };

  const viewUser = async (user: PlatformUser) => {
    setSelected(user);
    try {
      const data = await apiRequest<{ transactions: any[] }>(endpoints.adminUserTransactions(user.phone));
      setUserTransactions(data.transactions.map((t: any) => ({
        id: t.id,
        date: t.createdAt?.split('T')[0] || '',
        description: t.description,
        amount: t.type === 'grant' ? t.amount : -t.amount,
        balance: t.balanceAfter,
      })));
    } catch {
      setUserTransactions([]);
    }
  };

  const createUser = async (values: CreateUserFormValues) => {
    try {
      const pkg = packages.find(p => p.id === values.packageId);
      await apiRequest(endpoints.adminCreateUser, {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          password: values.password || undefined,
          packageId: values.packageId || undefined,
          tokens: (pkg?.tokens || 0) + (values.tokens || 0),
        }),
      });
      notify.success('User created', `${values.name} has been created`);
      await fetchUsers();
    } catch (err) {
      notify.error('Failed to create user', (err as Error).message);
    }
    setCreateOpen(false);
  };

  return (
    <AdminLayout>
      <AdminHeader
        title="User Management"
        description={`${users.length} registered accounts.`}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" /> Create user
          </Button>
        }
      />

      <div className="mb-6">
        <label htmlFor="user-search" className="sr-only">Search users</label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input id="user-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone, email or package"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <UserTable users={filtered} onView={viewUser} onToggleStatus={toggleStatus} />
      )}

      <Modal open={selected !== null && !grantOpen} onClose={() => setSelected(null)} title={selected?.name ?? 'User'}
        description={selected?.email} size="xl"
        footer={selected && (
          <>
            <Button variant="secondary" onClick={() => setGrantOpen(true)}>Grant tokens</Button>
            <Button variant={selected.status === 'active' ? 'danger' : 'primary'} onClick={() => toggleStatus(selected)}>
              {selected.status === 'active' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </>
        )}>
        {selected && (
          <div className="space-y-8">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { label: 'Phone', value: selected.phone, mono: true },
                { label: 'Email', value: selected.email || 'N/A' },
                { label: 'Package', value: selected.packageName },
                { label: 'Tokens', value: selected.tokens.toLocaleString(), mono: true },
                { label: 'Joined', value: selected.joined },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                  <dt className="text-xs text-slate-500">{item.label}</dt>
                  <dd className={item.mono ? 'font-mono text-sm font-semibold text-slate-900 dark:text-slate-50' : 'text-sm font-semibold text-slate-900 dark:text-slate-50'}>
                    {item.value}
                  </dd>
                </div>
              ))}
              <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                <dt className="text-xs text-slate-500">Status</dt>
                <dd className="mt-1">
                  <Badge tone={selected.status === 'active' ? 'emerald' : 'slate'}>{selected.status}</Badge>
                </dd>
              </div>
            </dl>

            <section aria-labelledby="tx-heading">
              <h3 id="tx-heading" className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-50">Token transactions</h3>
              <DataTable columns={transactionColumns} rows={userTransactions} rowKey={(t) => t.id} caption="Token transactions for this user" emptyMessage="No transactions yet." />
            </section>
          </div>
        )}
      </Modal>

      <Modal open={grantOpen} onClose={() => setGrantOpen(false)} title="Grant tokens" description="Grants are recorded in the audit log." size="md">
        {selected && (
          <TokenGrantForm userName={selected.name} currentTokens={selected.tokens} onSubmit={grantTokens} onCancel={() => setGrantOpen(false)} />
        )}
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create user" description="Add a new user to the platform." size="lg">
        <CreateUserForm packages={packages} onSubmit={createUser} onCancel={() => setCreateOpen(false)} />
      </Modal>
    </AdminLayout>
  );
}
