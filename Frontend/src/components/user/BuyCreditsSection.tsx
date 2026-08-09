import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { notify } from '../ui/Toast';
import { apiRequest, endpoints, isUserLoggedIn } from '../../utils/api';
import { useUserAuth } from '../../contexts/UserAuthContext';
import type { TopUpBundle } from '../../types';

interface BuyCreditsSectionProps {
  title?: string;
  description?: string;
  className?: string;
  onSuccess?: () => void;
}

export function BuyCreditsSection({
  title = 'Buy extra credits',
  description = 'Running low on tokens? Top up instantly — your plan stays the same, only your balance grows.',
  className,
  onSuccess,
}: BuyCreditsSectionProps) {
  const navigate = useNavigate();
  const { refreshUser } = useUserAuth();
  const [topups, setTopups] = React.useState<TopUpBundle[]>([]);
  const [buyingId, setBuyingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    apiRequest<{ bundles: any[] }>(endpoints.topupOptions)
      .then((d) =>
        setTopups((d.bundles || []).map((b) => ({
          id: b.id,
          tokens: b.tokens,
          price: b.priceCents / 100,
          status: 'active' as const,
          sortOrder: b.sortOrder,
        })))
      )
      .catch(() => undefined);
  }, []);

  if (topups.length === 0) return null;

  const buyTopup = async (bundle: TopUpBundle) => {
    if (!isUserLoggedIn()) {
      navigate('/login');
      return;
    }
    setBuyingId(bundle.id);
    try {
      const result = await apiRequest<{ sessionId?: string; url?: string; mock?: boolean; tokensGranted?: number }>(endpoints.topup, {
        method: 'POST',
        body: JSON.stringify({ bundleId: bundle.id }),
      });
      if (result.mock) {
        await refreshUser();
        notify.success('Credits added (test mode)', `${result.tokensGranted ?? 0} tokens added. No payment was charged.`);
        onSuccess?.();
        return;
      }
      if (result && result.url) {
        window.location.href = result.url;
        return;
      }
      notify.error('Payment failed', 'Stripe did not return a checkout URL. Please try again.');
    } catch (err) {
      notify.error('Failed to buy credits', (err as Error).message);
    }
    setBuyingId(null);
  };

  return (
    <section aria-labelledby="topup-heading" className={className}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="topup-heading" className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            {title}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-slate-500">{description}</p>
        </div>
      </div>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {topups.map((bundle) => (
          <li key={bundle.id} className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div>
              <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-50">
                {bundle.tokens.toLocaleString()}
                <span className="text-sm font-medium text-slate-400"> tokens</span>
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-indigo-600 dark:text-indigo-300">
                ${bundle.price.toFixed(2)}
              </p>
            </div>
            <Button fullWidth className="mt-5" onClick={() => buyTopup(bundle)} loading={buyingId === bundle.id}>
              Buy credits
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
