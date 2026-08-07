import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

const schema = z.object({
  instagramToken: z.string().optional(),
  instagramUserId: z.string().optional(),
  facebookAppId: z.string().optional(),
  facebookAppSecret: z.string().optional(),
  facebookPageId: z.string().optional(),
  whatsappToken: z.string().optional(),
  whatsappPhoneId: z.string().optional(),
  openaiKey: z.string().optional(),
  groqKey: z.string().optional(),
  llmModel: z.string().optional(),
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
  instagramToken: '',
  instagramUserId: '',
  facebookAppId: '',
  facebookAppSecret: '',
  facebookPageId: '',
  whatsappToken: '',
  whatsappPhoneId: '',
  openaiKey: '',
  groqKey: '',
  llmModel: 'gpt-4o-mini',
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
}

function SectionHeader({
  title,
  description,
  status




}: {title: string;description: string;status: 'connected' | 'pending';}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <Badge tone={status === 'connected' ? 'emerald' : 'amber'}>
        {status === 'connected' ? 'Connected' : 'Action needed'}
      </Badge>
    </div>);

}

export function SettingsForm({ initial, onSave }: SettingsFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<SettingsValues>({ resolver: zodResolver(schema), defaultValues: initial || defaults });

  return (
    <form onSubmit={handleSubmit(onSave)} className="space-y-6" noValidate>
      <Card as="section" hoverable={false}>
        <SectionHeader
          title="Instagram API"
          description="Graph API credentials for publishing to Instagram."
          status="connected" />
        
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            label="Access token"
            mono
            type="password"
            error={errors.instagramToken?.message}
            {...register('instagramToken')} />
          
          <Input label="Instagram user ID" mono error={errors.instagramUserId?.message} {...register('instagramUserId')} />
        </div>
      </Card>

      <Card as="section" hoverable={false}>
        <SectionHeader title="Facebook API" description="App credentials used for page publishing." status="connected" />
        <div className="grid gap-5 md:grid-cols-3">
          <Input label="App ID" mono error={errors.facebookAppId?.message} {...register('facebookAppId')} />
          <Input
            label="App secret"
            mono
            type="password"
            error={errors.facebookAppSecret?.message}
            {...register('facebookAppSecret')} />
          
          <Input label="Page ID" mono error={errors.facebookPageId?.message} {...register('facebookPageId')} />
        </div>
      </Card>

      <Card as="section" hoverable={false}>
        <SectionHeader title="WhatsApp API" description="Business cloud API for broadcast messages." status="pending" />
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            label="Access token"
            mono
            type="password"
            error={errors.whatsappToken?.message}
            {...register('whatsappToken')} />
          
          <Input label="Phone number ID" mono error={errors.whatsappPhoneId?.message} {...register('whatsappPhoneId')} />
        </div>
      </Card>

      <Card as="section" hoverable={false}>
        <SectionHeader
          title="AI providers"
          description="Models used for transcription and caption generation."
          status="connected" />
        
        <div className="grid gap-5 md:grid-cols-3">
          <Input label="OpenAI key" mono type="password" error={errors.openaiKey?.message} {...register('openaiKey')} />
          <Input label="Groq key" mono type="password" error={errors.groqKey?.message} {...register('groqKey')} />
          <Input label="Default LLM model" mono error={errors.llmModel?.message} {...register('llmModel')} />
        </div>
      </Card>

      <Card as="section" hoverable={false}>
        <SectionHeader title="Stripe" description="Billing keys and webhook destination." status="connected" />
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
    </form>);

}