import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { TopUpForm, type TopUpFormValues } from '../../components/admin/TopUpForm';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import type { TopUpBundle } from '../../types';
import { formatCurrency } from '../../utils/format';

function fromApiBundle(b: any): TopUpBundle {
  return {
    id: b.id,
    tokens: b.tokens,
    price: b.priceCents / 100,
    status: b.isActive ? 'active' : 'inactive',
    sortOrder: b.sortOrder,
  };
}

export function AdminTopUps() {
  const navigate = useNavigate();
  const [items, setItems] = React.useState<TopUpBundle[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<TopUpBundle | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<TopUpBundle | null>(null);

  const fetchBundles = async () => {
    try {
      const data = await apiRequest<{ bundles: any[] }>(endpoints.adminTopUps);
      setItems(data.bundles.map(fromApiBundle));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        notify.error('Session expired', 'Please login again.');
        navigate('/admin/login');
        return;
      }
      notify.error('Failed to load top-up bundles', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { fetchBundles(); }, []);

  const save = async (values: TopUpFormValues) => {
    try {
      const payload = {
        tokens: values.tokens,
        priceCents: Math.round(values.price * 100),
        sortOrder: values.sortOrder,
      };
      if (editing) {
        await apiRequest(endpoints.adminTopUp(editing.id), {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify.success('Bundle updated', `${values.tokens} token bundle updated`);
      } else {
        await apiRequest(endpoints.adminTopUps, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify.success('Bundle created', `${values.tokens} token bundle created`);
      }
      await fetchBundles();
    } catch (err) {
      notify.error('Failed to save', (err as Error).message);
    }
    setFormOpen(false);
    setEditing(null);
  };

  const toggleActive = async (bundle: TopUpBundle) => {
    try {
      await apiRequest(endpoints.adminTopUp(bundle.id), {
        method: 'PUT',
        body: JSON.stringify({ isActive: bundle.status !== 'active' }),
      });
      notify.success('Bundle updated', bundle.status === 'active' ? 'Bundle deactivated' : 'Bundle activated');
      await fetchBundles();
    } catch (err) {
      notify.error('Failed to update', (err as Error).message);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await apiRequest(endpoints.adminTopUp(pendingDelete.id), { method: 'DELETE' });
      notify.success('Bundle deleted', `${pendingDelete.tokens} token bundle deleted`);
      await fetchBundles();
    } catch (err) {
      notify.error('Failed to delete', (err as Error).message);
    }
    setPendingDelete(null);
  };

  const columns: Array<Column<TopUpBundle>> = [
    { key: 'tokens', header: 'Tokens', render: (b) => <span className="font-mono">{b.tokens.toLocaleString()}</span> },
    { key: 'price', header: 'Price', render: (b) => <span className="font-mono">{formatCurrency(b.price)}</span> },
    {
      key: 'status', header: 'Status',
      render: (b) => <Badge tone={b.status === 'active' ? 'emerald' : 'slate'}>{b.status}</Badge>
    },
    {
      key: 'actions', header: 'Actions',
      render: (b) => (
        <div className="flex items-center justify-end gap-2 md:justify-start">
          <button type="button" onClick={() => toggleActive(b)} aria-label={`Toggle ${b.tokens} token bundle`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-50 dark:border-emerald-500/30 dark:hover:bg-emerald-500/10">
            {b.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
          <button type="button" onClick={() => { setEditing(b); setFormOpen(true); }} aria-label={`Edit ${b.tokens} token bundle`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <PencilIcon className="h-3.5 w-3.5" aria-hidden="true" /> Edit
          </button>
          <button type="button" onClick={() => setPendingDelete(b)} aria-label={`Delete ${b.tokens} token bundle`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10">
            <Trash2Icon className="h-3.5 w-3.5" aria-hidden="true" /> Delete
          </button>
        </div>
      )
    }
  ];

  return (
    <AdminLayout>
      <AdminHeader
        title="Top-up Bundles"
        description="Extra credit bundles customers can buy to add tokens without changing their plan."
        action={
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" /> Create bundle
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <DataTable columns={columns} rows={items} rowKey={(b) => b.id} caption="All top-up bundles" emptyMessage="No top-up bundles yet." />
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.tokens} token bundle` : 'Create top-up bundle'}
        description="Changes go live immediately on the Packages page.">
        <TopUpForm initial={editing} onSubmit={save} onCancel={() => setFormOpen(false)} />
      </Modal>

      <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete bundle?"
        description="This bundle will no longer be available to buy." size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Delete bundle</Button>
          </>
        }>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Are you sure you want to delete the <span className="font-semibold">{pendingDelete?.tokens.toLocaleString()}</span> token bundle?
        </p>
      </Modal>
    </AdminLayout>
  );
}
