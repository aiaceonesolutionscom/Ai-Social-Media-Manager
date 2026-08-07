import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/ui/Navbar';
import { Footer } from '../components/ui/Footer';
import { PricingCard } from '../components/user/PricingCard';
import { PageTransition } from '../components/layout/PageTransition';
import { apiRequest, endpoints } from '../utils/api';
import type { PricingPackage } from '../types';

const fallbackPackages: PricingPackage[] = [
  {
    id: 'facebook-only', name: 'Facebook Only', description: 'Perfect for Facebook-only presence',
    price: 5, tokens: 15, status: 'active', users: 0, sortOrder: 0,
    features: [
      { label: 'Facebook publishing', included: true },
      { label: 'Instagram publishing', included: false },
      { label: 'WhatsApp broadcasts', included: false },
      { label: 'Voice to post transcription', included: true },
      { label: 'Scheduled auto-publishing', included: false },
      { label: 'Full analytics dashboard', included: false },
      { label: 'Priority support', included: false },
    ],
  },
  {
    id: 'starter', name: 'Starter', description: 'Get started with social media automation',
    price: 15, tokens: 100, status: 'active', users: 0, sortOrder: 1,
    features: [
      { label: 'Facebook publishing', included: true },
      { label: 'Instagram publishing', included: true },
      { label: 'WhatsApp broadcasts', included: false },
      { label: 'Voice to post transcription', included: true },
      { label: 'Scheduled auto-publishing', included: false },
      { label: 'Full analytics dashboard', included: true },
      { label: 'Priority support', included: false },
    ],
  },
  {
    id: 'pro', name: 'Pro', description: 'For growing businesses', popular: true,
    price: 29, tokens: 1000, status: 'active', users: 0, sortOrder: 2,
    features: [
      { label: 'Facebook publishing', included: true },
      { label: 'Instagram publishing', included: true },
      { label: 'WhatsApp broadcasts', included: true },
      { label: 'Voice to post transcription', included: true },
      { label: 'Scheduled auto-publishing', included: true },
      { label: 'Full analytics dashboard', included: true },
      { label: 'Priority support', included: true },
    ],
  },
  {
    id: 'exclusive', name: 'Exclusive', description: 'For agencies and large teams',
    price: 99, tokens: 3000, status: 'active', users: 0, sortOrder: 3,
    features: [
      { label: 'Facebook publishing', included: true },
      { label: 'Instagram publishing', included: true },
      { label: 'WhatsApp broadcasts', included: true },
      { label: 'Voice to post transcription', included: true },
      { label: 'Scheduled auto-publishing', included: true },
      { label: 'Full analytics dashboard', included: true },
      { label: 'Priority support', included: true },
    ],
  },
];

const FEATURE_LABELS: Record<string, string> = {
  facebook_publishing: 'Facebook publishing',
  instagram_publishing: 'Instagram publishing',
  whatsapp_broadcasts: 'WhatsApp broadcasts',
  voice_transcription: 'Voice to post transcription',
  scheduled_publishing: 'Scheduled auto-publishing',
  analytics_dashboard: 'Full analytics dashboard',
  priority_support: 'Priority support',
};

const fallbackTokenCosts = {
  standardPost: 1,
  crossPlatform: 2,
  imageRegenerate: 1,
  adCampaign: 5,
  voiceTranscription: 'Free',
  captionEditing: 'Free',
};

export function Packages() {
  const navigate = useNavigate();
  const [packages, setPackages] = React.useState<PricingPackage[]>(fallbackPackages);
  const [loading, setLoading] = React.useState(true);
  const [tokenCosts, setTokenCosts] = React.useState(fallbackTokenCosts);

  React.useEffect(() => {
    async function fetchPackages() {
      try {
        const data = await apiRequest<any[]>(endpoints.packages);
        if (data && data.length > 0) {
          const mapped: PricingPackage[] = data.sort((a, b) => a.sortOrder - b.sortOrder).map((p: any) => {
            const features = p.features || {};
            return {
              id: p.slug || p.id,
              name: p.name,
              description: p.description || '',
              price: p.priceCents / 100,
              tokens: p.includedTokens,
              status: p.isActive ? 'active' : 'inactive',
              users: 0,
              sortOrder: p.sortOrder,
              popular: p.slug === 'pro',
              features: Object.entries(FEATURE_LABELS).map(([key, label]) => ({
                label,
                included: features[key] === true,
              })),
            };
          });
          setPackages(mapped);
        }
      } catch {
        // use fallback packages
      } finally {
        setLoading(false);
      }
    }
    fetchPackages();

    apiRequest<any>(endpoints.tokenCosts)
      .then(setTokenCosts)
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <Navbar />
      <PageTransition>
        <main className="px-4 py-20">
          <div className="mx-auto max-w-6xl">
            <header className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-300">Step 2 of 4</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
                Choose your package
              </h1>
              <p className="mt-3 text-slate-500">
                Tokens are spent when EchoPost generates or publishes a post. You can upgrade or top up at any time.
              </p>
            </header>
            {loading ? (
              <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-80 rounded-2xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <ul className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {packages.map((pkg, i) => (
                  <PricingCard key={pkg.id} pkg={pkg} index={i} onSelect={(p) => navigate(`/checkout?plan=${p.id}`)} />
                ))}
              </ul>
            )}
            <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">How tokens are spent</h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                {[
                  { label: 'Standard Post (IG or FB)', value: `${tokenCosts.standardPost} token${tokenCosts.standardPost !== 1 ? 's' : ''}` },
                  { label: 'Cross-Platform (IG + FB)', value: `${tokenCosts.crossPlatform} token${tokenCosts.crossPlatform !== 1 ? 's' : ''}` },
                  { label: 'Image Regenerate', value: `${tokenCosts.imageRegenerate} token${tokenCosts.imageRegenerate !== 1 ? 's' : ''}` },
                  { label: 'Ad Campaign', value: `${tokenCosts.adCampaign} token${tokenCosts.adCampaign !== 1 ? 's' : ''}` },
                  { label: 'Voice Transcription', value: tokenCosts.voiceTranscription },
                  { label: 'Caption Editing', value: tokenCosts.captionEditing },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                    <dt className="text-xs text-slate-500">{item.label}</dt>
                    <dd className="font-mono text-sm font-bold text-slate-900 dark:text-slate-50">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </main>
      </PageTransition>
      <Footer />
    </div>
  );
}
