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
import { buildFeatureList } from '../utils/features';
import type { PricingPackage } from '../types';

function toPkg(pkg: any): PricingPackage {
  const features = pkg.features || {};
  return {
    ...pkg,
    id: pkg.slug || pkg.id,
    price: Number(pkg.priceCents) / 100,
    tokens: pkg.includedTokens,
    features: buildFeatureList(features),
  };
}

interface MetaInfo {
  devMode: boolean;
  integrations: Record<string, boolean>;
  paymentMethods?: { stripe: boolean; gateway: boolean };
  checkout?: {
    taxPercent: number;
    mdrPercent: number;
    pkrRate: number;
  };
  gatewayPayment?: {
    enabled: boolean;
    configured: boolean;
    sandbox: boolean;
    webhookUrl: string;
  };
}

const fallbackPackages: PricingPackage[] = [
  { id: 'facebook-only', name: 'Facebook Only', description: 'Perfect for Facebook-only presence', price: 5, tokens: 15, status: 'active', users: 0, sortOrder: 0, features: buildFeatureList({ facebook_publishing: true, instagram_publishing: false, whatsapp_broadcast: false, web_chat: false, voice_transcription: true, scheduled_publishing: false, analytics_dashboard: false, priority_support: false, ad_campaigns: false, custom_branding: false }) },
  { id: 'starter', name: 'Starter', description: 'Get started with social media', price: 15, tokens: 100, status: 'active', users: 0, sortOrder: 1, features: buildFeatureList({ facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: false, web_chat: false, voice_transcription: true, scheduled_publishing: false, analytics_dashboard: true, priority_support: false, ad_campaigns: false, custom_branding: false }) },
  { id: 'pro', name: 'Pro', description: 'For growing businesses', popular: true, price: 29, tokens: 1000, status: 'active', users: 0, sortOrder: 2, features: buildFeatureList({ facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: true, web_chat: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true, ad_campaigns: true, custom_branding: false }) },
  { id: 'exclusive', name: 'Exclusive', description: 'For agencies', price: 99, tokens: 3000, status: 'active', users: 0, sortOrder: 3, features: buildFeatureList({ facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: true, web_chat: true, voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true, ad_campaigns: true, custom_branding: true }) },
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
  const { refreshUser, user, endPackage } = useUserAuth();
  const [packages, setPackages] = React.useState<PricingPackage[]>(fallbackPackages);
  const [processing, setProcessing] = React.useState(false);
  const [meta, setMeta] = React.useState<MetaInfo | null>(null);
  const [method, setMethod] = React.useState<'stripe' | 'gateway'>('stripe');

  const hasActivePackage = user?.packageStatus === 'active';

  const testMode = !!meta?.devMode && !meta?.integrations?.stripe;

  const stripeMethodOn = !!meta?.paymentMethods?.stripe;
  const gatewayMethodOn = !!meta?.paymentMethods?.gateway;
  const gatewayPayment = meta?.gatewayPayment;
  const gatewayReady = !!gatewayPayment?.configured;
  const hasMethodChoice = [stripeMethodOn, gatewayMethodOn].filter(Boolean).length > 1;

  const numOr = (v: number | undefined, fb: number) => (v === undefined || Number.isNaN(v) ? fb : v);
  const taxPercent = numOr(meta?.checkout?.taxPercent, 8);
  const mdrPercent = numOr(meta?.checkout?.mdrPercent, 2);
  const pkrRate = numOr(meta?.checkout?.pkrRate, 0);

  React.useEffect(() => {
    if (!meta) return;
    const methods = meta.paymentMethods;
    if (!methods) return;
    if (methods.stripe) setMethod('stripe');
    else if (methods.gateway) setMethod('gateway');
    else setMethod('stripe');
  }, [meta]);

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

  const [card, setCard] = React.useState<CardState>(emptyCard);
  const [errors, setErrors] = React.useState<Partial<Record<keyof CardState, string>>>({});

  const pkg = packages.find(p => p.id === params.get('plan')) || packages[0];

  const tax = method === 'gateway' ? 0 : Math.round((pkg.price * taxPercent) / 100 * 100) / 100;
  const total = pkg.price + tax;
  const basePkr = pkrRate > 0 ? Math.round(total * pkrRate) : 0;
  const mdrPkr = method === 'gateway' && pkrRate > 0 ? Math.round(basePkr * (mdrPercent / 100)) : 0;
  const pkrTotal = basePkr + mdrPkr;

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
    if (hasActivePackage) {
      notify.error('Active package', 'End your current package first, then buy a new one.');
      return;
    }
    if (method === 'stripe' && !testMode && !validate()) return;
    if (method === 'gateway' && !gatewayReady) {
      notify.error('Gateway not configured', 'The payment gateway is not set up yet. Choose another method.');
      return;
    }
    setProcessing(true);
    try {
      const result = await apiRequest<{ sessionId: string; url: string; mock?: boolean; tokensGranted?: number; newBalance?: number }>(endpoints.checkout, {
        method: 'POST',
        body: JSON.stringify({
          packageId: pkg.id,
          method,
        }),
      });
      if (result.mock) {
        await refreshUser();
        notify.success('Plan activated (test mode)', `${result.tokensGranted ?? 0} tokens added. No payment was charged.`);
        navigate('/connect');
        return;
      }
      if (result && result.url) {
        // Redirect to the hosted checkout page (Stripe or the payment gateway)
        window.location.href = result.url;
        return;
      }
      notify.error('Payment failed', 'The payment provider did not return a checkout URL. Please try again.');
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

            {params.get('payment') === 'gateway_done' && (
              <section aria-labelledby="gateway-done" className="mb-8 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 dark:border-emerald-500/40 dark:from-emerald-500/10 dark:to-slate-900">
                <h2 id="gateway-done" className="text-base font-bold text-emerald-800 dark:text-emerald-300">Payment received</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Your payment went through. Your package is being activated automatically — this usually takes a
                  few seconds. Check your WhatsApp for the confirmation, then head to your dashboard.
                </p>
                <Button className="mt-4" onClick={() => navigate('/connect')}>Go to dashboard</Button>
              </section>
            )}

            {hasActivePackage && (
              <section aria-labelledby="checkout-active-package" className="mb-8 rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5 dark:border-amber-500/40 dark:from-amber-500/10 dark:to-slate-900">
                <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <h2 id="checkout-active-package" className="text-base font-bold text-slate-900 dark:text-slate-50">
                      You already have an active package — {user?.packageName || 'current plan'}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      End your current package before buying. Remaining tokens will be forfeited.
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    disabled={processing}
                    onClick={async () => {
                      if (!window.confirm('End your current package? Remaining tokens will be forfeited.')) return;
                      setProcessing(true);
                      const result = await endPackage();
                      setProcessing(false);
                      if (result.success) {
                        notify.success('Package ended', 'You can now buy a new package.');
                      } else {
                        notify.error('Failed to end package', result.error || 'Please try again');
                      }
                    }}>
                    End current package
                  </Button>
                </div>
              </section>
            )}

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
                  {tax > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Estimated tax ({taxPercent}%)</dt>
                      <dd className="font-mono text-slate-900 dark:text-slate-100">${tax.toFixed(2)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                    <dt className="font-semibold text-slate-900 dark:text-slate-50">Total due today</dt>
                    <dd className="font-mono text-lg font-bold text-slate-900 dark:text-slate-50">${total.toFixed(2)}</dd>
                  </div>
                  {pkrRate > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">PKR equivalent</dt>
                      <dd className="font-mono text-slate-900 dark:text-slate-100">{basePkr.toLocaleString()} PKR</dd>
                    </div>
                  )}
                  {pkrRate > 0 && method === 'gateway' && mdrPkr > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Gateway fee ({mdrPercent}%)</dt>
                      <dd className="font-mono text-slate-900 dark:text-slate-100">{mdrPkr.toLocaleString()} PKR</dd>
                    </div>
                  )}
                  {pkrRate > 0 && method === 'gateway' && (
                    <div className="flex justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                      <dt className="font-semibold text-slate-900 dark:text-slate-50">Total (PKR)</dt>
                      <dd className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">{pkrTotal.toLocaleString()} PKR</dd>
                    </div>
                  )}
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
                    {testMode && method === 'stripe' ? 'test mode' : method === 'gateway' ? 'gateway payment' : 'stripe'}
                  </span>
                </div>

                {testMode && method === 'stripe' && (
                  <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
                    <p className="font-semibold">Test mode is ON</p>
                    <p className="mt-1">
                      Stripe is not configured yet, so this checkout will activate the plan immediately without
                      charging any money. No real payment is taken.
                    </p>
                  </div>
                )}

                {hasMethodChoice && (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setMethod('stripe')}
                      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${method === 'stripe' ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
                      <CreditCardIcon className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">Card (Stripe)</span>
                        <span className="mt-0.5 block text-xs text-slate-500">Pay securely by debit / credit card</span>
                      </span>
                    </button>
                    {gatewayMethodOn && (
                      <button
                        type="button"
                        onClick={() => setMethod('gateway')}
                        className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${method === 'gateway' ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
                        <CreditCardIcon className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-300" aria-hidden="true" />
                        <span>
                          <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">Card / JazzCash / EasyPaisa</span>
                          <span className="mt-0.5 block text-xs text-slate-500">Pay by card, wallet or Raast — verified instantly</span>
                        </span>
                      </button>
                    )}
                  </div>
                )}

                <form onSubmit={pay} className="mt-6 space-y-5" noValidate>
                    <div className={method === 'stripe' && !testMode ? 'rounded-2xl border border-slate-200 p-4 dark:border-slate-700' : 'hidden'}>
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

                    {method === 'gateway' && (
                      <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          <CreditCardIcon className="h-4 w-4" aria-hidden="true" />
                          Card / JazzCash / EasyPaisa (RapidGateway)
                        </div>
                        {pkrRate > 0 && (
                          <>
                            <p className="mt-4 font-mono text-2xl font-bold text-slate-900 dark:text-slate-50">
                              PKR {pkrTotal.toLocaleString()}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {basePkr.toLocaleString()} base + {mdrPkr.toLocaleString()} gateway fee ({mdrPercent}%)
                            </p>
                          </>
                        )}
                        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                          You will be redirected to a secure payment page where you can pay by debit/credit
                          card, JazzCash or EasyPaisa. Your package activates automatically the moment the
                          payment is confirmed — no manual verification needed.
                        </p>
                        {gatewayPayment?.sandbox && (
                          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                            The gateway is in sandbox (test) mode. Payments are simulated.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                      <Button variant="secondary" onClick={() => navigate('/packages')}>
                        Cancel
                      </Button>
                      <Button type="submit" loading={processing}>
                        {method === 'gateway'
                          ? (pkrRate > 0 ? `Pay PKR ${pkrTotal.toLocaleString()}` : 'Pay now')
                          : testMode
                            ? `Activate ${pkg.name} (test mode)`
                            : `Pay $${total.toFixed(2)}`}
                      </Button>
                    </div>
                  </form>

                <p className="mt-6 flex items-start gap-2 border-t border-slate-100 pt-5 text-xs text-slate-500 dark:border-slate-800">
                  <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                  {method === 'gateway'
                    ? 'Payments are verified instantly by the gateway webhook. Your card or wallet details never touch our servers.'
                    : testMode
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