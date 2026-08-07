import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { MetaSettingsForm } from '../../components/admin/MetaSettingsForm';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import { ShieldIcon } from 'lucide-react';

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

interface MetaStatus {
  configured: boolean;
  appId: string;
  appMode: string;
  graphApiVersion: string;
  whatsappConnected: boolean;
  webhookConfigured: boolean;
  oauthConfigured: boolean;
}

export function AdminMetaSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(true);
  const [config, setConfig] = React.useState<MetaConfig>({});
  const [status, setStatus] = React.useState<MetaStatus | null>(null);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [testResults, setTestResults] = React.useState<Record<string, TestResult>>({});
  const [testingAll, setTestingAll] = React.useState(false);

  const fetchConfig = React.useCallback(async () => {
    try {
      const data = await apiRequest<{ config: MetaConfig; status: MetaStatus }>(endpoints.adminMetaSettings);
      setConfig(data.config || {});
      setStatus(data.status || null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        notify.error('Session expired', 'Please login again.');
        navigate('/admin/login');
        return;
      }
      notify.error('Failed to load Meta config', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  React.useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const saveSetting = async (category: string, key: string, value: string, isSensitive: boolean) => {
    try {
      await apiRequest(endpoints.adminMetaSettings, {
        method: 'PUT',
        body: JSON.stringify({ category, key, value, isSensitive }),
      });
      notify.success('Saved', `${key} updated successfully.`);
      await fetchConfig();
    } catch (err) {
      notify.error('Failed to save', (err as Error).message);
    }
  };

  const testIntegration = async (integration: string) => {
    setTesting(integration);
    try {
      const result = await apiRequest<TestResult>(
        endpoints.adminMetaSettingsTestIntegration(integration),
        { method: 'POST' },
      );
      setTestResults((prev) => ({ ...prev, [integration]: result }));
      if (result.ok) {
        notify.success('Connection OK', `${result.message} (${result.latencyMs}ms)`);
      } else {
        notify.error('Connection failed', result.message);
      }
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [integration]: { ok: false, message: (err as Error).message, latencyMs: 0 } }));
      notify.error('Test failed', (err as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const testAll = async () => {
    setTestingAll(true);
    try {
      const result = await apiRequest<{ results: Record<string, TestResult> }>(
        endpoints.adminMetaSettingsTest,
        { method: 'POST' },
      );
      setTestResults(result.results || {});
      const successCount = Object.values(result.results || {}).filter((r) => r.ok).length;
      const total = Object.keys(result.results || {}).length;
      notify.success('Tests complete', `${successCount}/${total} connections successful`);
    } catch (err) {
      notify.error('Tests failed', (err as Error).message);
    } finally {
      setTestingAll(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <AdminHeader title="Meta Platform" description="Configure Meta App credentials for all integrations." />
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-800" />
          ))}
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <AdminHeader title="Meta Platform" description="Configure Meta App credentials for all integrations." />

      {/* Status Overview */}
      {status && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <div className={`rounded-lg p-2 ${status.configured ? 'bg-green-50 dark:bg-green-500/10' : 'bg-red-50 dark:bg-red-500/10'}`}>
                <ShieldIcon className={`h-5 w-5 ${status.configured ? 'text-green-600' : 'text-red-600'}`} />
              </div>
              <div>
                <p className="text-xs text-slate-500">App Status</p>
                <p className="text-lg font-semibold">{status.configured ? 'Configured' : 'Not Configured'}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-500/10">
                <span className="text-lg">📱</span>
              </div>
              <div>
                <p className="text-xs text-slate-500">App ID</p>
                <p className="text-sm font-mono font-semibold">{status.appId}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-50 p-2 dark:bg-purple-500/10">
                <span className="text-lg">💬</span>
              </div>
              <div>
                <p className="text-xs text-slate-500">WhatsApp</p>
                <p className="text-lg font-semibold">{status.whatsappConnected ? 'Connected' : 'Not Set'}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-50 p-2 dark:bg-amber-500/10">
                <span className="text-lg">🔗</span>
              </div>
              <div>
                <p className="text-xs text-slate-500">Webhook</p>
                <p className="text-lg font-semibold">{status.webhookConfigured ? 'Configured' : 'Not Set'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Test All Button */}
      <div className="mb-6 flex justify-end">
        <button
          onClick={testAll}
          disabled={testingAll}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {testingAll ? 'Testing All...' : 'Test All Connections'}
        </button>
      </div>

      {/* Config Form */}
      <MetaSettingsForm
        config={config}
        onSave={saveSetting}
        onTest={testIntegration}
        testing={testing}
        testResults={testResults}
      />

      {/* Security Notice */}
      <div className="mt-8 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/30 dark:bg-blue-500/10">
        <div className="flex items-start gap-3">
          <ShieldIcon className="mt-0.5 h-5 w-5 text-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-900 dark:text-blue-200">Security Notice</p>
            <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
              All sensitive credentials (App Secret, Access Tokens, Webhook Secrets) are encrypted using AES-256-GCM
              before storage. Only the Super Admin can view and edit these settings. Credentials are never exposed
              to regular users or in API responses (masked).
            </p>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
