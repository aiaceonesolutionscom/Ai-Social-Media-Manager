import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/ui/Navbar';
import { Footer } from '../components/ui/Footer';
import { PricingCard } from '../components/user/PricingCard';
import { BuyCreditsSection } from '../components/user/BuyCreditsSection';
import { PageTransition } from '../components/layout/PageTransition';
import { apiRequest, endpoints } from '../utils/api';
import { buildFeatureList } from '../utils/features';
import type { PricingPackage } from '../types';

const fallbackPackages: PricingPackage[] = [
  {
    id: 'facebook-only', name: 'Facebook Only', description: 'Perfect for Facebook-only presence',
    price: 5, tokens: 15, status: 'active', users: 0, sortOrder: 0,
    billingPeriod: 'monthly', setupType: 'none',
    features: buildFeatureList({
      facebook_publishing: true,
      instagram_publishing: false,
      whatsapp_broadcast: false,
      web_chat: false,
      voice_transcription: true,
      scheduled_publishing: false,
      analytics_dashboard: false,
      priority_support: false,
      ad_campaigns: false,
      custom_branding: false,
    }),
  },
  {
    id: 'starter', name: 'Starter', description: 'Get started with social media automation',
    price: 15, tokens: 100, status: 'active', users: 0, sortOrder: 1,
    billingPeriod: 'monthly', setupType: 'none',
    features: buildFeatureList({
      facebook_publishing: true,
      instagram_publishing: true,
      whatsapp_broadcast: false,
      web_chat: false,
      voice_transcription: true,
      scheduled_publishing: false,
      analytics_dashboard: true,
      priority_support: false,
      ad_campaigns: false,
      custom_branding: false,
    }),
  },
  {
    id: 'pro', name: 'Pro', description: 'For growing businesses', popular: true,
    price: 29, tokens: 1000, status: 'active', users: 0, sortOrder: 2,
    billingPeriod: 'monthly', setupType: 'none',
    features: buildFeatureList({
      facebook_publishing: true,
      instagram_publishing: true,
      whatsapp_broadcast: true,
      web_chat: true,
      voice_transcription: true,
      scheduled_publishing: true,
      analytics_dashboard: true,
      priority_support: true,
      ad_campaigns: true,
      custom_branding: false,
    }),
  },
  {
    id: 'exclusive', name: 'Exclusive', description: 'For agencies and large teams',
    price: 99, tokens: 3000, status: 'active', users: 0, sortOrder: 3,
    billingPeriod: 'monthly', setupType: 'none',
    features: buildFeatureList({
      facebook_publishing: true,
      instagram_publishing: true,
      whatsapp_broadcast: true,
      web_chat: true,
      voice_transcription: true,
      scheduled_publishing: true,
      analytics_dashboard: true,
      priority_support: true,
      ad_campaigns: true,
      custom_branding: true,
    }),
  },
];

const fallbackTokenCosts = {
  standardPost: 1,
  crossPlatform: 2,
  imageRegenerate: 1,
  adCampaign: 5,
  voiceTranscription: 'Free',
  captionEditing: 'Free',
};

function SectionHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? (
        <p className="font-mono text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-300">{eyebrow}</p>
      ) : null}
      <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{title}</h2>
      {description ? <p className="mt-2 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

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
              billingPeriod: p.billingPeriod === 'yearly' ? 'yearly' : 'monthly',
              yearlyPrice: p.yearlyPriceCents ? p.yearlyPriceCents / 100 : undefined,
              setupType: p.setupType === 'standard' || p.setupType === 'premium' ? p.setupType : 'none',
              features: buildFeatureList(features),
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
      .catch(() => undefined);
  }, []);

  const monthly = packages.filter((p) => p.billingPeriod !== 'yearly' && (!p.setupType || p.setupType === 'none'));
  const yearly = packages.filter((p) => p.billingPeriod === 'yearly');
  const setup = packages.filter((p) => p.setupType === 'standard' || p.setupType === 'premium');

  const handleCheckout = (pkg: PricingPackage) => {
    navigate(`/checkout?plan=${pkg.id}`);
  };

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
                Tokens are spent when EchoPost generates or publishes a post. Pick a monthly or yearly plan — yearly
                plans come with 2 months free — or add a one-time setup package. You can upgrade or top up at any time.
              </p>
            </header>

            {loading ? (
              <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-80 rounded-2xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <section aria-labelledby="monthly-plans-heading" className="mt-12">
                  <SectionHeading
                    eyebrow="Billed monthly"
                    title="Monthly plans"
                    description={`${monthly.length} monthly plans with flexible options for every stage of growth.`}
                  />
                  <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    {monthly.map((pkg) => (
                      <PricingCard key={pkg.id} pkg={pkg} index={pkg.sortOrder} onSelect={handleCheckout} />
                    ))}
                  </div>
                </section>

                {yearly.length > 0 && (
                  <section aria-labelledby="yearly-plans-heading" className="mt-14">
                    <SectionHeading
                      eyebrow="Save 2 months — 17% off"
                      title="Yearly plans"
                      description="Pay once a year and get 12 months for the price of 10."
                    />
                    <div className="mt-6 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <span className="font-bold">Yearly offer:</span> every yearly plan includes 2 months free
                      compared to paying monthly.
                    </div>
                    <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                      {yearly.map((pkg) => (
                        <PricingCard key={pkg.id} pkg={pkg} index={pkg.sortOrder} onSelect={handleCheckout} />
                      ))}
                    </div>
                  </section>
                )}

                {setup.length > 0 && (
                  <section aria-labelledby="setup-packages-heading" className="mt-14">
                    <SectionHeading
                      eyebrow="One-time"
                      title="Setup packages"
                      description="Professional setup handled for you — billed once, not per month."
                    />
                    <div className="mt-6 grid gap-6 md:grid-cols-2">
                      {setup.map((pkg) => (
                        <PricingCard key={pkg.id} pkg={pkg} index={pkg.sortOrder} onSelect={handleCheckout} />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            <BuyCreditsSection className="mt-14" />

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
