import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpenIcon,
  CalendarClockIcon,
  CoinsIcon,
  ImageIcon,
  MessageCircleIcon,
  MicIcon,
  PackageIcon,
  PaletteIcon,
  SendIcon,
  SparklesIcon,
  UserRoundIcon,
} from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { apiRequest, endpoints } from '../utils/api';

interface TokenCosts {
  standardPost: number | string;
  crossPlatform: number | string;
  imageRegenerate: number | string;
  adCampaign: number | string;
  voiceTranscription: number | string;
  captionEditing: number | string;
}

const fallbackTokenCosts: TokenCosts = {
  standardPost: 1,
  crossPlatform: 2,
  imageRegenerate: 1,
  adCampaign: 5,
  voiceTranscription: 'Free',
  captionEditing: 'Free',
};

const gettingStarted = [
  { icon: MicIcon, title: '1. Speak', body: 'Send a WhatsApp voice note to your connected number, or describe your idea in the Chat tab. EchoPost transcribes it and drafts a post.' },
  { icon: SparklesIcon, title: '2. Generate', body: 'AI writes a platform-native caption with hooks and hashtags, in your own brand voice. You can edit anything before publishing.' },
  { icon: SendIcon, title: '3. Approve & publish', body: 'Approve the post and it goes live instantly, or schedule it for later from the Scheduled tab.' },
  { icon: CalendarClockIcon, title: '4. Track', body: 'Review results in History, reuse images in Media, and watch your usage on the Dashboard.' },
];

const featureMap = [
  { icon: MessageCircleIcon, title: 'Chat', where: '/dashboard/chat', what: 'Build posts and ads with the AI chatbot using plain English.', plan: 'web_chat' },
  { icon: SparklesIcon, title: 'Approval Queue', where: '/dashboard/approval', what: 'Review and approve posts waiting to be published.', plan: 'Facebook / Instagram publishing' },
  { icon: BookOpenIcon, title: 'History', where: '/dashboard/history', what: 'All your published and failed posts, with links to view them live.', plan: 'Facebook / Instagram publishing' },
  { icon: CalendarClockIcon, title: 'Scheduled', where: '/dashboard/scheduled', what: 'Schedule posts and ads to publish automatically at a chosen time.', plan: 'scheduled_publishing' },
  { icon: ImageIcon, title: 'Media Library', where: '/dashboard/media', what: 'Every generated image from your posts, ready to reuse.', plan: 'Facebook / Instagram publishing' },
  { icon: PaletteIcon, title: 'Branding', where: '/dashboard/branding', what: 'Set your brand name, voice, tone, colors and logo so posts always sound like you.', plan: 'custom_branding' },
  { icon: CoinsIcon, title: 'Packages & Credits', where: '/packages', what: 'Choose a plan or buy extra credits. Top-ups add tokens without changing your plan.', plan: 'All plans' },
  { icon: UserRoundIcon, title: 'Profile', where: '/dashboard/profile', what: 'Update your name, email, avatar, password — and buy extra credits.', plan: 'All plans' },
  { icon: SendIcon, title: 'Connect accounts', where: '/connect', what: 'Connect Facebook, Instagram, WhatsApp and Meta Ads to publish automatically.', plan: 'All plans' },
];

export function GuidePage() {
  const navigate = useNavigate();
  const [tokenCosts, setTokenCosts] = React.useState<TokenCosts>(fallbackTokenCosts);

  React.useEffect(() => {
    apiRequest<TokenCosts>(endpoints.tokenCosts)
      .then(setTokenCosts)
      .catch(() => undefined);
  }, []);

  const costItems = [
    { label: 'Standard Post (IG or FB)', value: `${tokenCosts.standardPost} token${Number(tokenCosts.standardPost) !== 1 ? 's' : ''}` },
    { label: 'Cross-Platform (IG + FB)', value: `${tokenCosts.crossPlatform} token${Number(tokenCosts.crossPlatform) !== 1 ? 's' : ''}` },
    { label: 'Image Regenerate', value: `${tokenCosts.imageRegenerate} token${Number(tokenCosts.imageRegenerate) !== 1 ? 's' : ''}` },
    { label: 'Ad Campaign', value: `${tokenCosts.adCampaign} token${Number(tokenCosts.adCampaign) !== 1 ? 's' : ''}` },
    { label: 'Voice Transcription', value: tokenCosts.voiceTranscription },
    { label: 'Caption Editing', value: tokenCosts.captionEditing },
  ];

  return (
    <DashboardLayout>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">Guide</h1>
        <p className="mt-1 text-sm text-slate-500">Everything you need to know about tokens, features and where to find them.</p>
      </header>

      <div className="space-y-6">
        <Card as="section" hoverable={false}>
          <CardHeader title="Getting started" description="From voice note to published post in under a minute." />
          <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {gettingStarted.map((step) => (
              <li key={step.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white">
                  <step.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-bold text-slate-900 dark:text-slate-50">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{step.body}</p>
              </li>
            ))}
          </ol>
        </Card>

        <Card as="section" hoverable={false}>
          <CardHeader title="Tokens &amp; credits" description="How credits work, how to get more, and what they cost." />
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                <CoinsIcon className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                <div className="text-sm text-slate-700 dark:text-slate-200">
                  <p className="font-semibold">Your balance</p>
                  <p className="mt-1">See your token balance and this month's usage on the <strong>Dashboard</strong> (Tokens remaining card) and on your <strong>Profile</strong> page.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <PackageIcon className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
                <div className="text-sm text-slate-700 dark:text-slate-200">
                  <p className="font-semibold">How credits are added</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    <li>Picking a plan on <strong>Packages</strong> adds its included tokens.</li>
                    <li><strong>Buy extra credits</strong> on the Packages or Profile page tops up instantly — your plan stays the same.</li>
                    <li>Unused tokens roll over for 30 days.</li>
                  </ul>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/20">
                <CoinsIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  <p className="font-semibold">Running low?</p>
                  <p className="mt-1">Generate fewer, higher-value posts, or top up in seconds from Packages or Profile.</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">What costs tokens</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                {costItems.map((item) => (
                  <div key={item.label} className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                    <dt className="text-xs text-slate-500">{item.label}</dt>
                    <dd className="font-mono text-sm font-bold text-slate-900 dark:text-slate-50">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={() => navigate('/packages')}>
              <PackageIcon className="h-4 w-4" aria-hidden="true" /> View packages
            </Button>
            <Button variant="secondary" onClick={() => navigate('/dashboard/profile')}>
              <CoinsIcon className="h-4 w-4" aria-hidden="true" /> Buy extra credits
            </Button>
          </div>
        </Card>

        <Card as="section" hoverable={false}>
          <CardHeader title="Feature map" description="Every feature and exactly where to find it." />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featureMap.map((feature) => (
              <li key={feature.title}>
                <button
                  type="button"
                  onClick={() => navigate(feature.where)}
                  className="flex h-full w-full flex-col rounded-2xl border border-slate-200 p-5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-800 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/5"
                >
                  <span className="flex items-center gap-2.5">
                    <feature.icon className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-50">{feature.title}</span>
                  </span>
                  <span className="mt-2 text-sm text-slate-500">{feature.what}</span>
                  <span className="mt-3 inline-flex w-fit items-center rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                    {feature.plan}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </DashboardLayout>
  );
}
