import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { PackageForm, type PackageFormValues } from '../../components/admin/PackageForm';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import { FEATURE_OPTIONS, FEATURE_KEY_MAP } from '../../utils/features';
import type { PricingPackage } from '../../types';
import { formatCurrency } from '../../utils/format';
import { cn } from '../../utils/cn';

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
    billingPeriod: p.billingPeriod === 'yearly' ? 'yearly' : 'monthly',
    yearlyPrice: p.yearlyPriceCents ? p.yearlyPriceCents / 100 : undefined,
    setupType: p.setupType === 'standard' || p.setupType === 'premium' ? p.setupType : 'none',
    features: FEATURE_OPTIONS.map((label) => ({
      label,
      included: features[FEATURE_KEY_MAP[label]] === true,
    })),
  };
}

type PackageFilter = 'all' | 'monthly' | 'yearly' | 'setup';

const FILTERS: Array<{ value: PackageFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'setup', label: 'Setup' },
];

export function AdminPackages() {
  const navigate = useNavigate();
  const [items, setItems] = React.useState<PricingPackage[]>([]);
  const [defaultSlug, setDefaultSlug] = React.useState('pro');
  const [filter, setFilter] = React.useState<PackageFilter>('all');
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<PricingPackage | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<PricingPackage | null>(null);
  const [profitability, setProfitability] = React.useState<Map<string, any>>(new Map());

  const fetchPackages = async () => {
    try {
      const [pkgData, profData] = await Promise.all([
        apiRequest<{ packages: any[]; defaultPackage?: string }>(endpoints.adminPackages),
        apiRequest<any>(endpoints.adminBillingProfitability).catch(() => null),
      ]);
      setItems(pkgData.packages.map(fromApiPackage));
      if (pkgData.defaultPackage) setDefaultSlug(pkgData.defaultPackage);
      if (profData?.packages) {
        const map = new Map<string, any>();
        profData.packages.forEach((p: any) => map.set(p.packageId, p));
        setProfitability(map);
      }
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
      const payload = {
        name: values.name,
        slug: values.name.toLowerCase().replace(/\s+/g, '-'),
        description: values.description,
        priceCents: Math.round(values.price * 100),
        includedTokens: values.tokens,
        sortOrder: values.sortOrder,
        billingPeriod: values.billingPeriod,
        yearlyPriceCents: values.billingPeriod === 'yearly' ? Math.round(values.yearlyPrice * 100) : 0,
        setupType: values.setupType,
        features,
      };

      if (editing) {
        await apiRequest(endpoints.adminPackage(editing.id), {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify.success('Package updated', `${values.name} updated`);
      } else {
        await apiRequest(endpoints.adminPackages, {
          method: 'POST',
          body: JSON.stringify(payload),
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

  const filtered = items.filter((p) => {
    if (filter === 'setup') return p.setupType === 'standard' || p.setupType === 'premium';
    if (filter === 'yearly') return p.billingPeriod === 'yearly';
    if (filter === 'monthly') return p.billingPeriod !== 'yearly' && (!p.setupType || p.setupType === 'none');
    return true;
  });

  const columns: Array<Column<PricingPackage>> = [
    {
      key: 'name', header: 'Name',
      render: (p) => {
        const prof = profitability.get(p.id);
        return (
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {p.name}
            {p.popular && <span className="ml-2 font-mono text-[10px] uppercase text-indigo-600">popular</span>}
            {p.id === defaultSlug && (
              <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                DEFAULT
              </span>
            )}
            {prof && (
              <Badge tone={prof.status === 'profitable' ? 'emerald' : prof.status === 'warning' ? 'amber' : 'red'} className="ml-2">
                {prof.status === 'profitable' ? 'PROFITABLE' : prof.status === 'warning' ? 'WARNING' : 'LOSS'}
              </Badge>
            )}
          </span>
        );
      }
    },
    {
      key: 'type', header: 'Type',
      render: (p) => {
        if (p.setupType === 'standard' || p.setupType === 'premium') {
          return <Badge tone="amber">{p.setupType === 'premium' ? 'Premium setup' : 'Standard setup'}</Badge>;
        }
        return p.billingPeriod === 'yearly' ? <Badge tone="emerald">Yearly</Badge> : <Badge tone="slate">Monthly</Badge>;
      }
    },
    { key: 'price', header: 'Price', render: (p) => <span className="font-mono">{formatCurrency(p.price)}</span> },
    { key: 'tokens', header: 'Credits', render: (p) => <span className="font-mono">{p.tokens.toLocaleString()}</span> },
    {
      key: 'profit', header: 'Profit/Credit',
      render: (p) => {
        const prof = profitability.get(p.id);
        if (!prof) return <span className="text-slate-400">—</span>;
        return <span className="font-mono text-xs">{formatCurrency(prof.revenuePerCreditCents / 100)}</span>;
      }
    },
    {
      key: 'margin', header: 'Margin',
      render: (p) => {
        const prof = profitability.get(p.id);
        if (!prof) return <span className="text-slate-400">—</span>;
        return (
          <Badge tone={prof.marginPct >= 30 ? 'emerald' : prof.marginPct > 0 ? 'amber' : 'red'}>
            {prof.marginPct.toFixed(0)}%
          </Badge>
        );
      }
    },
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
        description="Create monthly, yearly and setup packages customers can buy."
        action={
          <Button onClick={openCreate}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" /> Create package
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
              filter === f.value
                ? 'border-indigo-500 bg-indigo-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            )}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-6 space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <DataTable columns={columns} rows={filtered} rowKey={(p) => p.id} caption={`${filtered.length} packages`} emptyMessage="No packages in this category yet." />
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
