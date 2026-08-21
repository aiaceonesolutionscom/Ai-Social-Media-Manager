import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon } from 'lucide-react';
import { Navbar } from '../components/ui/Navbar';
import { Footer } from '../components/ui/Footer';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PlatformStatus } from '../components/user/PlatformStatus';
import { PageTransition } from '../components/layout/PageTransition';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';
import type { Platform } from '../types';
import { cn } from '../utils/cn';

const steps = ['Sign Up', 'Payment', 'Connect APIs', 'Start Posting'];
const currentStep = 2;

const PLATFORM_FEATURE_MAP: Record<string, string> = {
  facebook: 'facebook_publishing',
  instagram: 'instagram_publishing',
  meta_ads: 'ad_campaigns',
  whatsapp: 'whatsapp_broadcast',
};

const ALL_PLATFORMS: Platform[] = [
  { id: 'instagram', name: 'Instagram', description: 'Share photos and reels to your feed', status: 'disconnected' },
  { id: 'facebook', name: 'Facebook', description: 'Post to your Facebook Page', status: 'disconnected' },
  { id: 'meta_ads', name: 'Meta Ads', description: 'Run ad campaigns on your Meta Ads account', status: 'disconnected' },
  { id: 'whatsapp', name: 'WhatsApp', description: 'Verify your WhatsApp number to start posting', status: 'disconnected' },
];

