import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { SettingsForm, type SettingsValues } from '../../components/admin/SettingsForm';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';

export function AdminSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(true);
  const [initialValues, setInitialValues] = React.useState<SettingsValues | null>(null);
  const [connections, setConnections] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    async function fetchSettings() {
      try {
        const [data, connData] = await Promise.all([
          apiRequest<{ settings: Record<string, string> }>(endpoints.adminSettings),
          apiRequest<Record<string, { connected: boolean }>>(endpoints.adminSettingsApiKeys).catch(() => ({} as Record<string, { connected: boolean }>)),
        ]);
        const s = data.settings || {};
        setInitialValues({
          stripeSecret: s.stripe_secret || s.STRIPE_SECRET_KEY || '',
          stripeWebhookUrl: s.stripe_webhook_url || s.STRIPE_WEBHOOK_SECRET || '',
          costStandardPost: Number(s.cost_standard_post) || 1,
          costCrossPlatform: Number(s.cost_cross_platform) || 2,
          costImageRegenerate: Number(s.cost_image_regenerate) || 1,
          costAdCampaign: Number(s.cost_ad_campaign) || 5,
          voiceTranscription: s.cost_voice_transcription || 'Free',
          captionEditing: s.cost_caption_editing || 'Free',
        });
        setConnections({
          stripe: connData?.stripe?.connected || false,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setAuthToken(null);
          notify.error('Session expired', 'Please login again.');
          navigate('/admin/login');
          return;
        }
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const save = async (values: SettingsValues) => {
    try {
      const settingsMap: Record<string, string | number> = {
        stripe_secret: values.stripeSecret || '',
        stripe_webhook_url: values.stripeWebhookUrl || '',
        cost_standard_post: values.costStandardPost,
        cost_cross_platform: values.costCrossPlatform,
        cost_image_regenerate: values.costImageRegenerate,
        cost_ad_campaign: values.costAdCampaign,
        cost_voice_transcription: values.voiceTranscription || 'Free',
        cost_caption_editing: values.captionEditing || 'Free',
      };
      await apiRequest(endpoints.adminSettings, {
        method: 'PUT',
        body: JSON.stringify(settingsMap),
      });
      notify.success('Settings saved', 'Token economics and Stripe updated.');
    } catch (err) {
      notify.error('Failed to save settings', (err as Error).message);
    }
  };

  return (
    <AdminLayout>
      <AdminHeader title="Settings" description="Token economics and Stripe billing configuration." />
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-800" />
          ))}
        </div>
      ) : (
        <SettingsForm
          initial={initialValues}
          onSave={save}
          connections={connections}
        />
      )}
    </AdminLayout>
  );
}
