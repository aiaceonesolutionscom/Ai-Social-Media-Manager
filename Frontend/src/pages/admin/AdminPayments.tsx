import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BanknoteIcon, DollarSignIcon, ReceiptIcon, RotateCcwIcon, SaveIcon, Settings2Icon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { PaymentTable } from '../../components/admin/PaymentTable';
import { StatsCard } from '../../components/ui/StatsCard';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { Pagination } from '../../components/ui/Pagination';
import type { Payment } from '../../types';
import { formatCurrency, formatDate } from '../../utils/format';

const PAGE_SIZE = 10;

const statusMap: Record<string, Payment['status']> = {
  pending: 'pending',
  completed: 'succeeded',
  succeeded: 'succeeded',
  failed: 'failed',
  refunded: 'refunded',
};

function fromApiPayment(p: any): Payment {
  const method = p.stripeSessionId?.startsWith('local_') ? 'local' : p.stripeSessionId?.startsWith('rg_') ? 'gateway' : 'stripe';
  return {
    id: p.id,
    date: p.createdAt?.split('T')[0] || '',
    user: p.phone || 'Unknown',
    plan: p.packageId || 'Unknown',
    amount: p.amountCents / 100,
    status: statusMap[p.status] || 'pending',
    method,
    referenceId: method === 'local' ? p.stripeSessionId : undefined,
    taxPercent: p.taxPercent ?? 0,
    mdrPercent: p.mdrPercent ?? 0,
    taxAmount: p.taxAmount ?? 0,
    mdrAmount: p.mdrAmount ?? 0,
  };
}

interface MethodsState {
  stripe: boolean;
  pkrRate: string;
  taxPercent: string;
  mdrPercent: string;
  gateway: boolean;
  gatewaySandbox: boolean;
  gatewayApiBase: string;
  gatewayApiKey: string;
  gatewayWebhookSecret: string;
}

const emptyMethods: MethodsState = {
  stripe: true,
  pkrRate: '290',
  taxPercent: '8',
  mdrPercent: '2',
  gateway: false,
  gatewaySandbox: false,
  gatewayApiBase: 'https://api.rapidgateway.pk',
  gatewayApiKey: '',
  gatewayWebhookSecret: '',
};

