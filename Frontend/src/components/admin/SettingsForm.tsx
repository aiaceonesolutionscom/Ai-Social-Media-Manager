import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { ArrowRightIcon } from 'lucide-react';

const schema = z.object({
  stripeSecret: z.string().optional(),
  stripeWebhookUrl: z.string().optional(),
  costStandardPost: z.coerce.number().min(0),
  costCrossPlatform: z.coerce.number().min(0),
  costImageRegenerate: z.coerce.number().min(0),
  costAdCampaign: z.coerce.number().min(0),
  voiceTranscription: z.string().optional(),
  captionEditing: z.string().optional(),
});

export type SettingsValues = z.infer<typeof schema>;

const defaults: SettingsValues = {
  stripeSecret: '',
  stripeWebhookUrl: 'https://api.echopost.app/api/webhooks/stripe',
  costStandardPost: 1,
  costCrossPlatform: 2,
  costImageRegenerate: 1,
  costAdCampaign: 5,
  voiceTranscription: 'Free',
  captionEditing: 'Free',
};

interface SettingsFormProps {
  initial?: SettingsValues | null;
  onSave: (values: SettingsValues) => void;
  connections?: Record<string, boolean>;
}

function SectionHeader({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status: 'connected' | 'pending';
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <Badge tone={status === 'connected' ? 'emerald' : 'amber'}>
        {status === 'connected' ? 'Connected' : 'Action needed'}
      </Badge>
    </div>
  );
}

function QuickLinkCard({ title, description, link, icon }: { title: string; description: string; link: string; icon: string }) {
  return (
    <a
      href={link}
      className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-indigo-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500"
    >
      <span className="text-2xl">{icon}</span>
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <ArrowRightIcon className="h-4 w-4 text-slate-400" />
    </a>
  );
}

export function SettingsForm({ initial, onSave, connections = {} }: SettingsFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<SettingsValues>({ resolver: zodResolver(schema), defaultValues: initial || defaults });

  const status = (key: string) => (connections[key] ? 'connected' as const : 'pending' as const);

  return (
    <form onSubmit={handleSubmit(onSave)} className="space-y-6" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <QuickLinkCard
          title="Meta Platform"
          description="Configure Meta App credentials, OAuth, WhatsApp, webhooks"
          link="/admin/meta-platform"
          icon="🛡️"
        />
        <QuickLinkCard
          title="AI Providers"
          description="Manage AI models for transcription and content generation"
          link="/admin/ai-providers"
          icon="🧠"
        />
      </div>

      <Card as="section" hoverable={false}>
        <SectionHeader title="Stripe" description="Billing keys and webhook destination." status={status('stripe')} />
        <div className="grid gap-5 md:grid-cols-2">
          <Input label="Secret key" mono type="password" error={errors.stripeSecret?.message} {...register('stripeSecret')} />
          <Input label="Webhook URL" mono error={errors.stripeWebhookUrl?.message} {...register('stripeWebhookUrl')} />
        </div>
      </Card>

      <Card as="section" hoverable={false}>
        <SectionHeader title="Token Costs" description="How many tokens each action consumes." status="connected" />
        <div className="grid gap-5 md:grid-cols-2">
          <Input label="Standard Post (IG or FB)" type="number" mono error={errors.costStandardPost?.message} {...register('costStandardPost')} />
          <Input
            label="Cross-Platform (IG + FB)"
            type="number"
            mono
            error={errors.costCrossPlatform?.message}
            {...register('costCrossPlatform')} />
          <Input
            label="Image Regenerate"
            type="number"
            mono
            error={errors.costImageRegenerate?.message}
            {...register('costImageRegenerate')} />
          <Input
            label="Ad Campaign"
            type="number"
            mono
            error={errors.costAdCampaign?.message}
            {...register('costAdCampaign')} />
          <Input
            label="Voice Transcription"
            mono
            placeholder="Free"
            error={errors.voiceTranscription?.message}
            {...register('voiceTranscription')} />
          <Input
            label="Caption Editing"
            mono
            placeholder="Free"
            error={errors.captionEditing?.message}
            {...register('captionEditing')} />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
