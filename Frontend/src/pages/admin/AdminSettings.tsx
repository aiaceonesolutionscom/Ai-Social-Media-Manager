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

  React.useEffect(() => {
    async function fetchSettings() {
      try {
        const data = await apiRequest<{ settings: Record<string, string> }>(endpoints.adminSettings);
        const s = data.settings || {};
        setInitialValues({
          instagramToken: s.instagram_token || s.INSTAGRAM_ACCESS_TOKEN || '',
          instagramUserId: s.instagram_user_id || s.INSTAGRAM_IG_USER_ID || '',
          facebookAppId: s.facebook_app_id || s.FACEBOOK_APP_ID || '',
          facebookAppSecret: s.facebook_app_secret || s.FACEBOOK_APP_SECRET || '',
          facebookPageId: s.facebook_page_id || s.FACEBOOK_PAGE_ID || '',
          whatsappToken: s.whatsapp_token || s.WHATSAPP_TOKEN || '',
          whatsappPhoneId: s.whatsapp_phone_id || s.WHATSAPP_PHONE_NUMBER_ID || '',
          openaiKey: s.openai_key || s.OPENAI_API_KEY || '',
          groqKey: s.groq_key || s.GROQ_API_KEY || '',
          llmModel: s.llm_model || s.LLM_MODEL || 'gpt-4o-mini',
          stripeSecret: s.stripe_secret || s.STRIPE_SECRET_KEY || '',
          stripeWebhookUrl: s.stripe_webhook_url || s.STRIPE_WEBHOOK_SECRET || '',
          costStandardPost: Number(s.cost_standard_post) || 1,
          costCrossPlatform: Number(s.cost_cross_platform) || 2,
          costImageRegenerate: Number(s.cost_image_regenerate) || 1,
          costAdCampaign: Number(s.cost_ad_campaign) || 5,
          voiceTranscription: s.cost_voice_transcription || 'Free',
          captionEditing: s.cost_caption_editing || 'Free',
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setAuthToken(null);
          notify.error('Session expired', 'Please login again.');
          navigate('/admin/login');
          return;
        }
        // use defaults
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const save = async (values: SettingsValues) => {
    try {
      const settingsMap: Record<string, string | number> = {
        instagram_token: values.instagramToken || '',
        instagram_user_id: values.instagramUserId || '',
        facebook_app_id: values.facebookAppId || '',
        facebook_app_secret: values.facebookAppSecret || '',
        facebook_page_id: values.facebookPageId || '',
        whatsapp_token: values.whatsappToken || '',
        whatsapp_phone_id: values.whatsappPhoneId || '',
        openai_key: values.openaiKey || '',
        groq_key: values.groqKey || '',
        llm_model: values.llmModel || '',
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
      notify.success('Settings saved', 'Integration credentials updated.');
    } catch (err) {
      notify.error('Failed to save settings', (err as Error).message);
    }
  };

  return (
    <AdminLayout>
      <AdminHeader title="Settings" description="Integration credentials and token economics." />
      {loading ? (
        <div className="space-y-4">
          {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <SettingsForm initial={initialValues} onSave={save} />
      )}
    </AdminLayout>
  );
}
