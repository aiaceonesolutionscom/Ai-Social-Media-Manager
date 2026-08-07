import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckIcon, CreditCardIcon, LockIcon, XIcon } from 'lucide-react';
import { Navbar } from '../components/ui/Navbar';
import { Footer } from '../components/ui/Footer';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageTransition } from '../components/layout/PageTransition';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';
import { formatCurrency } from '../utils/format';
import type { PricingPackage } from '../types';

function toPkg(pkg: any): PricingPackage {
  const features = pkg.features || {};
  return {
    ...pkg,
    id: pkg.slug || pkg.id,
    price: Number(pkg.priceCents) / 100,
    tokens: pkg.includedTokens,
    features: Object.entries(FEATURE_LABELS).map(([key, label]) => ({
      label,
      included: features[key] === true,
    })),
  };
}

interface MetaInfo {
  devMode: boolean;
  integrations: Record<string, boolean>;
}

const FEATURE_LABELS: Record<string, string> = {
  facebook_publishing: 'Facebook publishing',
  instagram_publishing: 'Instagram publishing',
  whatsapp_broadcast: 'WhatsApp broadcasts',
  web_chat: 'Website support chat',
  voice_transcription: 'Voice to post transcription',
  scheduled_publishing: 'Scheduled auto-publishing',
  analytics_dashboard: 'Full analytics dashboard',
  priority_support: 'Priority support',
};

const fallbackPackages: PricingPackage[] = [
  { id: 'facebook-only', name: 'Facebook Only', description: 'Perfect for Facebook-only presence', price: 5, tokens: 15, status: 'active', users: 0, sortOrder: 0, features: [{ label: 'Facebook publishing', included: true }, { label: 'Instagram publishing', included: false }] },
  { id: 'starter', name: 'Starter', description: 'Get started with social media', price: 15, tokens: 100, status: 'active', users: 0, sortOrder: 1, features: [{ label: 'Facebook publishing', included: true }, { label: 'Instagram publishing', included: true }] },
  { id: 'pro', name: 'Pro', description: 'For growing businesses', popular: true, price: 29, tokens: 1000, status: 'active', users: 0, sortOrder: 2, features: [{ label: 'Facebook publishing', included: true }, { label: 'Instagram publishing', included: true }] },
  { id: 'exclusive', name: 'Exclusive', description: 'For agencies', price: 99, tokens: 3000, status: 'active', users: 0, sortOrder: 3, features: [{ label: 'Facebook publishing', included: true }, { label: 'Instagram publishing', included: true }] },
];

interface CardState {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
  zip: string;
}

const emptyCard: CardState = { number: '', expiry: '', cvc: '', name: '', zip: '' };