export function Connect() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useUserAuth();
  const [platforms, setPlatforms] = React.useState<Platform[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [devMode, setDevMode] = React.useState(false);
  const [waForm, setWaForm] = React.useState({
    open: false,
    step: 'phone' as 'phone' | 'otp',
    phoneNumber: '',
    code: '',
    devCode: '',
    sending: false,
    verifying: false,
  });

  React.useEffect(() => {
    apiRequest<{ devMode: boolean }>(endpoints.meta)
      .then((m) => setDevMode(!!m.devMode))
      .catch(() => setDevMode(false));
  }, []);

  React.useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    async function fetchAccounts() {
      try {
        const [accounts, pkgData] = await Promise.all([
          apiRequest<any[]>(endpoints.socialAccounts),
          apiRequest<{ features: Record<string, boolean> }>(endpoints.userPackage).catch(() => ({ features: {} as Record<string, boolean> })),
        ]);

        const features = pkgData.features || {};
        const hasAnyFeature = Object.keys(features).length > 0;

        const allowedPlatforms = ALL_PLATFORMS.filter((p) => {
          const featureKey = PLATFORM_FEATURE_MAP[p.id];
          if (!featureKey) return true;
          if (!hasAnyFeature) return true;
          return features[featureKey] === true;
        });

        const platformList: Platform[] = allowedPlatforms.map((p) => ({ ...p, status: 'disconnected' as const }));

        for (const acc of accounts) {
          const p = platformList.find(pl => pl.id === acc.platform);
          if (p) {
            p.status = acc.status || 'connected';
            p.account = acc.accountName || acc.accountId;
          }
        }
        setPlatforms(platformList);
      } catch {
        setPlatforms([...ALL_PLATFORMS]);
      }
    }
    fetchAccounts();
  }, [isAuthenticated, authLoading, navigate]);

  const connect = async (platform: Platform) => {
    setBusy(platform.id);

    // For Facebook, Instagram and Meta Ads, redirect to OAuth
    if (platform.id === 'facebook' || platform.id === 'instagram' || platform.id === 'meta_ads') {
      // H6 — never pass the user token in the URL. Mint a short-lived code from
      // the server and redirect with that instead.
      try {
        const res = await apiRequest<{ code: string }>(endpoints.socialConnectIntent, { method: 'POST' });
        const provider = platform.id === 'meta_ads' ? 'facebook' : platform.id;
        window.location.href = `${window.location.origin}/api/social/connect/${provider}?code=${encodeURIComponent(res.code)}`;
      } catch (err) {
        notify.error('Connection failed', (err as Error).message);
        setBusy(null);
      }
      return;
    }

    // For WhatsApp, open the OTP verification dialog
    if (platform.id === 'whatsapp') {
      setWaForm((f) => ({ ...f, open: true, step: 'phone', phoneNumber: '', code: '', devCode: '' }));
    }

    setBusy(null);
  };

  const sendOtp = async () => {
    if (!waForm.phoneNumber) return;
    setWaForm((f) => ({ ...f, sending: true }));
    try {
      const res = await apiRequest<{ devCode?: string }>(`${endpoints.socialConnect('whatsapp')}/send-otp`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: waForm.phoneNumber }),
      });
      setWaForm((f) => ({ ...f, step: 'otp', sending: false, devCode: res.devCode || '' }));
      if (res.devCode) {
        notify.info('Test mode', `Your verification code is: ${res.devCode}`);
      } else {
        notify.success('Code sent', 'Check your WhatsApp for the verification code.');
      }
    } catch (err) {
      notify.error('Failed to send code', (err as Error).message);
      setWaForm((f) => ({ ...f, sending: false }));
    }
  };

  const verifyOtp = async () => {
    setWaForm((f) => ({ ...f, verifying: true }));
    try {
      await apiRequest(endpoints.socialConnect('whatsapp'), {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: waForm.phoneNumber, verificationCode: waForm.code }),
      });
      setPlatforms((prev) =>
        prev.map((p) =>
          p.id === 'whatsapp'
            ? { ...p, status: 'connected', account: waForm.phoneNumber }
            : p
        )
      );
      notify.success('WhatsApp connected', 'You can now publish to this channel.');
      setWaForm((f) => ({ ...f, open: false, verifying: false, phoneNumber: '', code: '' }));
    } catch (err) {
      notify.error('Verification failed', (err as Error).message);
      setWaForm((f) => ({ ...f, verifying: false }));
    }
  };

  const disconnect = async (platform: Platform) => {
    try {
      const accounts = await apiRequest<any[]>(endpoints.socialAccounts);
      const account = accounts.find((a: any) => a.platform === platform.id);
      if (account) {
        await apiRequest(endpoints.socialDisconnect(account.id), { method: 'DELETE' });
      }
      setPlatforms((prev) => prev.map((p) => p.id === platform.id ? { ...p, status: 'disconnected', account: undefined } : p));
      notify.info(`${platform.name} disconnected`);
    } catch (err) {
      notify.error('Disconnect failed', (err as Error).message);
    }
  };

  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <Navbar />
      <PageTransition>
        <main className="px-4 py-20">
          <div className="mx-auto max-w-5xl">
            {/* Progress steps */}
            <nav aria-label="Onboarding progress">
              <ol className="flex flex-col gap-4 sm:flex-row sm:items-center">
                {steps.map((step, i) => (
                  <li key={step} className="flex flex-1 items-center gap-3">
                    <span
                      className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-xs font-bold',
                        i < currentStep && 'bg-emerald-500 text-white',
                        i === currentStep && 'bg-indigo-600 text-white',
                        i > currentStep && 'bg-slate-200 text-slate-500 dark:bg-slate-800'
                      )}
                      aria-current={i === currentStep ? 'step' : undefined}>
                      {i < currentStep ? <CheckIcon className="h-4 w-4" aria-hidden="true" /> : i + 1}
                    </span>
                    <span className={cn('text-sm font-medium', i === currentStep ? 'text-slate-900 dark:text-slate-50' : 'text-slate-500')}>
                      {step}
                    </span>
                    {i < steps.length - 1 && <span className="hidden h-px flex-1 bg-slate-200 sm:block dark:bg-slate-800" aria-hidden="true" />}
                  </li>
                ))}
              </ol>
            </nav>

            <header className="mt-12 max-w-2xl">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
                Connect your channels
              </h1>
              <p className="mt-3 text-slate-500">
                Authorize the accounts you want EchoPost to publish to. You can add or remove channels later in settings.
              </p>
            </header>

            {devMode && (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="font-semibold">Test mode is ON</p>
                <p className="mt-1">
                  Facebook/Instagram connections are simulated (no real account needed). WhatsApp will show the
                  verification code on screen instead of sending a real message.
                </p>
              </div>
            )}

            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {platforms.map((platform) => (
                <PlatformStatus
                  key={platform.id}
                  platform={platform}
                  action={
                    platform.status === 'connected' ? (
                      <Button variant="secondary" fullWidth onClick={() => disconnect(platform)}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button fullWidth loading={busy === platform.id} onClick={() => connect(platform)}>
                        {platform.id === 'whatsapp' ? 'Verify number' : `Connect ${platform.name}`}
                      </Button>
                    )
                  }
                />
              ))}
            </div>

            <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => {
                notify.info('Skipped for now', 'You can connect channels any time from settings.');
                navigate('/dashboard');
              }}>
                Skip for now
              </Button>
              <Button onClick={() => navigate('/dashboard')}>Continue to dashboard</Button>
            </div>
          </div>
        </main>
      </PageTransition>

      <Modal
        open={waForm.open}
        onClose={() => setWaForm((f) => ({ ...f, open: false }))}
        title="Verify WhatsApp number"
        description="We will send a verification code to your WhatsApp.">
        {waForm.step === 'phone' ? (
          <form
            onSubmit={(e) => { e.preventDefault(); sendOtp(); }}
            className="space-y-4">
            <Input
              label="Phone number (with country code)"
              placeholder="+1 555 123 4567"
              inputMode="tel"
              value={waForm.phoneNumber}
              onChange={(e) => setWaForm((f) => ({ ...f, phoneNumber: e.target.value.replace(/[^\d+]/g, '') }))}
            />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" type="button" onClick={() => setWaForm((f) => ({ ...f, open: false }))}>
                Cancel
              </Button>
              <Button type="submit" loading={waForm.sending}>
                Send code
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); verifyOtp(); }}
            className="space-y-4">
            {waForm.devCode && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
                Test mode: your verification code is{' '}
                <code className="font-mono text-base font-bold">{waForm.devCode}</code>
              </div>
            )}
            <Input
              label="Verification code"
              placeholder="6-digit code"
              inputMode="numeric"
              value={waForm.code}
              onChange={(e) => setWaForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
            />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" type="button" onClick={() => setWaForm((f) => ({ ...f, step: 'phone' }))}>
                Back
              </Button>
              <Button type="submit" loading={waForm.verifying}>
                Verify & connect
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Footer />
    </div>
  );
}
