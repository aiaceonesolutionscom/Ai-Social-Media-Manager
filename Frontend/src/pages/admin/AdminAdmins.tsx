import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PencilIcon, PlusIcon, Trash2Icon, ShieldCheckIcon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import { cn } from '../../utils/cn';

interface AdminRow {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin';
  permissions: string[];
  isActive: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

const PERMISSION_GROUPS: Array<{ section: string; actions: Array<{ key: string; label: string }> }> = [
  { section: 'Dashboard', actions: [{ key: 'dashboard.view', label: 'View dashboard' }] },
  { section: 'User Management', actions: [
    { key: 'users.view', label: 'View users' },
    { key: 'users.create', label: 'Create users' },
    { key: 'users.update', label: 'Update users' },
    { key: 'users.delete', label: 'Delete users' },
  ] },
  { section: 'Package Management', actions: [
    { key: 'packages.view', label: 'View packages' },
    { key: 'packages.create', label: 'Create packages' },
    { key: 'packages.update', label: 'Update packages' },
    { key: 'packages.delete', label: 'Delete packages' },
  ] },
  { section: 'Payments / Finance', actions: [
    { key: 'payments.view', label: 'View payments' },
  ] },
  { section: 'Top-ups', actions: [
    { key: 'topups.view', label: 'View top-up bundles' },
    { key: 'topups.create', label: 'Create / grant top-ups' },
  ] },
  { section: 'Reports', actions: [{ key: 'reports.view', label: 'View reports' }] },
  { section: 'AI Providers', actions: [
    { key: 'ai_providers.view', label: 'View AI providers' },
    { key: 'ai_providers.update', label: 'Update AI providers' },
  ] },
  { section: 'Meta Platform', actions: [
    { key: 'meta.view', label: 'View Meta settings' },
    { key: 'meta.update', label: 'Update Meta settings' },
  ] },
  { section: 'Support', actions: [
    { key: 'support.view', label: 'View support tickets' },
    { key: 'support.update', label: 'Reply to tickets' },
  ] },
  { section: 'Settings', actions: [
    { key: 'settings.view', label: 'View settings' },
    { key: 'settings.update', label: 'Update settings' },
  ] },
];

interface AdminFormState {
  id?: string;
  name: string;
  email: string;
  password: string;
  role: 'super_admin' | 'admin';
  permissions: string[];
  isActive: boolean;
}

const emptyForm: AdminFormState = {
  name: '',
  email: '',
  password: '',
  role: 'admin',
  permissions: [],
  isActive: true,
};

export function AdminAdmins() {
  const navigate = useNavigate();
  const [admins, setAdmins] = React.useState<AdminRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [formOpen, setFormOpen] = React.useState(false);
  const [form, setForm] = React.useState<AdminFormState>(emptyForm);
  const [saving, setSaving] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<AdminRow | null>(null);

  const fetchAdmins = async () => {
    try {
      const data = await apiRequest<{ admins: AdminRow[] }>(endpoints.adminAdmins);
      setAdmins(data.admins);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        notify.error('Session expired', 'Please login again.');
        navigate('/admin/login');
        return;
      }
      notify.error('Failed to load admins', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { fetchAdmins(); }, []);

  const openCreate = () => {
    setForm({ ...emptyForm });
    setFormOpen(true);
  };

  const openEdit = (admin: AdminRow) => {
    setForm({
      id: admin.id,
      name: admin.name || '',
      email: admin.email,
      password: '',
      role: admin.role,
      permissions: admin.permissions,
      isActive: admin.isActive,
    });
    setFormOpen(true);
  };

  const togglePermission = (key: string) => {
    setForm((f) => {
      const has = f.permissions.includes(key);
      return {
        ...f,
        permissions: has ? f.permissions.filter((p) => p !== key) : [...f.permissions, key],
      };
    });
  };

  const toggleGroup = (group: (typeof PERMISSION_GROUPS)[number], enabled: boolean) => {
    setForm((f) => {
      const keys = group.actions.map((a) => a.key);
      const current = new Set(f.permissions);
      keys.forEach((k) => (enabled ? current.add(k) : current.delete(k)));
      return { ...f, permissions: Array.from(current) };
    });
  };

  const save = async () => {
    if (!form.name || !form.email) {
      notify.error('Missing fields', 'Name and email are required');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        role: form.role,
        permissions: form.role === 'super_admin' ? [] : form.permissions,
        isActive: form.isActive,
      };
      if (form.password) payload.password = form.password;

      if (form.id) {
        await apiRequest(endpoints.adminAdmin(form.id), {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify.success('Admin updated', `${form.email} updated`);
      } else {
        await apiRequest(endpoints.adminAdmins, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify.success('Admin created', `${form.email} added`);
      }
      setFormOpen(false);
      await fetchAdmins();
    } catch (err) {
      notify.error('Failed to save', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await apiRequest(endpoints.adminAdmin(pendingDelete.id), { method: 'DELETE' });
      notify.success('Admin deleted', `${pendingDelete.email} removed`);
      setPendingDelete(null);
      await fetchAdmins();
    } catch (err) {
      notify.error('Failed to delete', (err as Error).message);
    }
  };

  const permissionCount = (admin: AdminRow) =>
    admin.role === 'super_admin' ? PERMISSION_GROUPS.flatMap((g) => g.actions).length : admin.permissions.length;

  const columns: Array<Column<AdminRow>> = [
    {
      key: 'name', header: 'Admin',
      render: (a) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
            {(a.name || a.email)[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-slate-900 dark:text-slate-100">{a.name || a.email}</p>
            <p className="text-xs text-slate-500">{a.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role', header: 'Role',
      render: (a) =>
        a.role === 'super_admin' ? (
          <Badge tone="indigo"><ShieldCheckIcon className="mr-1 h-3 w-3" />Super Admin</Badge>
        ) : (
          <Badge tone="slate">Sub Admin</Badge>
        ),
    },
    {
      key: 'permissions', header: 'Permissions',
      render: (a) => (
        <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
          {a.role === 'super_admin' ? 'All access' : `${permissionCount(a)} permission${a.permissions.length === 1 ? '' : 's'}`}
        </span>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (a) => <Badge tone={a.isActive ? 'emerald' : 'red'}>{a.isActive ? 'Active' : 'Disabled'}</Badge>,
    },
    {
      key: 'lastLogin', header: 'Last login',
      render: (a) => (
        <span className="text-xs text-slate-500">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleDateString() : 'Never'}</span>
      ),
    },
    {
      key: 'actions', header: 'Actions',
      render: (a) => (
        <div className="flex items-center justify-end gap-2 md:justify-start">
          <button
            type="button"
            onClick={() => openEdit(a)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <PencilIcon className="h-3.5 w-3.5" aria-hidden="true" /> Edit
          </button>
          <button
            type="button"
            onClick={() => setPendingDelete(a)}
            disabled={a.role === 'super_admin'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
              a.role === 'super_admin'
                ? 'cursor-not-allowed border-slate-100 text-slate-300 dark:border-slate-800 dark:text-slate-600'
                : 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10',
            )}>
            <Trash2Icon className="h-3.5 w-3.5" aria-hidden="true" /> Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <AdminHeader
        title="Admin Management"
        description="Create sub-admins and control exactly which parts of the panel they can access."
        action={
          <Button onClick={openCreate}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" /> Add admin
          </Button>
        }
      />

      {loading ? (
        <div className="mt-6 space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <DataTable columns={columns} rows={admins} rowKey={(a) => a.id} caption={`${admins.length} admins`} emptyMessage="No admins yet. Add your first sub-admin." />
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? `Edit ${form.name || form.email}` : 'Add admin'}
        description="Sub-admins can only access the sections you tick below."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : form.id ? 'Save changes' : 'Create admin'}</Button>
          </>
        }>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Full name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                placeholder="Jane Cooper"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                disabled={!!form.id}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900"
                placeholder="jane@company.com"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {form.id ? 'Reset password (leave blank to keep current)' : 'Password'}
            </span>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              placeholder="Min. 8 characters"
            />
          </label>

          <div>
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Role</span>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, role: 'admin', permissions: [] })}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
                  form.role === 'admin'
                    ? 'border-indigo-500 bg-indigo-600 text-white'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                )}>
                Sub Admin
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, role: 'super_admin', permissions: [] })}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
                  form.role === 'super_admin'
                    ? 'border-indigo-500 bg-indigo-600 text-white'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                )}>
                Super Admin
              </button>
            </div>
            {form.role === 'super_admin' && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Super admins bypass all permission checks and can manage other admins. Use sparingly.
              </p>
            )}
          </div>

          {form.role === 'admin' && (
            <div>
              <span className="mb-2 block text-xs font-semibold text-slate-600 dark:text-slate-300">Permissions</span>
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                {PERMISSION_GROUPS.map((group) => {
                  const allOn = group.actions.every((a) => form.permissions.includes(a.key));
                  const someOn = group.actions.some((a) => form.permissions.includes(a.key));
                  return (
                    <div key={group.section} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                          <input
                            type="checkbox"
                            checked={allOn}
                            ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }}
                            onChange={(e) => toggleGroup(group, e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          {group.section}
                        </label>
                      </div>
                      <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-2">
                        {group.actions.map((action) => (
                          <label key={action.key} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={form.permissions.includes(action.key)}
                              onChange={() => togglePermission(action.key)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            {action.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {form.id && (
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Account enabled
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete admin?"
        description="This admin will no longer be able to sign in."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Delete admin</Button>
          </>
        }>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Are you sure you want to remove <span className="font-semibold">{pendingDelete?.email}</span>?
        </p>
      </Modal>
    </AdminLayout>
  );
}
