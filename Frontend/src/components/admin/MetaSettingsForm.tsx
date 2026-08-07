import React from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface MetaConfigEntry {
  value: string;
  masked: boolean;
  updatedAt?: string;
}

interface MetaConfig {
  [category: string]: {
    [key: string]: MetaConfigEntry;
  };
}

interface TestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

interface MetaSettingsFormProps {
  config: MetaConfig;
  onSave: (category: string, key: string, value: string, isSensitive: boolean) => void;
  onTest: (integration: string) => void;
  testing: string | null;
  testResults: Record<string, TestResult>;
}

const CATEGORY_LABELS: Record<string, { title: string; description: string; icon: string }> = {
  general: { title: 'General', description: 'Core Meta App credentials and settings', icon: '⚙️' },
  oauth: { title: 'OAuth', description: 'OAuth callback configuration', icon: '🔐' },
  webhook: { title: 'Webhook', description: 'Webhook verification and security', icon: '🔗' },
  whatsapp: { title: 'WhatsApp Business', description: 'WhatsApp Business Platform credentials', icon: '💬' },
  api_versions: { title: 'API Versions', description: 'Graph API version overrides per platform', icon: '📡' },
};

const KEY_LABELS: Record<string, string> = {
  app_id: 'Meta App ID',
  app_secret: 'Meta App Secret',
  graph_api_version: 'Graph API Version',
  default_callback_uri: 'OAuth Callback URI',
  verify_token: 'Verify Token',
  webhook_secret: 'Webhook Secret',
  access_token: 'WhatsApp Permanent Access Token',
  phone_number_id: 'WhatsApp Phone Number ID',
  facebook: 'Facebook API Version',
  instagram: 'Instagram API Version',
  meta_ads: 'Meta Ads API Version',
};

const SENSITIVE_KEYS = new Set([
  'app_secret',
  'verify_token',
  'webhook_secret',
  'access_token',
]);

// Keys no longer used by the platform. Existing DB rows with these keys are hidden.
const UNUSED_KEYS = new Set([
  'app_mode',
  'redirect_uri',
  'webhook_url',
  'business_account_id',
  'api_version',
]);

const TESTABLE_CATEGORIES: Record<string, string> = {
  general: 'app',
  whatsapp: 'whatsapp',
  webhook: 'webhook',
  oauth: 'oauth',
};

const DEFAULT_FIELDS: Record<string, Array<{ key: string; label: string; sensitive: boolean; placeholder: string }>> = {
  general: [
    { key: 'app_id', label: 'Meta App ID', sensitive: false, placeholder: 'Enter your Meta App ID' },
    { key: 'app_secret', label: 'Meta App Secret', sensitive: true, placeholder: 'Enter your Meta App Secret' },
    { key: 'graph_api_version', label: 'Graph API Version', sensitive: false, placeholder: 'v21.0' },
  ],
  oauth: [
    { key: 'default_callback_uri', label: 'OAuth Callback URI', sensitive: false, placeholder: 'https://yourdomain.com/api/social/connect/facebook/callback' },
  ],
  webhook: [
    { key: 'verify_token', label: 'Verify Token', sensitive: true, placeholder: 'Enter webhook verify token' },
    { key: 'webhook_secret', label: 'Webhook Secret', sensitive: true, placeholder: 'Enter webhook secret' },
  ],
  whatsapp: [
    { key: 'access_token', label: 'WhatsApp Permanent Access Token', sensitive: true, placeholder: 'Enter WhatsApp permanent token' },
    { key: 'phone_number_id', label: 'WhatsApp Phone Number ID', sensitive: false, placeholder: 'Enter phone number ID' },
  ],
  api_versions: [
    { key: 'facebook', label: 'Facebook API Version', sensitive: false, placeholder: 'v21.0' },
    { key: 'instagram', label: 'Instagram API Version', sensitive: false, placeholder: 'v21.0' },
    { key: 'meta_ads', label: 'Meta Ads API Version', sensitive: false, placeholder: 'v21.0' },
  ],
};

function SectionHeader({
  title,
  description,
  icon,
  status,
  onTest,
  testLabel,
  testing,
}: {
  title: string;
  description: string;
  icon: string;
  status: 'connected' | 'pending' | 'untested';
  onTest?: () => void;
  testLabel?: string;
  testing?: boolean;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-50">
          <span>{icon}</span>
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {onTest && (
          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {testing ? 'Testing...' : testLabel || 'Test'}
          </button>
        )}
        <Badge tone={status === 'connected' ? 'emerald' : status === 'pending' ? 'amber' : 'slate'}>
          {status === 'connected' ? 'Connected' : status === 'pending' ? 'Action needed' : 'Not tested'}
        </Badge>
      </div>
    </div>
  );
}

