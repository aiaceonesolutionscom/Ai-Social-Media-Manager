import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { PackageForm, type PackageFormValues, FEATURE_OPTIONS } from '../../components/admin/PackageForm';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import type { PricingPackage } from '../../types';
import { formatCurrency } from '../../utils/format';

const FEATURE_KEY_MAP: Record<string, string> = {
  'Facebook publishing': 'facebook_publishing',
  'Instagram publishing': 'instagram_publishing',
  'WhatsApp broadcasts': 'whatsapp_broadcast',
  'Website support chat': 'web_chat',
  'Voice to post transcription': 'voice_transcription',
  'Scheduled auto-publishing': 'scheduled_publishing',
  'Full analytics dashboard': 'analytics_dashboard',
  'Priority support': 'priority_support',
};

function toPackage(values: PackageFormValues, base?: PricingPackage | null): PricingPackage {
  return {
    id: base?.id ?? values.name.toLowerCase().replace(/\s+/g, '-'),
    name: values.name,
    description: values.description,
    price: values.price,
    tokens: values.tokens,
    sortOrder: values.sortOrder,
    popular: base?.popular,
    status: base?.status ?? 'active',
    users: base?.users ?? 0,
    features: FEATURE_OPTIONS.map((label) => ({ label, included: values.features.includes(label) }))
  };
}

function fromApiPackage(p: any): PricingPackage {
  const features = p.features || {};
  return {
    id: p.id,
    name: p.name,
    description: p.description || '',
    price: p.priceCents / 100,
    tokens: p.includedTokens,
    sortOrder: p.sortOrder,
    status: p.isActive ? 'active' : 'inactive',
    users: 0,
    features: FEATURE_OPTIONS.map((label) => ({
      label,
      included: features[FEATURE_KEY_MAP[label]] === true,
    })),
  };
}

export function AdminPackages() {
  const navigate = useNavigate();
  const [items, setItems] = React.useState<PricingPackage[]>([]);
  const [defaultSlug, setDefaultSlug] = React.useState('pro');
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<PricingPackage | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<PricingPackage | null>(null);

  const fetchPackages = async () => {
    try {
      const data = await apiRequest<{ packages: any[]; defaultPackage?: string }>(endpoints.adminPackages);
      setItems(data.packages.map(fromApiPackage));
      if (data.defaultPackage) setDefaultSlug(data.defaultPackage);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        notify.error('Session expired', 'Please login again.');
        navigate('/admin/login');
        return;
      }
      notify.error('Failed to load packages', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { fetchPackages(); }, []);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (pkg: PricingPackage) => {
    setEditing(pkg);
    setFormOpen(true);
  };

  const save = async (values: PackageFormValues) => {
    try {
      const features: Record<string, boolean> = {};
      FEATURE_OPTIONS.forEach((label) => {
        features[FEATURE_KEY_MAP[label]] = values.features.includes(label);
      });

      if (editing) {
        await apiRequest(endpoints.adminPackage(editing.id), {
          method: 'PUT',
          body: JSON.stringify({
            name: values.name,
            slug: values.name.toLowerCase().replace(/\s+/g, '-'),
            description: values.description,
            priceCents: Math.round(values.price * 100),
            includedTokens: values.tokens,
            sortOrder: values.sortOrder,
            features,
          }),
        });
        notify.success('Package updated', `${values.name} updated`);
      } else {
        await apiRequest(endpoints.adminPackages, {
          method: 'POST',
          body: JSON.stringify({
            name: values.name,
            slug: values.name.toLowerCase().replace(/\s+/g, '-'),
            description: values.description,
            priceCents: Math.round(values.price * 100),
            includedTokens: values.tokens,
            sortOrder: values.sortOrder,
            features,
          }),
        });
        notify.success('Package created', `${values.name} created`);
      }
      await fetchPackages();
    } catch (err) {
      notify.error('Failed to save', (err as Error).message);
    }
    setFormOpen(false);
    setEditing(null);
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await apiRequest(endpoints.adminPackage(pendingDelete.id), { method: 'DELETE' });
      notify.success('Package deleted', `${pendingDelete.name} deleted`);
      await fetchPackages();
    } catch (err) {
      notify.error('Failed to delete', (err as Error).message);
    }
    setPendingDelete(null);
  };

  const setDefault = async (pkg: PricingPackage) => {
    try {
      await apiRequest(endpoints.adminDefaultPackage, {
        method: 'PUT',
        body: JSON.stringify({ slug: pkg.id }),
      });
      setDefaultSlug(pkg.id);
      notify.success('Default package updated', `${pkg.name} is now the default plan`);
    } catch (err) {
      notify.error('Failed to set default', (err as Error).message);
    }
  };

  const columns: Array<Column<PricingPackage>> = [
    {
      key: 'name', header: 'Name',
      render: (p) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {p.name}
          {p.popular && <span className="ml-2 font-mono text-[10px] uppercase text-indigo-600">popular</span>}
          {p.id === defaultSlug && (
            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              DEFAULT
            </span>
          )}
        </span>
      )
    },
    { key: 'price', header: 'Price', render: (p) => <span className="font-mono">{formatCurrency(p.price)}</span> },
    { key: 'tokens', header: 'Tokens', render: (p) => <span className="font-mono">{p.tokens.toLocaleString()}</span> },
    {
      key: 'status', header: 'Status',
      render: (p) => <Badge tone={p.status === 'active' ? 'emerald' : 'slate'}>{p.status}</Badge>
    },
    {
      key: 'actions', header: 'Actions',
      render: (p) => (
        <div className="flex items-center justify-end gap-2 md:justify-start">
          {p.id !== defaultSlug && (
            <button type="button" onClick={() => setDefault(p)} aria-label={`Set ${p.name} as default`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-50 dark:border-emerald-500/30 dark:hover:bg-emerald-500/10">
              Set Default
            </button>
          )}
          <button type="button" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <PencilIcon className="h-3.5 w-3.5" aria-hidden="true" /> Edit
          </button>
          <button type="button" onClick={() => setPendingDelete(p)} aria-label={`Delete ${p.name}`}
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
        title="Package Management"
        description="Create and price the token bundles customers can buy."
        action={
          <Button onClick={openCreate}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" /> Create package
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <DataTable columns={columns} rows={items} rowKey={(p) => p.id} caption="All packages" emptyMessage="No packages yet." />
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.name}` : 'Create package'}
        description="Changes go live immediately on the pricing page.">
        <PackageForm initial={editing} onSubmit={save} onCancel={() => setFormOpen(false)} />
      </Modal>

      <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete package?"
        description="Existing subscribers keep their tokens, but no one new can buy this plan." size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Delete package</Button>
          </>
        }>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Are you sure you want to delete <span className="font-semibold">{pendingDelete?.name}</span>?
        </p>
      </Modal>
    </AdminLayout>
  );
}
