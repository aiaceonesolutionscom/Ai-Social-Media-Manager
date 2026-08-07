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
  byCategory: Record<string, { requests: number; costCents: number }>;
  byProvider: Record<string, { requests: number; costCents: number }>;
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
  const [showAddForm, setShowAddForm] = React.useState<string | null>(null);
  const [newProvider, setNewProvider] = React.useState({ provider: '', displayName: '', apiKey: '', baseUrl: '', model: '' });
  const [editingCost, setEditingCost] = React.useState<string | null>(null);
  const [costForm, setCostForm] = React.useState<Partial<AICost>>({});

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
      notify.success('Provider activated');
      await fetchData();
    } catch (err) {
      notify.error('Failed to activate', (err as Error).message);
    }
  };

  const testConnection = async (id: string) => {
    setTestingId(id);
    try {
      const result = await apiRequest<{ ok: boolean; message: string; latencyMs: number }>(
        `${endpoints.adminAIProviders}/${id}/test`,
        { method: 'POST' },
      );
      setTestResults((prev) => ({ ...prev, [id]: result }));
      if (result.ok) {
        notify.success('Connection OK', `${result.message} (${result.latencyMs}ms)`);
      } else {
        notify.error('Connection failed', result.message);
      }
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: (err as Error).message } }));
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
      await apiRequest(endpoints.adminAIProviders, {
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
      notify.success('Provider added');
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
      await apiRequest(endpoints.adminAIProvidersCosts, {
        method: 'PUT',
        body: JSON.stringify({ provider, category, ...costForm }),
      });
      notify.success('Cost config saved');
      setEditingCost(null);
      await fetchData();
    } catch (err) {
      notify.error('Failed to save', (err as Error).message);
    }
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

  return (
    <AdminLayout>
      <AdminHeader title="AI Providers" description="Manage AI service providers, costs, and usage." />

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
                      {p.isActive ? (
                        <CheckCircleIcon className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircleIcon className="h-5 w-5 text-slate-300" />
                      )}
                    </div>

                    <div className="mb-3 space-y-1 text-xs text-slate-500">
                      <p>Key: {p.apiKey || 'Not set'}</p>
                      <p>Base URL: {p.baseUrl || 'Default'}</p>
                    </div>

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
                      Save
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
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Cost/1M Input</th>
                <th className="px-4 py-3">Cost/1M Output</th>
                <th className="px-4 py-3">Cost/Image</th>
                <th className="px-4 py-3">Cost/Min Audio</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {costs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No cost configurations yet. Add a provider and activate it first.
                  </td>
                </tr>
              ) : (
                costs.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 dark:border-slate-700/50">
                    <td className="px-4 py-3 font-medium">{c.provider}</td>
                    <td className="px-4 py-3">{c.category}</td>
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
                ))
              )}
            </tbody>
          </table>
        </div>
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
                    <td className="px-4 py-3">{log.model}</td>
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