export function MetaSettingsForm({ config, onSave, onTest, testing, testResults }: MetaSettingsFormProps) {
  const [editing, setEditing] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState<string | null>(null);

  const getValue = (category: string, key: string) => {
    const cacheKey = `${category}.${key}`;
    return editing[cacheKey] ?? config[category]?.[key]?.value ?? '';
  };

  const setValue = (category: string, key: string, value: string) => {
    const cacheKey = `${category}.${key}`;
    setEditing((prev) => ({ ...prev, [cacheKey]: value }));
  };

  const handleSave = async (category: string, key: string) => {
    const cacheKey = `${category}.${key}`;
    const value = editing[cacheKey] ?? '';
    setSaving(cacheKey);
    try {
      await onSave(category, key, value, SENSITIVE_KEYS.has(key));
    } finally {
      setSaving(null);
    }
  };

  const getStatus = (category: string): 'connected' | 'pending' | 'untested' => {
    const testKey = TESTABLE_CATEGORIES[category];
    if (testKey && testResults[testKey]) {
      return testResults[testKey].ok ? 'connected' : 'pending';
    }
    const entries = config[category];
    if (!entries) return 'pending';
    const hasValues = Object.values(entries).some((e) => e.value);
    return hasValues ? 'untested' : 'pending';
  };

  return (
    <div className="space-y-6">
      {Object.entries(CATEGORY_LABELS).map(([category, { title, description, icon }]) => {
        const rawExistingEntries = config[category] || {};
        const existingEntries = Object.fromEntries(
          Object.entries(rawExistingEntries).filter(([key]) => !UNUSED_KEYS.has(key)),
        );
        const hasExistingData = Object.keys(existingEntries).length > 0;
        const status = getStatus(category);
        const testKey = TESTABLE_CATEGORIES[category];
        const testResult = testKey ? testResults[testKey] : null;

        const defaults = DEFAULT_FIELDS[category] || [];

        // Build unified field list: existing data takes priority, fill gaps with defaults
        const allFields = hasExistingData
          ? Object.entries(existingEntries).map(([key, entry]) => ({
              key,
              label: KEY_LABELS[key] || key,
              sensitive: SENSITIVE_KEYS.has(key),
              value: entry.value || '',
              updatedAt: entry.updatedAt,
              placeholder: (SENSITIVE_KEYS.has(key) ? '••••••••' : entry.value) || '',
            }))
          : defaults.map((f) => ({
              key: f.key,
              label: f.label,
              sensitive: f.sensitive,
              value: '',
              updatedAt: undefined,
              placeholder: f.placeholder,
            }));

        return (
          <Card key={category} as="section" hoverable={false}>
            <SectionHeader
              title={title}
              description={description}
              icon={icon}
              status={status}
              onTest={testKey ? () => onTest(testKey) : undefined}
              testLabel={`Test ${title}`}
              testing={testing === testKey}
            />

            {testResult && (
              <div className={`mb-4 rounded-lg p-3 text-xs ${
                testResult.ok ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
              }`}>
                {testResult.message} ({testResult.latencyMs}ms)
              </div>
            )}

            <div className="grid gap-5 md:grid-cols-2">
              {allFields.map((field) => {
                const cacheKey = `${category}.${field.key}`;
                const isDirty = cacheKey in editing;
                const isSaving = saving === cacheKey;
                const displayValue = editing[cacheKey] ?? field.value;

                return (
                  <div key={field.key} className="space-y-1">
                    <Input
                      label={field.label}
                      mono
                      type={field.sensitive ? 'password' : 'text'}
                      value={displayValue}
                      onChange={(e) => setValue(category, field.key, e.target.value)}
                      placeholder={field.placeholder}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">
                        {field.updatedAt ? `Updated: ${new Date(field.updatedAt).toLocaleDateString()}` : 'Not set'}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        loading={isSaving}
                        disabled={!isDirty}
                        onClick={() => handleSave(category, field.key)}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {allFields.length === 0 && (
              <p className="text-sm text-slate-400">No configuration yet.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