function formatCardNumber(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 16)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function Checkout() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useUserAuth();
  const [packages, setPackages] = React.useState<PricingPackage[]>(fallbackPackages);
  const [processing, setProcessing] = React.useState(false);
  const [meta, setMeta] = React.useState<MetaInfo | null>(null);

  const testMode = !!meta?.devMode && !meta?.integrations?.stripe;

  React.useEffect(() => {
    apiRequest<MetaInfo>(endpoints.meta).then(setMeta).catch(() => setMeta(null));
  }, []);

  React.useEffect(() => {
    const fetchPackages = async () => {
      try {
        const data = await apiRequest<any[]>(endpoints.packages);
        if (Array.isArray(data) && data.length > 0) {
          setPackages(data.sort((a, b) => a.sortOrder - b.sortOrder).map(toPkg));
        }
      } catch {
        // Use fallback
      }
    };
    fetchPackages();
  }, []);

  const pkg = packages.find(p => p.id === params.get('plan')) || packages[0];

  const [card, setCard] = React.useState<CardState>(emptyCard);
  const [errors, setErrors] = React.useState<Partial<Record<keyof CardState, string>>>({});

  const tax = Math.round(pkg.price * 0.08 * 100) / 100;
  const total = pkg.price + tax;

  const validate = (): boolean => {
    const next: Partial<Record<keyof CardState, string>> = {};
    if (card.number.replace(/\s/g, '').length !== 16) next.number = 'Enter a 16-digit card number';
    if (!/^\d{2}\/\d{2}$/.test(card.expiry)) next.expiry = 'Use MM/YY';
    if (card.cvc.length < 3) next.cvc = 'Enter the 3-digit CVC';
    if (card.name.trim().length < 3) next.name = 'Enter the name on the card';
    if (card.zip.trim().length < 4) next.zip = 'Enter a valid postal code';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testMode && !validate()) return;
    setProcessing(true);
    try {
      const result = await apiRequest<{ sessionId: string; url: string; mock?: boolean; tokensGranted?: number; newBalance?: number }>(endpoints.checkout, {
        method: 'POST',
        body: JSON.stringify({ packageId: pkg.id }),
      });
      if (result.mock) {
        await refreshUser();
        notify.success('Plan activated (test mode)', `${result.tokensGranted ?? 0} tokens added. No payment was charged.`);
        navigate('/connect');
        return;
      }
      if (result && result.url) {
        // Redirect to Stripe's hosted checkout page
        window.location.href = result.url;
        return;
      }
      notify.error('Payment failed', 'Stripe did not return a checkout URL. Please try again.');
    } catch (err) {
      notify.error('Payment failed', (err as Error).message);
    }
    setProcessing(false);
  };

  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <Navbar />
      <PageTransition>
        <main className="px-4 py-20">
          <div className="mx-auto max-w-5xl">
            <header className="mb-10">
              <p className="font-mono text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-300">Checkout</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                Confirm your plan
              </h1>
            </header>

            <div className="grid gap-6 lg:grid-cols-5">
              {/* Plan summary */}
              <section
                aria-labelledby="summary-heading"
                className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                
                <h2 id="summary-heading" className="text-base font-bold text-slate-900 dark:text-slate-50">
                  Plan summary
                </h2>
                <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-50">{pkg.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{pkg.description}</p>
                  <p className="mt-3 font-mono text-sm font-semibold text-indigo-600 dark:text-indigo-300">
                    {pkg.tokens.toLocaleString()} tokens / month
                  </p>
                </div>
                <ul className="mt-5 space-y-2.5">
                  {pkg.features.map((f) =>
                  <li key={f.label} className="flex items-start gap-2.5 text-sm">
                      {f.included ?
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" /> :

                    <XIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />
                    }
                      <span className={f.included ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 line-through'}>
                        {f.label}
                      </span>
                    </li>
                  )}
                </ul>
                <dl className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-sm dark:border-slate-800">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Subtotal</dt>
                    <dd className="font-mono text-slate-900 dark:text-slate-100">{formatCurrency(pkg.price)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Estimated tax</dt>
                    <dd className="font-mono text-slate-900 dark:text-slate-100">${tax.toFixed(2)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                    <dt className="font-semibold text-slate-900 dark:text-slate-50">Total due today</dt>
                    <dd className="font-mono text-lg font-bold text-slate-900 dark:text-slate-50">${total.toFixed(2)}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => navigate('/packages')}
                  className="mt-5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-slate-200">
                  
                  ← Change plan
                </button>
              </section>

              {/* Payment */}
              <section
                aria-labelledby="payment-heading"
                className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                
                <div className="flex items-center justify-between">
                  <h2 id="payment-heading" className="text-base font-bold text-slate-900 dark:text-slate-50">
                    Payment details
                  </h2>
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-400">
                    <LockIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {testMode ? 'test mode' : 'stripe'}
                  </span>
                </div>

                {testMode && (
                  <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
                    <p className="font-semibold">Test mode is ON</p>
                    <p className="mt-1">
                      Stripe is not configured yet, so this checkout will activate the plan immediately without
                      charging any money. No real payment is taken.
                    </p>
                  </div>
                )}

                <form onSubmit={pay} className="mt-6 space-y-5" noValidate>
                  <div className={testMode ? 'hidden' : 'rounded-2xl border border-slate-200 p-4 dark:border-slate-700'}>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <CreditCardIcon className="h-4 w-4" aria-hidden="true" />
                      Card element
                    </div>
                    <div className="mt-4 space-y-5">
                      <Input
                        label="Card number"
                        mono
                        inputMode="numeric"
                        placeholder="4242 4242 4242 4242"
                        value={card.number}
                        error={errors.number}
                        onChange={(e) => setCard((c) => ({ ...c, number: formatCardNumber(e.target.value) }))} />
                      
                      <div className="grid gap-5 sm:grid-cols-3">
                        <Input
                          label="Expiry"
                          mono
                          inputMode="numeric"
                          placeholder="04/29"
                          value={card.expiry}
                          error={errors.expiry}
                          onChange={(e) => setCard((c) => ({ ...c, expiry: formatExpiry(e.target.value) }))} />
                        
                        <Input
                          label="CVC"
                          mono
                          inputMode="numeric"
                          placeholder="123"
                          value={card.cvc}
                          error={errors.cvc}
                          onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
                        
                        <Input
                          label="Postal code"
                          mono
                          placeholder="94107"
                          value={card.zip}
                          error={errors.zip}
                          onChange={(e) => setCard((c) => ({ ...c, zip: e.target.value.slice(0, 10) }))} />
                        
                      </div>
                      <Input
                        label="Name on card"
                        placeholder="Maya Rodriguez"
                        value={card.name}
                        error={errors.name}
                        onChange={(e) => setCard((c) => ({ ...c, name: e.target.value }))} />
                      
                    </div>
                  </div>

                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <Button variant="secondary" onClick={() => navigate('/packages')}>
                      Cancel
                    </Button>
                    <Button type="submit" loading={processing}>
                      {testMode ? `Activate ${pkg.name} (test mode)` : `Pay $${total.toFixed(2)}`}
                    </Button>
                  </div>
                </form>

                <p className="mt-6 flex items-start gap-2 border-t border-slate-100 pt-5 text-xs text-slate-500 dark:border-slate-800">
                  <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                  {testMode
                    ? 'Test mode: no real payment is taken. When Stripe is configured this becomes a real checkout.'
                    : 'Payments are processed by Stripe with 256-bit TLS. EchoPost never stores your card details.'}
                </p>
              </section>
            </div>
          </div>
        </main>
      </PageTransition>
      <Footer />
    </div>);
}
