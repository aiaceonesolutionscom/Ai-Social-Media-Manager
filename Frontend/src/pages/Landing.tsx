import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BarChart3Icon,
  CheckIcon,
  MicIcon,
  PlayIcon,
  SendIcon,
  SparklesIcon,
  WandSparklesIcon } from
'lucide-react';
import { Navbar } from '../components/ui/Navbar';
import { Footer } from '../components/ui/Footer';
import { Button } from '../components/ui/Button';
import { PricingCard } from '../components/user/PricingCard';
import { PageTransition } from '../components/layout/PageTransition';
import { LandingChat } from '../components/LandingChat';
import { apiRequest, endpoints } from '../utils/api';
import { buildFeatureList } from '../utils/features';
import type { PricingPackage } from '../types';

const fallbackPackages: PricingPackage[] = [
  { id: 'facebook-only', name: 'Facebook Only', description: 'Perfect for Facebook-only presence', price: 5, tokens: 15, status: 'active', users: 0, sortOrder: 0, features: buildFeatureList({
    facebook_publishing: true, instagram_publishing: false, whatsapp_broadcast: false, web_chat: false,
    voice_transcription: true, scheduled_publishing: false, analytics_dashboard: false, priority_support: false,
    ad_campaigns: false, custom_branding: false,
  })},
  { id: 'starter', name: 'Starter', description: 'Get started with social media', price: 15, tokens: 100, status: 'active', users: 0, sortOrder: 1, features: buildFeatureList({
    facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: false, web_chat: false,
    voice_transcription: true, scheduled_publishing: false, analytics_dashboard: true, priority_support: false,
    ad_campaigns: false, custom_branding: false,
  })},
  { id: 'pro', name: 'Pro', description: 'For growing businesses', popular: true, price: 29, tokens: 1000, status: 'active', users: 0, sortOrder: 2, features: buildFeatureList({
    facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: true, web_chat: true,
    voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true,
    ad_campaigns: true, custom_branding: false,
  })},
  { id: 'exclusive', name: 'Exclusive', description: 'For agencies', price: 99, tokens: 3000, status: 'active', users: 0, sortOrder: 3, features: buildFeatureList({
    facebook_publishing: true, instagram_publishing: true, whatsapp_broadcast: true, web_chat: true,
    voice_transcription: true, scheduled_publishing: true, analytics_dashboard: true, priority_support: true,
    ad_campaigns: true, custom_branding: true,
  })},
];

function mapApiPackage(pkg: any): PricingPackage {
  const features = pkg.features || {};
  return {
    id: pkg.slug || pkg.id,
    name: pkg.name,
    description: pkg.description || '',
    price: pkg.priceCents / 100,
    tokens: pkg.includedTokens,
    status: pkg.isActive ? 'active' : 'inactive',
    users: 0,
    sortOrder: pkg.sortOrder,
    popular: pkg.slug === 'pro',
    features: buildFeatureList(features),
  };
}

const features = [
{
  icon: MicIcon,
  title: 'Voice to Post',
  description:
  'Record a 20-second voice note. EchoPost transcribes it, finds the hook, and writes a caption in your own tone of voice.'
},
{
  icon: SendIcon,
  title: 'Auto Publish',
  description:
  'Connect Instagram, Facebook and WhatsApp once. Approve a post and it goes out instantly — or on the schedule you set.'
},
{
  icon: BarChart3Icon,
  title: 'Analytics',
  description:
  'See which voice notes turned into your best-performing posts, track token usage, and double down on what works.'
}];


const steps = [
{ title: 'Speak', description: 'Tap record and talk for 20 seconds about anything you want to share.' },
{ title: 'Generate', description: 'Our model drafts platform-native captions, hashtags and a hook.' },
{ title: 'Approve', description: 'Edit anything you want, then approve with one tap.' },
{ title: 'Publish', description: 'EchoPost posts to every connected channel and logs the results.' }];


const fallbackTokenCosts = {
  standardPost: 1,
  crossPlatform: 2,
  imageRegenerate: 1,
  adCampaign: 5,
  voiceTranscription: 'Free',
  captionEditing: 'Free',
};