export function AdminPayments() {
  const navigate = useNavigate();
  const { adminRole } = useAuth();
  const [items, setItems] = React.useState<Payment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [receipt, setReceipt] = React.useState<Payment | null>(null);
  const [page, setPage] = React.useState(1);
  const [methods, setMethods] = React.useState<MethodsState>(emptyMethods);
  const [methodsLoading, setMethodsLoading] = React.useState(true);
  const [savingMethods, setSavingMethods] = React.useState(false);
  const [gatewayWebhookUrl, setGatewayWebhookUrl] = React.useState('');

  const isSuperAdmin = adminRole === 'super_admin';
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

  const fetchMethods = async () => {
    try {
      const m = await apiRequest<{ stripe: boolean; pkrRate?: number; taxPercent?: number; mdrPercent?: number; gateway?: boolean; gatewaySandbox?: boolean; gatewayApiBase?: string; gatewayApiKeySet?: boolean; gatewayWebhookSecretSet?: boolean }>(endpoints.adminPaymentMethods);
      setMethods({
        stripe: !!m.stripe,
        pkrRate: String(Number(m.pkrRate) || ''),
        taxPercent: String(Number(m.taxPercent) ?? ''),
        mdrPercent: String(Number(m.mdrPercent) ?? ''),
        gateway: !!m.gateway,
        gatewaySandbox: !!m.gatewaySandbox,
        gatewayApiBase: m.gatewayApiBase || 'https://api.rapidgateway.pk',
        gatewayApiKey: m.gatewayApiKeySet ? '••••••••' : '',
        gatewayWebhookSecret: m.gatewayWebhookSecretSet ? '••••••••' : '',
      });
    } catch {
      // keep defaults
    } finally {
      setMethodsLoading(false);
    }
  };

  React.useEffect(() => { fetchPayments(); }, []);
  React.useEffect(() => { fetchMethods(); }, []);

  React.useEffect(() => {
    apiRequest<{ gatewayPayment?: { webhookUrl: string } }>(endpoints.meta)
      .then((m) => setGatewayWebhookUrl(m.gatewayPayment?.webhookUrl || ''))
      .catch(() => {});
  }, []);

  const confirmPaid = async (p: Payment) => {
    if (!window.confirm(`Confirm that payment was received for ${p.user} (${p.plan})? This will activate their package.`)) return;
    try {
      const result = await apiRequest<{ activated?: boolean }>(`${endpoints.adminPayments}/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'completed' }),
      });
      notify.success('Payment confirmed', result.activated ? 'Package activated and tokens granted.' : 'Payment marked as completed.');
      fetchPayments();
    } catch (err) {
      notify.error('Failed to confirm payment', (err as Error).message);
    }
  };

  const revokePaid = async (p: Payment) => {
    if (!window.confirm(`Revoke payment for ${p.user} (${p.plan})? Their package will be ended, tokens forfeited, and their local payments locked to manual verification.`)) return;
    try {
      const result = await apiRequest<{ revoked?: boolean }>(`${endpoints.adminPayments}/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'refunded' }),
      });
      notify.success('Payment revoked', result.revoked ? 'Package ended, tokens forfeited, user trust-locked.' : 'Payment marked as refunded.');
      fetchPayments();
    } catch (err) {
      notify.error('Failed to revoke payment', (err as Error).message);
    }
  };

  const saveMethods = async () => {
    setSavingMethods(true);
    try {
      const body: Record<string, unknown> = {
        stripe: methods.stripe ? 'on' : 'off',
        pkrRate: Number(methods.pkrRate) || 0,
        taxPercent: Number(methods.taxPercent) || 0,
        mdrPercent: Number(methods.mdrPercent) || 0,
        gateway: methods.gateway ? 'on' : 'off',
        gatewaySandbox: methods.gatewaySandbox,
        gatewayApiBase: methods.gatewayApiBase,
      };
      if (methods.gatewayApiKey && methods.gatewayApiKey !== '••••••••') body.gatewayApiKey = methods.gatewayApiKey;
      if (methods.gatewayWebhookSecret && methods.gatewayWebhookSecret !== '••••••••') body.gatewayWebhookSecret = methods.gatewayWebhookSecret;
      await apiRequest(endpoints.adminPaymentMethods, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      notify.success('Payment methods saved', 'Checkout options updated.');
    } catch (err) {
      notify.error('Failed to save payment methods', (err as Error).message);
    } finally {
      setSavingMethods(false);
    }
  };

  const grossRevenue = items.filter((p) => p.status === 'succeeded').reduce((sum, p) => sum + p.amount, 0);
  const refunded = items.filter((p) => p.status === 'refunded').reduce((sum, p) => sum + p.amount, 0);
  const pendingLocal = items.filter((p) => p.status === 'pending' && p.method === 'local').length;

  return (
    <AdminLayout>
      <AdminHeader title="Payments" description="Every charge processed by EchoPost." />

      {isSuperAdmin && (
        <>
        <Card as="section" className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-50">
                <Settings2Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Payment methods
              </h2>
              <p className="mt-1 text-sm text-slate-500">Super admin: choose which payment options appear on checkout.</p>
            </div>
            {methodsLoading ? null : (
              <Button onClick={saveMethods} loading={savingMethods}>
                <SaveIcon className="h-4 w-4" aria-hidden="true" />
                Save
              </Button>
            )}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={methods.stripe}
                  onChange={(e) => setMethods((m) => ({ ...m, stripe: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600" />
                <span className="text-slate-600 dark:text-slate-300">
                  Enable Stripe cards
                  <span className="block text-xs text-slate-400">Shows "Card (Stripe)" on checkout when a Stripe key exists.</span>
                </span>
              </label>
              <div>
                <Input
                  label="PKR rate (per $1)"
                  type="number"
                  placeholder="290"
                  value={methods.pkrRate}
                  onChange={(e) => setMethods((m) => ({ ...m, pkrRate: e.target.value }))} />
                <p className="mt-1 text-xs text-slate-400">Used to show the PKR amount for gateway checkout.</p>
              </div>
            </div>

            <div className="space-y-3 lg:col-span-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Estimated tax (%)"
                  type="number"
                  placeholder="8"
                  value={methods.taxPercent}
                  onChange={(e) => setMethods((m) => ({ ...m, taxPercent: e.target.value }))} />
                <Input
                  label="Gateway MDR (%)"
                  type="number"
                  placeholder="2"
                  value={methods.mdrPercent}
                  onChange={(e) => setMethods((m) => ({ ...m, mdrPercent: e.target.value }))} />
              </div>
              <p className="text-xs text-slate-500">
                Tax is added to every checkout (Stripe and gateway). The MDR is a gateway fee that is
                added on top of the PKR total for gateway payments only. Set either to 0 to disable.
              </p>
            </div>
          </div>
        </Card>

        <Card as="section" className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-50">
                <Settings2Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Gateway (Card / JazzCash / EasyPaisa)
              </h2>
              <p className="mt-1 text-sm text-slate-500">Super admin: connect a payment gateway for instant, verified checkout. Credentials are never returned by the API — set them once, leave blank to keep.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={methods.gateway}
                  onChange={(e) => setMethods((m) => ({ ...m, gateway: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600" />
                <span className="text-slate-600 dark:text-slate-300">
                  Enable gateway checkout
                  <span className="block text-xs text-slate-400">Shows "Card / JazzCash / EasyPaisa" on checkout.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={methods.gatewaySandbox}
                  onChange={(e) => setMethods((m) => ({ ...m, gatewaySandbox: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600" />
                <span className="text-slate-600 dark:text-slate-300">
                  Sandbox (test) mode
                  <span className="block text-xs text-slate-400">Use test keys. Payments are simulated, nothing is charged.</span>
                </span>
              </label>
              {gatewayWebhookUrl && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Webhook URL to register</p>
                  <p className="mt-1 break-all rounded-xl bg-slate-50 p-3 font-mono text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">{gatewayWebhookUrl}</p>
                </div>
              )}
            </div>

            <div className="space-y-3 lg:col-span-2">
              <Input
                label="API base URL"
                placeholder="https://api.rapidgateway.pk"
                value={methods.gatewayApiBase}
                onChange={(e) => setMethods((m) => ({ ...m, gatewayApiBase: e.target.value }))} />
              <Input
                label="Gateway secret key (API key)"
                type="password"
                placeholder="sk_live_... / sk_test_..."
                value={methods.gatewayApiKey}
                onChange={(e) => setMethods((m) => ({ ...m, gatewayApiKey: e.target.value }))} />
              <Input
                label="Webhook secret"
                type="password"
                placeholder="Used to verify webhook signatures"
                value={methods.gatewayWebhookSecret}
                onChange={(e) => setMethods((m) => ({ ...m, gatewayWebhookSecret: e.target.value }))} />
            </div>
          </div>
        </Card>
        </>
      )}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard label="Gross revenue" value={formatCurrency(grossRevenue)} icon={DollarSignIcon} tone="emerald" index={0} />
        <StatsCard label="Refunded" value={formatCurrency(refunded)} icon={RotateCcwIcon} tone="amber" index={1} />
        <StatsCard label="Transactions" value={String(items.length)} icon={BanknoteIcon} tone="indigo" index={2} />
        <StatsCard label="Pending local" value={String(pendingLocal)} icon={Settings2Icon} tone="amber" index={3} />
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : (
          <>
            <PaymentTable payments={paginated} onViewReceipt={setReceipt} onRefund={() => notify.info('Refund', 'Refund processing coming soon')} onConfirm={confirmPaid} onRevoke={revokePaid} />
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
                <dt className="text-slate-500">Method</dt>
                <dd className="font-medium capitalize text-slate-900 dark:text-slate-50">{receipt.method || 'Stripe'}</dd>
              </div>
              {receipt.referenceId && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Reference</dt>
                  <dd className="font-mono font-medium text-slate-900 dark:text-slate-50">{receipt.referenceId}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">Status</dt>
                <dd className="font-medium capitalize text-slate-900 dark:text-slate-50">{receipt.status}</dd>
              </div>
              {(receipt.taxPercent || receipt.taxAmount) && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Tax ({receipt.taxPercent}%)</dt>
                  <dd className="font-mono font-medium text-slate-900 dark:text-slate-50">
                    {receipt.method === 'gateway' ? `${receipt.taxAmount} PKR` : formatCurrency((receipt.taxAmount ?? 0) / 100)}
                  </dd>
                </div>
              )}
              {(receipt.mdrPercent || receipt.mdrAmount) && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Gateway MDR ({receipt.mdrPercent}%)</dt>
                  <dd className="font-mono font-medium text-slate-900 dark:text-slate-50">
                    {receipt.method === 'gateway' ? `${receipt.mdrAmount} PKR` : formatCurrency((receipt.mdrAmount ?? 0) / 100)}
                  </dd>
                </div>
              )}
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