import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import {
  CheckCircleIcon,
  XCircleIcon,
  MicIcon,
  BrainIcon,
  ImageIcon,
  PlusIcon,
  Trash2Icon,
  ActivityIcon,
  DollarSignIcon,
  ClockIcon,
} from 'lucide-react';

interface AIProvider {
  id: string;
  category: string;
  provider: string;
  displayName: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  config: Record<string, unknown>;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AICost {
  id: string;
  provider: string;
  category: string;
  costPer1MInputTokens: number;
  costPer1MOutputTokens: number;
  costPerImage: number;
  costPerAudioMinute: number;
  updatedAt: string;
}

interface UsageStats {
  totalRequests: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCostCents: number;
  byCategory: Record<string, { requests: number; costCents: number; tokensInput: number; tokensOutput: number }>;
  byProvider: Record<string, { requests: number; costCents: number; tokensInput: number; tokensOutput: number }>;
}

interface UsageLog {
  id: string;
  phone: string;
  providerId: string;
  category: string;
  model: string;
  feature: string;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostCents: number;
  durationMs: number;
  success: boolean;
  error: string;
  createdAt: string;
}

interface AICostVersion {
  id: string;
  version: number;
  inputRate: number;
  outputRate: number;
  cachedInputRate: number;
  imageRate: number;
  audioRate: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  source: string;
  lastVerifiedAt: string | null;
  status: string;
  active: boolean;
}

const CATEGORY_ICONS: Record<string, React.FC<{ className?: string }>> = {
  stt: MicIcon,
  llm: BrainIcon,
  image: ImageIcon,
};

const CATEGORY_LABELS: Record<string, string> = {
  stt: 'Speech-to-Text',
  llm: 'Language Model',
  image: 'Image Generation',
};

const PROVIDER_OPTIONS: Record<string, { key: string; label: string; baseUrl: string; defaultModel: string }[]> = {
  stt: [
    { key: 'groq', label: 'Groq Whisper', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'whisper-large-v3' },
    { key: 'openai-stt', label: 'OpenAI Whisper', baseUrl: 'https://api.openai.com/v1', defaultModel: 'whisper-1' },
  ],
  llm: [
    { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
    { key: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest' },
    { key: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
    { key: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-20250514' },
  ],
  image: [
    { key: 'openai', label: 'OpenAI GPT Image', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-image-1-mini' },
    { key: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash-preview-image-generation' },
    { key: 'stability', label: 'Stability AI', baseUrl: 'https://api.stability.ai/v2beta', defaultModel: 'stable-image-core' },
  ],
};

export function AdminAIProviders() {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(true);
  const [providers, setProviders] = React.useState<Record<string, AIProvider[]>>({});
  const [activeProviders, setActiveProviders] = React.useState<Record<string, AIProvider | null>>({});
  const [costs, setCosts] = React.useState<AICost[]>([]);
  const [stats, setStats] = React.useState<UsageStats | null>(null);
  const [history, setHistory] = React.useState<UsageLog[]>([]);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testResults, setTestResults] = React.useState<Record<string, { ok: boolean; message: string }>>({});
  const [validationStatus, setValidationStatus] = React.useState<Record<string, 'untested' | 'valid' | 'invalid'>>({});
  const [showAddForm, setShowAddForm] = React.useState<string | null>(null);
  const [newProvider, setNewProvider] = React.useState({ provider: '', displayName: '', apiKey: '', baseUrl: '', model: '' });
  const [editingCost, setEditingCost] = React.useState<string | null>(null);
  const [costForm, setCostForm] = React.useState<Partial<AICost>>({});
  const [versionsFor, setVersionsFor] = React.useState<{ provider: string; category: string } | null>(null);
  const [costVersions, setCostVersions] = React.useState<AICostVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = React.useState(false);

  const loadCostVersions = async (provider: string, category: string) => {
    setVersionsLoading(true);
    setVersionsFor({ provider, category });
    try {
      const res = await apiRequest<{ versions: AICostVersion[] }>(endpoints.adminAIProvidersCostVersions(provider, category));
      setCostVersions(res.versions || []);
    } catch {
      setCostVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const fetchData = React.useCallback(async () => {
    try {
      const [provData, activeData, costsData, statsData, histData] = await Promise.all([
        apiRequest<{ providers: Record<string, AIProvider[]> }>(endpoints.adminAIProviders),
        apiRequest<{ stt: AIProvider | null; llm: AIProvider | null; image: AIProvider | null }>(endpoints.adminAIProvidersActive),
        apiRequest<{ costs: AICost[] }>(endpoints.adminAIProvidersCosts),
        apiRequest<UsageStats>(endpoints.adminAIProvidersStats),
        apiRequest<{ logs: UsageLog[] }>(`${endpoints.adminAIProvidersHistory}?limit=20`),
      ]);
      setProviders(provData.providers || {});
      setActiveProviders(activeData);
      setCosts(costsData.costs || []);
      setStats(statsData);
      setHistory(histData.logs || []);
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
  }, [navigate]);

  React.useEffect(() => { fetchData(); }, [fetchData]);

  const activateProvider = async (id: string) => {
    try {
      await apiRequest(`${endpoints.adminAIProviders}/${id}/activate`, { method: 'POST' });
      setValidationStatus((prev) => ({ ...prev, [id]: 'valid' }));
      notify.success('Provider activated');
      await fetchData();
    } catch (err) {
      notify.error('Failed to activate', (err as Error).message);
    }
  };

  const testConnection = async (id: string) => {
    setTestingId(id);
    try {
      const result = await apiRequest<{ ok: boolean; message: string; latencyMs: number; activated?: boolean }>(
        `${endpoints.adminAIProviders}/${id}/test`,
        { method: 'POST' },
      );
      setTestResults((prev) => ({ ...prev, [id]: result }));
      setValidationStatus((prev) => ({ ...prev, [id]: result.ok ? 'valid' : 'invalid' }));
      if (result.ok) {
        if (result.activated) {
          notify.success('Connection OK & Activated', `${result.message} (${result.latencyMs}ms)`);
        } else {
          notify.success('Connection OK', `${result.message} (${result.latencyMs}ms)`);
        }
      } else {
        notify.error('Connection failed', result.message);
      }
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: (err as Error).message } }));
      setValidationStatus((prev) => ({ ...prev, [id]: 'invalid' }));
      notify.error('Test failed', (err as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const addProvider = async (category: string) => {
    const option = PROVIDER_OPTIONS[category]?.find((o) => o.label === newProvider.displayName);
    const baseUrl = newProvider.baseUrl || option?.baseUrl || '';
    const model = newProvider.model || option?.defaultModel || '';

    try {
      const result = await apiRequest<{ provider: any; validation: any }>(endpoints.adminAIProviders, {
        method: 'POST',
        body: JSON.stringify({
          category,
          provider: newProvider.provider || option?.key || 'custom',
          displayName: newProvider.displayName || 'Custom Provider',
          apiKey: newProvider.apiKey,
          baseUrl,
          model,
        }),
      });
      
      if (result.validation) {
        setValidationStatus(prev => ({ ...prev, [result.provider.id]: result.validation.ok ? 'valid' : 'invalid' }));
        if (result.validation.ok) {
          notify.success('Provider added & validated');
        } else {
          notify.info('Provider added but validation failed', result.validation.message);
        }
      } else {
        notify.success('Provider added');
      }
      
      setShowAddForm(null);
      setNewProvider({ provider: '', displayName: '', apiKey: '', baseUrl: '', model: '' });
      await fetchData();
    } catch (err) {
      notify.error('Failed to add', (err as Error).message);
    }
  };

  const deleteProvider = async (id: string) => {
    if (!confirm('Delete this provider?')) return;
    try {
      await apiRequest(`${endpoints.adminAIProviders}/${id}`, { method: 'DELETE' });
      notify.success('Provider deleted');
      await fetchData();
    } catch (err) {
      notify.error('Failed to delete', (err as Error).message);
    }
  };

  const saveCost = async (provider: string, category: string) => {
    try {
      const res = await apiRequest<{ marginStatus?: string; lossPackages?: string[]; message?: string }>(endpoints.adminAIProvidersCosts, {
        method: 'PUT',
        body: JSON.stringify({ provider, category, ...costForm }),
      });
      if (res.marginStatus === 'WARNING') {
        notify.info('Proposal created (margin warning)', 'One or more packages are running at 0–30% margin. Proposal now awaits admin approval.');
      } else {
        notify.success('Proposal created', res.message || 'Pricing change now awaits admin approval.');
      }
      setEditingCost(null);
      await fetchData();
    } catch (err) {
      const msg = (err as { message?: string }).message || '';
      notify.error('Failed to save', msg.startsWith('Pricing change blocked') ? msg : msg);
    }
  };

  const approveVersion = async (id: string) => {
    try {
      const res = await apiRequest<{ marginStatus?: string; error?: string }>(endpoints.adminAIProviderCostVersionApprove(id), { method: 'POST' });
      if (res.error) {
        notify.error('Approval rejected', res.error);
      } else {
        notify.success('Pricing version approved', `Now active. Margin: ${res.marginStatus}`);
      }
      if (versionsFor) await loadCostVersions(versionsFor.provider, versionsFor.category);
      await fetchData();
    } catch (err) {
      notify.error('Failed to approve', (err as { message?: string }).message || (err as Error).message);
    }
  };

  const rejectVersion = async (id: string) => {
    if (!confirm('Reject this pricing proposal?')) return;
    try {
      await apiRequest(endpoints.adminAIProviderCostVersionReject(id), { method: 'POST' });
      notify.success('Pricing proposal rejected');
      if (versionsFor) await loadCostVersions(versionsFor.provider, versionsFor.category);
      await fetchData();
    } catch (err) {
      notify.error('Failed to reject', (err as Error).message);
    }
  };

  const statusBadge = (status: string, active: boolean) => {
    const map: Record<string, { label: string; cls: string }> = {
      approved: { label: active ? 'Active' : 'Approved', cls: active ? 'bg-green-100 text-green-700' : 'bg-emerald-100 text-emerald-700' },
      pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-700' },
      superseded: { label: 'Superseded', cls: 'bg-slate-100 text-slate-500' },
      rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
    };
    const b = map[status] || { label: status, cls: 'bg-slate-100 text-slate-500' };
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>;
  };

  if (loading) {
    return (
      <AdminLayout>
        <AdminHeader title="AI Providers" description="Manage AI service providers, costs, and usage." />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      </AdminLayout>
    );
  }

  const testAllProviders = async () => {
    const allProviderIds = Object.values(providers).flat().map(p => p.id);
    if (allProviderIds.length === 0) {
      notify.info('No providers to test');
      return;
    }
    
    notify.info('Testing all providers...', 'This may take a moment');
    
    for (const id of allProviderIds) {
      setTestingId(id);
      try {
        const result = await apiRequest<{ ok: boolean; message: string; latencyMs: number; activated?: boolean }>(
          `${endpoints.adminAIProviders}/${id}/test`,
          { method: 'POST' },
        );
        setTestResults((prev) => ({ ...prev, [id]: result }));
        setValidationStatus((prev) => ({ ...prev, [id]: result.ok ? 'valid' : 'invalid' }));
      } catch (err) {
        setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: (err as Error).message } }));
        setValidationStatus((prev) => ({ ...prev, [id]: 'invalid' }));
      }
      setTestingId(null);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }
    
    const validCount = Object.values(validationStatus).filter(s => s === 'valid').length;
    notify.success(`Testing complete`, `${validCount}/${allProviderIds.length} providers validated`);
  };

  const allProviders = Object.values(providers).flat();
  const providerNameById: Record<string, string> = {};
  for (const p of allProviders) providerNameById[p.id] = p.displayName;

  const configuredProviderKeys = new Set<string>();
  for (const p of allProviders) {
    if (p.apiKey) configuredProviderKeys.add(`${p.category}:${p.provider}`);
  }
  const visibleCosts = costs.filter((c) => configuredProviderKeys.has(`${c.category}:${c.provider}`));
  const costsByCategory = (['stt', 'llm', 'image'] as const)
    .map((cat) => ({ category: cat, items: visibleCosts.filter((c) => c.category === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <AdminLayout>
      <AdminHeader 
        title="AI Providers" 
        description="Manage AI service providers, costs, and usage."
        action={
          <button
            onClick={testAllProviders}
            disabled={Object.values(providers).flat().length === 0}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            Test All Providers
          </button>
        }
      />

      {/* Usage Summary */}
      {stats && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-500/10">
                <ActivityIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Total Requests</p>
                <p className="text-lg font-semibold">{stats.totalRequests.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-50 p-2 dark:bg-purple-500/10">
                <BrainIcon className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Total Tokens</p>
                <p className="text-lg font-semibold">{(stats.totalTokensInput + stats.totalTokensOutput).toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-50 p-2 dark:bg-green-500/10">
                <DollarSignIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Total Cost</p>
                <p className="text-lg font-semibold">${(stats.totalCostCents / 100).toFixed(2)}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-50 p-2 dark:bg-amber-500/10">
                <ClockIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Active Providers</p>
                <p className="text-lg font-semibold">
                  {Object.values(activeProviders).filter(Boolean).length} / 3
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Provider Cards by Category */}
      {(['stt', 'llm', 'image'] as const).map((category) => {
        const Icon = CATEGORY_ICONS[category] || BrainIcon;
        const list = providers[category] || [];
        const active = activeProviders[category];

        return (
          <div key={category} className="mb-8">
            <div className="mb-4 flex items-center gap-2">
              <Icon className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold">{CATEGORY_LABELS[category]}</h2>
              {active && (
                <span className="ml-2 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  Active: {active.displayName}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {list.map((p) => {
                const testResult = testResults[p.id];
                return (
                  <div
                    key={p.id}
                    className={`rounded-xl border-2 bg-white p-4 transition-all dark:bg-slate-800 ${
                      p.isActive
                        ? 'border-green-500 shadow-md shadow-green-500/10'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
<div className="mb-3 flex items-center justify-between">
                       <div>
                         <h3 className="font-semibold">{p.displayName}</h3>
                         <p className="text-xs text-slate-500">{p.provider} • {p.model}</p>
                       </div>
                       <div className="flex items-center gap-2">
                         {(() => {
                           const status = validationStatus[p.id];
                           if (status === 'valid') {
                             return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">✓ Validated</span>;
                           }
                           if (status === 'invalid') {
                             return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">✗ Failed</span>;
                           }
                           if (p.apiKey) {
                             return <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">⟳ Untested</span>;
                           }
                           return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">No API Key</span>;
                         })()}
                         {p.isActive ? (
                           <CheckCircleIcon className="h-5 w-5 text-green-500" />
                         ) : (
                           <XCircleIcon className="h-5 w-5 text-slate-300" />
                         )}
                       </div>
                     </div>

                    <div className="mb-3 space-y-1 text-xs text-slate-500">
                      <p>Key: {p.apiKey || 'Not set'}</p>
                      <p>Base URL: {p.baseUrl || 'Default'}</p>
                    </div>

                    {stats && stats.byProvider[p.id] && (
                      <div className="mb-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-700/50 dark:text-slate-400">
                        {stats.byProvider[p.id].requests.toLocaleString()} requests · {(stats.byProvider[p.id].tokensInput + stats.byProvider[p.id].tokensOutput).toLocaleString()} tokens · ${(stats.byProvider[p.id].costCents / 100).toFixed(2)}
                      </div>
                    )}

                    {testResult && (
                      <div className={`mb-3 rounded-lg p-2 text-xs ${
                        testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {testResult.message}
                      </div>
                    )}

                    <div className="flex gap-2">
                      {!p.isActive && (
                        <button
                          onClick={() => activateProvider(p.id)}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                        >
                          Activate
                        </button>
                      )}
                      <button
                        onClick={() => testConnection(p.id)}
                        disabled={testingId === p.id}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
                      >
                        {testingId === p.id ? 'Testing...' : 'Test'}
                      </button>
                      {!p.isDefault && (
                        <button
                          onClick={() => deleteProvider(p.id)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          <Trash2Icon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add Provider Card */}
              {showAddForm === category ? (
                <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 p-4 dark:bg-indigo-500/5">
                  <h4 className="mb-3 font-medium">Add Provider</h4>
                  <select
                    value={newProvider.displayName}
                    onChange={(e) => {
                      const opt = PROVIDER_OPTIONS[category]?.find((o) => o.label === e.target.value);
                      setNewProvider({
                        ...newProvider,
                        displayName: e.target.value,
                        baseUrl: opt?.baseUrl || '',
                        model: opt?.defaultModel || '',
                      });
                    }}
                    className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="">Select provider...</option>
                    {PROVIDER_OPTIONS[category]?.map((o) => (
                      <option key={o.label} value={o.label}>{o.label}</option>
                    ))}
                    <option value="custom">Custom Provider</option>
                  </select>
                  <input
                    placeholder="API Key"
                    value={newProvider.apiKey}
                    onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })}
                    className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Base URL"
                    value={newProvider.baseUrl}
                    onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
                    className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Model"
                    value={newProvider.model}
                    onChange={(e) => setNewProvider({ ...newProvider, model: e.target.value })}
                    className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
<div className="flex gap-2">
                      <button
                        onClick={() => addProvider(category)}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                      >
                        Save & Test
                      </button>
                    <button
                      onClick={() => { setShowAddForm(null); setNewProvider({ provider: '', displayName: '', apiKey: '', baseUrl: '', model: '' }); }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddForm(category)}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-600"
                >
                  <PlusIcon className="h-4 w-4" />
                  Add Provider
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Cost Configuration */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold">Cost Configuration</h2>
        <p className="mb-4 text-xs text-slate-500">
          Only shows providers whose API key is configured. Costs are grouped by category.
        </p>
        {costsByCategory.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">
            No cost configurations for configured providers yet. Add a provider, set its API key, and activate it first.
          </div>
        ) : (
          costsByCategory.map(({ category, items }) => {
            const Icon = CATEGORY_ICONS[category] || BrainIcon;
            return (
              <div key={category} className="mb-6">
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold">{CATEGORY_LABELS[category]}</h3>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                        <th className="px-4 py-3">Provider</th>
                        <th className="px-4 py-3">Cost/1M Input</th>
                        <th className="px-4 py-3">Cost/1M Output</th>
                        <th className="px-4 py-3">Cost/Image</th>
                        <th className="px-4 py-3">Cost/Min Audio</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((c) => (
                        <tr key={c.id} className="border-b border-slate-100 dark:border-slate-700/50">
                          <td className="px-4 py-3 font-medium">{c.provider}</td>
                          {editingCost === c.id ? (
                            <>
                              <td className="px-4 py-3">
                                <input type="number" value={costForm.costPer1MInputTokens ?? c.costPer1MInputTokens}
                                  onChange={(e) => setCostForm({ ...costForm, costPer1MInputTokens: Number(e.target.value) })}
                                  className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input type="number" value={costForm.costPer1MOutputTokens ?? c.costPer1MOutputTokens}
                                  onChange={(e) => setCostForm({ ...costForm, costPer1MOutputTokens: Number(e.target.value) })}
                                  className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input type="number" value={costForm.costPerImage ?? c.costPerImage}
                                  onChange={(e) => setCostForm({ ...costForm, costPerImage: Number(e.target.value) })}
                                  className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input type="number" value={costForm.costPerAudioMinute ?? c.costPerAudioMinute}
                                  onChange={(e) => setCostForm({ ...costForm, costPerAudioMinute: Number(e.target.value) })}
                                  className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <button onClick={() => saveCost(c.provider, c.category)}
                                  className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                                >Save</button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-3">${(c.costPer1MInputTokens / 100).toFixed(4)}</td>
                              <td className="px-4 py-3">${(c.costPer1MOutputTokens / 100).toFixed(4)}</td>
                              <td className="px-4 py-3">${(c.costPerImage / 100).toFixed(2)}</td>
                              <td className="px-4 py-3">${(c.costPerAudioMinute / 100).toFixed(2)}</td>
                              <td className="px-4 py-3">
                                <button onClick={() => { setEditingCost(c.id); setCostForm(c); }}
                                  className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                                >Edit</button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pricing Versions */}
      <div className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Pricing Versions</h2>
        <p className="mb-4 text-xs text-slate-500">
          Every cost change creates a new pricing version that is reviewed before it takes effect: saving a cost creates a <strong>Pending</strong> proposal — it only becomes the active version after an admin approves it (approval re-runs the margin guard and blocks loss-making pricing). Historical usage keeps the version it was priced under — old versions are never mutated.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {visibleCosts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => loadCostVersions(c.provider, c.category)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                versionsFor?.provider === c.provider && versionsFor?.category === c.category
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              {c.provider} · {c.category}
            </button>
          ))}
        </div>
        {versionsFor && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Input/1M</th>
                  <th className="px-4 py-3">Output/1M</th>
                  <th className="px-4 py-3">Image</th>
                  <th className="px-4 py-3">Audio/min</th>
                  <th className="px-4 py-3">Effective From</th>
                  <th className="px-4 py-3">Effective Until</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {versionsLoading ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : costVersions.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">No versions yet.</td></tr>
                ) : (
                  costVersions.map((v) => (
                    <tr key={v.id} className="border-b border-slate-100 dark:border-slate-700/50">
                      <td className="px-4 py-3 font-medium">v{v.version}</td>
                      <td className="px-4 py-3 font-mono">${(v.inputRate / 100).toFixed(4)}</td>
                      <td className="px-4 py-3 font-mono">${(v.outputRate / 100).toFixed(4)}</td>
                      <td className="px-4 py-3 font-mono">${(v.imageRate / 100).toFixed(2)}</td>
                      <td className="px-4 py-3 font-mono">${(v.audioRate / 100).toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{new Date(v.effectiveFrom).toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{v.effectiveUntil ? new Date(v.effectiveUntil).toLocaleString() : 'active'}</td>
                      <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium dark:bg-slate-700">{v.source}</span></td>
                      <td className="px-4 py-3">{statusBadge(v.status, v.active)}</td>
                      <td className="px-4 py-3">
                        {v.status === 'pending' && (
                          <div className="flex gap-2">
                            <button onClick={() => approveVersion(v.id)}
                              className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700">
                              Approve
                            </button>
                            <button onClick={() => rejectVersion(v.id)}
                              className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700">
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Usage History */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Recent Usage</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Feature</th>
                <th className="px-4 py-3">Tokens In</th>
                <th className="px-4 py-3">Tokens Out</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No usage yet. AI calls will appear here.
                  </td>
                </tr>
              ) : (
                history.map((log) => (
                  <tr key={log.id} className="border-b border-slate-100 dark:border-slate-700/50">
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium dark:bg-slate-700">
                        {log.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">{providerNameById[log.providerId] || log.model}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{log.feature}</td>
                    <td className="px-4 py-3">{log.tokensInput.toLocaleString()}</td>
                    <td className="px-4 py-3">{log.tokensOutput.toLocaleString()}</td>
                    <td className="px-4 py-3">${(log.estimatedCostCents / 100).toFixed(4)}</td>
                    <td className="px-4 py-3">
                      {log.success ? (
                        <CheckCircleIcon className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircleIcon className="h-4 w-4 text-red-500" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