export function Landing() {
  const navigate = useNavigate();
  const [packages, setPackages] = React.useState<PricingPackage[]>(fallbackPackages);
  const [tokenCosts, setTokenCosts] = React.useState(fallbackTokenCosts);

  React.useEffect(() => {
    const fetchPackages = async () => {
      try {
        const data = await apiRequest<any[]>(endpoints.packages);
        if (Array.isArray(data) && data.length > 0) {
          setPackages(data.sort((a, b) => a.sortOrder - b.sortOrder).map(mapApiPackage));
        }
      } catch {
        // Use fallback
      }
    };
    fetchPackages();

    apiRequest<any>(endpoints.tokenCosts)
      .then(setTokenCosts)
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <Navbar />
      <PageTransition>
        <main>
          {/* Hero */}
          <section className="px-4 py-20">
            <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
              <div>
                <motion.span
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
                  
                  <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  AI social media manager
                </motion.span>
                <motion.h1
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.05 }}
                  className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl lg:text-6xl">
                  
                  Turn Your Voice into Social Media Posts
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.12 }}
                  className="mt-5 max-w-xl text-lg text-slate-500">
                  
                  Record a voice note on the way to work. EchoPost writes the caption, picks the hashtags and publishes to
                  Instagram, Facebook and WhatsApp — before you park.
                </motion.p>
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.18 }}
                  className="mt-8 flex flex-col gap-3 sm:flex-row">
                  
                  <Button size="lg" onClick={() => navigate('/signup')}>
                    Start free with 15 tokens
                  </Button>
                  <Button size="lg" variant="secondary" onClick={() => navigate('/packages')}>
                    <PlayIcon className="h-4 w-4" aria-hidden="true" />
                    See the plans
                  </Button>
                </motion.div>
                <dl className="mt-10 grid max-w-md grid-cols-3 gap-6">
                  {[
                  { label: 'Posts published', value: '128k' },
                  { label: 'Avg. time saved', value: '6 hrs/wk' },
                  { label: 'Creators onboard', value: '4,200' }].
                  map((stat) =>
                  <div key={stat.label}>
                      <dt className="text-xs text-slate-500">{stat.label}</dt>
                      <dd className="font-mono text-xl font-bold text-slate-900 dark:text-slate-50">{stat.value}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: 0.15 }}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                aria-hidden="true">
                
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white">
                    <MicIcon className="h-5 w-5" />
                  </span>
                  <div className="flex h-8 flex-1 items-end gap-1">
                    {[8, 18, 12, 26, 32, 20, 28, 14, 22, 30, 16, 24, 10, 20, 26, 12].map((h, i) =>
                    <motion.span
                      key={i}
                      className="w-1.5 rounded-full bg-indigo-300 dark:bg-indigo-500/60"
                      initial={{ height: 4 }}
                      animate={{ height: [4, h, 8, h * 0.7, 4] }}
                      transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.06, ease: 'easeInOut' }} />

                    )}
                  </div>
                  <span className="font-mono text-xs text-slate-400">0:19</span>
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-600">
                  <WandSparklesIcon className="h-3.5 w-3.5" />
                  Caption generated
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  “Three takes, one keeper. Here's what actually goes into a 15-second product shot — and why the messy
                  version is the one that converts. 🎬”
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['#behindthescenes', '#smallbusiness', '#contentstrategy'].map((tag) =>
                  <span
                    key={tag}
                    className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] text-slate-500 dark:bg-slate-800">
                    
                      {tag}
                    </span>
                  )}
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
                  <span className="font-mono text-xs text-slate-400">3 tokens used</span>
                  <span className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">
                    Publish to 3 channels
                  </span>
                </div>
              </motion.div>
            </div>
          </section>

          {/* Features */}
          <section id="features" className="scroll-mt-20 px-4 py-20">
            <div className="mx-auto max-w-6xl">
              <div className="max-w-2xl">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
                  Everything between the idea and the post
                </h2>
                <p className="mt-3 text-slate-500">
                  You bring the thinking out loud. EchoPost handles the writing, formatting, scheduling and reporting.
                </p>
              </div>
              <ul className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {features.map((feature, i) =>
                <motion.li
                  key={feature.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.3, delay: i * 0.07 }}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                  
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                      <feature.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-5 text-lg font-bold text-slate-900 dark:text-slate-50">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">{feature.description}</p>
                  </motion.li>
                )}
              </ul>
            </div>
          </section>

          {/* How it works */}
          <section id="how-it-works" className="scroll-mt-20 bg-white px-4 py-20 dark:bg-slate-900">
            <div className="mx-auto max-w-6xl">
              <div className="max-w-2xl">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
                  How it works
                </h2>
                <p className="mt-3 text-slate-500">Four steps, about ninety seconds, no content calendar required.</p>
              </div>
              <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {steps.map((step, i) =>
                <motion.li
                  key={step.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.3, delay: i * 0.07 }}
                  className="relative rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-950">
                  
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 font-mono text-sm font-bold text-white dark:bg-white dark:text-slate-900">
                      {i + 1}
                    </span>
                    <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-slate-50">{step.title}</h3>
                    <p className="mt-2 text-sm text-slate-500">{step.description}</p>
                  </motion.li>
                )}
              </ol>
            </div>
          </section>

          {/* Pricing */}
          <section id="pricing" className="scroll-mt-20 px-4 py-20">
            <div className="mx-auto max-w-6xl">
              <div className="max-w-2xl">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
                  Simple, token-based pricing
                </h2>
                <p className="mt-3 text-slate-500">
                  Every generated post costs tokens. Pick the bundle that fits how often you publish.
                </p>
              </div>
              <ul className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {packages.map((pkg, i) =>
                <PricingCard key={pkg.id} pkg={pkg} index={i} onSelect={(p) => navigate(`/checkout?plan=${p.id}`)} />
                )}
              </ul>
              <p className="mt-8 flex items-center justify-center gap-2 text-sm text-slate-500">
                <CheckIcon className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                Cancel anytime. Unused tokens roll over for 30 days.
              </p>
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
          </section>
        </main>
      </PageTransition>
      <Footer />
      <LandingChat />
    </div>);

}