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
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import { Pagination } from '../../components/ui/Pagination';
import type { PlatformUser } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

const PAGE_SIZE = 10;

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

export function AdminUsers() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [users, setUsers] = React.useState<PlatformUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<PlatformUser | null>(null);
  const [grantOpen, setGrantOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<PlatformUser | null>(null);
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

  const paginated = React.useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const onQueryChange = (value: string) => {
    setQuery(value);
    setPage(1);
  };

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

  const deleteUser = async () => {
    if (!pendingDelete) return;
    try {
      await apiRequest(endpoints.adminUserDelete(pendingDelete.phone), { method: 'DELETE' });
      notify.success('User deleted', `${pendingDelete.name} was removed`);
      setPendingDelete(null);
      setSelected(null);
      await fetchUsers();
    } catch (err) {
      notify.error('Failed to delete user', (err as Error).message);
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

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const grant = params.get('grant');
    if (grant) {
      const user = users.find((u) => u.phone === grant);
      if (user) {
        setSelected(user);
        setGrantOpen(true);
      }
      params.delete('grant');
      window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`);
    }
  }, [users]);

  const viewUser = async (user: PlatformUser) => {
    navigate(`/admin/users/${user.phone}`);
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
          hasPermission('users.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="h-4 w-4" aria-hidden="true" /> Create user
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6">
        <label htmlFor="user-search" className="sr-only">Search users</label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input id="user-search" type="search" value={query} onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by name, phone, email or package"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <>
          <UserTable users={paginated} onView={viewUser} onToggleStatus={toggleStatus} onDelete={setPendingDelete} />
          <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </>
      )}

      <Modal open={grantOpen} onClose={() => setGrantOpen(false)} title="Grant tokens" description="Grants are recorded in the audit log." size="md">
        {selected && (
          <TokenGrantForm userName={selected.name} currentTokens={selected.tokens} onSubmit={grantTokens} onCancel={() => setGrantOpen(false)} />
        )}
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create user" description="Add a new user to the platform." size="lg">
        <CreateUserForm packages={packages} onSubmit={createUser} onCancel={() => setCreateOpen(false)} />
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete user?"
        description="This removes the account and all remaining tokens."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={deleteUser}>Delete user</Button>
          </>
        }>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Are you sure you want to delete <span className="font-semibold">{pendingDelete?.name}</span> ({pendingDelete?.email || pendingDelete?.phone})?
          This action cannot be undone.
        </p>
      </Modal>
    </AdminLayout>
  );
}
