import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BanknoteIcon, DollarSignIcon, ReceiptIcon, RotateCcwIcon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { PaymentTable } from '../../components/admin/PaymentTable';
import { StatsCard } from '../../components/ui/StatsCard';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import { Pagination } from '../../components/ui/Pagination';
import type { Payment } from '../../types';
import { formatCurrency, formatDate } from '../../utils/format';

const PAGE_SIZE = 10;

function fromApiPayment(p: any): Payment {
  return {
    id: p.id,
    date: p.createdAt?.split('T')[0] || '',
    user: p.phone || 'Unknown',
    plan: p.packageId || 'Unknown',
    amount: p.amountCents / 100,
    status: p.status as Payment['status'],
  };
}

export function AdminPayments() {
  const navigate = useNavigate();
  const [items, setItems] = React.useState<Payment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [receipt, setReceipt] = React.useState<Payment | null>(null);
  const [page, setPage] = React.useState(1);

  const paginated = React.useMemo(() => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [items, page]);

  const fetchPayments = async () => {
    try {
      const data = await apiRequest<{ payments: any[] }>(endpoints.adminPayments);
      setItems(data.payments.map(fromApiPayment));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        notify.error('Session expired', 'Please login again.');
        navigate('/admin/login');
        return;
      }
      notify.error('Failed to load payments', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { fetchPayments(); }, []);

  const grossRevenue = items.filter((p) => p.status === 'succeeded').reduce((sum, p) => sum + p.amount, 0);
  const refunded = items.filter((p) => p.status === 'refunded').reduce((sum, p) => sum + p.amount, 0);

  return (
    <AdminLayout>
      <AdminHeader title="Payments" description="Every Stripe charge processed by EchoPost." />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <StatsCard label="Gross revenue" value={formatCurrency(grossRevenue)} icon={DollarSignIcon} tone="emerald" index={0} />
        <StatsCard label="Refunded" value={formatCurrency(refunded)} icon={RotateCcwIcon} tone="amber" index={1} />
        <StatsCard label="Transactions" value={String(items.length)} icon={BanknoteIcon} tone="indigo" index={2} />
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : (
          <>
            <PaymentTable payments={paginated} onViewReceipt={setReceipt} onRefund={() => notify.info('Refund', 'Refund processing coming soon')} />
            <Pagination page={page} total={items.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </>
        )}
      </div>

      <Modal open={receipt !== null} onClose={() => setReceipt(null)} title="Receipt" size="md">
        {receipt && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                <ReceiptIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">{receipt.id}</p>
                <p className="text-xs text-slate-500">{formatDate(receipt.date)}</p>
              </div>
            </div>
            <dl className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
              <div className="flex justify-between">
                <dt className="text-slate-500">Customer</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-50">{receipt.user}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Plan</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-50">{receipt.plan}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Status</dt>
                <dd className="font-medium capitalize text-slate-900 dark:text-slate-50">{receipt.status}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
                <dt className="font-semibold text-slate-900 dark:text-slate-50">Total</dt>
                <dd className="font-mono font-bold text-slate-900 dark:text-slate-50">{formatCurrency(receipt.amount)}</dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
