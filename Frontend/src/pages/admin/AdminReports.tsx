import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3Icon,
  CoinsIcon,
  CreditCardIcon,
  CpuIcon,
  DownloadIcon,
  FileTextIcon,
  LifeBuoyIcon,
  MegaphoneIcon,
  PackageIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { StatsCard } from '../../components/ui/StatsCard';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import { formatDate } from '../../utils/format';
import { cn } from '../../utils/cn';

interface ReportData {
  packages: any[];
  users: any[];
  payments: any[];
  posts: any[];
  tokenTransactions: any[];
  adCampaigns: any[];
  aiUsage: any[];
  supportTickets: any[];
  summary: any;
}

type TabId = 'users' | 'payments' | 'packages' | 'posts' | 'tokens' | 'ai' | 'ads' | 'support';

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'users', label: 'Users', icon: UsersIcon },
  { id: 'payments', label: 'Payments', icon: CreditCardIcon },
  { id: 'packages', label: 'Packages', icon: PackageIcon },
  { id: 'posts', label: 'Posts', icon: FileTextIcon },
  { id: 'tokens', label: 'Tokens', icon: CoinsIcon },
  { id: 'ai', label: 'AI Usage', icon: CpuIcon },
  { id: 'ads', label: 'Ads', icon: MegaphoneIcon },
  { id: 'support', label: 'Support', icon: LifeBuoyIcon },
];

const DATE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
] as const;

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

function day(iso?: string): string {
  return (iso || '').slice(0, 10);
}

function statusTone(status: string): 'emerald' | 'amber' | 'red' | 'slate' | 'indigo' {
  const s = (status || '').toLowerCase();
  if (s === 'completed' || s === 'active' || s === 'success' || s === 'done' || s === 'open') return 'emerald';
  if (s === 'pending' || s === 'scheduled' || s === 'inactive') return 'amber';
  if (s === 'failed' || s === 'refunded' || s === 'cancelled') return 'red';
  if (s === 'pro' || s === 'exclusive') return 'indigo';
  return 'slate';
}

export function AdminReports() {
  const navigate = useNavigate();
  const [data, setData] = React.useState<ReportData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<TabId>('users');

  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [pkgFilter, setPkgFilter] = React.useState('all');
  const [userStatus, setUserStatus] = React.useState('all');
  const [payStatus, setPayStatus] = React.useState('all');
  const [payType, setPayType] = React.useState('all');
  const [postStatus, setPostStatus] = React.useState('all');
  const [tokenType, setTokenType] = React.useState('all');
  const [aiCategory, setAiCategory] = React.useState('all');
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    async function fetchData() {
      try {
        const res = await apiRequest<ReportData>(endpoints.adminReports);
        setData(res);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setAuthToken(null);
          notify.error('Session expired', 'Please login again.');
          navigate('/admin/login');
          return;
        }
        notify.error('Failed to load reports', (err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [navigate]);

  const applyPreset = (id: (typeof DATE_PRESETS)[number]['id']) => {
    if (id === 'all') {
      setFrom('');
      setTo('');
      return;
    }
    const today = todayStr();
    if (id === 'today') {
      setFrom(today);
      setTo(today);
    } else if (id === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      setFrom(d.toISOString().split('T')[0]);
      setTo(today);
    } else if (id === 'month') {
      const now = new Date();
      setFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
      setTo(today);
    }
  };

  const clearFilters = () => {
    setFrom('');
    setTo('');
    setPkgFilter('all');
    setUserStatus('all');
    setPayStatus('all');
    setPayType('all');
    setPostStatus('all');
    setTokenType('all');
    setAiCategory('all');
    setQuery('');
  };

  const inDateRange = React.useCallback(
    (iso?: string) => {
      const d = day(iso);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    },
    [from, to]
  );

  const matchQuery = React.useCallback(
    (...fields: Array<string | undefined>) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return fields.some((f) => (f || '').toLowerCase().includes(q));
    },
    [query]
  );

  const pkgBySlug = React.useMemo(() => {
    const m = new Map<string, any>();
    (data?.packages || []).forEach((p: any) => m.set(p.slug, p));
    return m;
  }, [data]);

  const paymentsFiltered = React.useMemo(() => {
    if (!data) return [];
    return data.payments.filter((p: any) => {
      if (!inDateRange(p.createdAt)) return false;
      if (pkgFilter !== 'all' && p.packageId !== pkgFilter) return false;
      if (payStatus !== 'all' && p.status !== payStatus) return false;
      if (payType !== 'all' && p.type !== payType) return false;
      if (!matchQuery(p.userName, p.userEmail, p.packageName, p.phone)) return false;
      return true;
    });
  }, [data, inDateRange, matchQuery, pkgFilter, payStatus, payType]);

  const usersFiltered = React.useMemo(() => {
    if (!data) return [];
    return data.users.filter((u: any) => {
      if (!inDateRange(u.createdAt)) return false;
      if (pkgFilter !== 'all' && u.packageId !== pkgFilter) return false;
      if (userStatus !== 'all' && u.active !== (userStatus === 'active')) return false;
      if (!matchQuery(u.name, u.email, u.phone, u.packageName)) return false;
      return true;
    });
  }, [data, inDateRange, matchQuery, pkgFilter, userStatus]);

  const packagesTab = React.useMemo(() => {
    if (!data) return [];
    const agg = new Map<string, { slug: string; name: string; purchaseCount: number; completedCount: number; revenueCents: number; buyers: Set<string> }>();
    for (const p of paymentsFiltered) {
      const slug = p.packageId || 'free';
      if (!agg.has(slug)) {
        agg.set(slug, { slug, name: pkgBySlug.get(slug)?.name || p.packageName || 'Free', purchaseCount: 0, completedCount: 0, revenueCents: 0, buyers: new Set<string>() });
      }
      const entry = agg.get(slug)!;
      entry.purchaseCount++;
      if (p.status === 'completed') {
        entry.completedCount++;
        entry.revenueCents += p.amountCents;
      }
      entry.buyers.add(p.userName || p.phone);
    }
    const rows = data.packages.map((pkg: any) => {
      const e = agg.get(pkg.slug);
      return {
        slug: pkg.slug,
        name: pkg.name,
        priceCents: pkg.priceCents,
        includedTokens: pkg.includedTokens,
        isActive: pkg.isActive,
        purchaseCount: e?.purchaseCount || 0,
        completedCount: e?.completedCount || 0,
        revenueCents: e?.revenueCents || 0,
        buyerCount: e?.buyers.size || 0,
        buyers: e ? [...e.buyers] : [],
      };
    });
    return rows.sort((a: any, b: any) => b.purchaseCount - a.purchaseCount);
  }, [data, paymentsFiltered, pkgBySlug]);

  const postsTab = React.useMemo(() => {
    if (!data) return [];
    return data.posts.filter((p: any) => {
      if (!inDateRange(p.createdAt)) return false;
      if (postStatus !== 'all' && p.status !== postStatus) return false;
      if (!matchQuery(p.userName, p.phone)) return false;
      return true;
    });
  }, [data, inDateRange, matchQuery, postStatus]);

  const tokensTab = React.useMemo(() => {
    if (!data) return [];
    return data.tokenTransactions.filter((t: any) => {
      if (!inDateRange(t.createdAt)) return false;
      if (tokenType !== 'all' && t.type !== tokenType) return false;
      if (!matchQuery(t.userName, t.phone, t.description)) return false;
      return true;
    });
  }, [data, inDateRange, matchQuery, tokenType]);

  const aiTab = React.useMemo(() => {
    if (!data) return [];
    return data.aiUsage.filter((l: any) => {
      if (!inDateRange(l.createdAt)) return false;
      if (aiCategory !== 'all' && l.category !== aiCategory) return false;
      if (!matchQuery(l.userName, l.phone, l.provider, l.model)) return false;
      return true;
    });
  }, [data, inDateRange, matchQuery, aiCategory]);

  const adsTab = React.useMemo(() => {
    if (!data) return [];
    return data.adCampaigns.filter((c: any) => {
      if (!inDateRange(c.createdAt)) return false;
      if (!matchQuery(c.userName, c.phone, c.name)) return false;
      return true;
    });
  }, [data, inDateRange, matchQuery]);

  const supportTab = React.useMemo(() => {
    if (!data) return [];
    return data.supportTickets.filter((t: any) => {
      if (!inDateRange(t.createdAt)) return false;
      if (!matchQuery(t.userName, t.phone, t.subject)) return false;
      return true;
    });
  }, [data, inDateRange, matchQuery]);

  const completedPayments = React.useMemo(() => paymentsFiltered.filter((p: any) => p.status === 'completed'), [paymentsFiltered]);
  const revenueCents = React.useMemo(() => completedPayments.reduce((s: number, p: any) => s + p.amountCents, 0), [completedPayments]);

  const signupsByDay = React.useMemo(() => {
    const byDay = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      byDay.set(d.toISOString().split('T')[0], 0);
    }
    usersFiltered.forEach((u: any) => {
      const d = day(u.createdAt);
      if (byDay.has(d)) byDay.set(d, byDay.get(d)! + 1);
    });
    return [...byDay.entries()].map(([date, count]) => ({ date: date.slice(5), count }));
  }, [usersFiltered]);

  const revenueByPackage = React.useMemo(() => {
    return packagesTab
      .filter((p: any) => p.completedCount > 0)
      .map((p: any) => ({ name: p.name, revenue: p.revenueCents / 100 }))
      .filter((p: any) => p.revenue > 0);
  }, [packagesTab]);

  const filterDescription = () => {
    const parts: string[] = [];
    if (from && to) parts.push(`Date: ${from} → ${to}`);
    else if (from) parts.push(`From: ${from}`);
    else if (to) parts.push(`Until: ${to}`);
    else parts.push('Date: All time');
    if (pkgFilter !== 'all') parts.push(`Package: ${pkgBySlug.get(pkgFilter)?.name || pkgFilter}`);
    if (userStatus !== 'all') parts.push(`User status: ${userStatus}`);
    if (payStatus !== 'all') parts.push(`Payment status: ${payStatus}`);
    if (payType !== 'all') parts.push(`Payment type: ${payType}`);
    if (postStatus !== 'all') parts.push(`Post status: ${postStatus}`);
    if (tokenType !== 'all') parts.push(`Token type: ${tokenType}`);
    if (aiCategory !== 'all') parts.push(`AI category: ${aiCategory}`);
    if (query) parts.push(`Search: "${query}"`);
    return parts.join('  |  ');
  };

  const tableConfig: Record<TabId, { columns: Array<Column<any>>; rows: any[] }> = {
    users: {
      columns: [
        { key: 'name', header: 'Name', render: (u: any) => <span className="font-medium text-slate-900 dark:text-slate-100">{u.name || '—'}</span> },
        { key: 'email', header: 'Email', render: (u: any) => u.email || '—' },
        { key: 'package', header: 'Package', render: (u: any) => <Badge tone={statusTone(u.packageId)}>{u.packageName}</Badge> },
        { key: 'spent', header: 'Total spent', render: (u: any) => <span className="font-mono">{fmtCents(u.totalSpentCents)}</span> },
        { key: 'tokens', header: 'Tokens (used/left)', render: (u: any) => <span className="font-mono">{u.tokensUsed.toLocaleString()} / {u.tokensRemaining.toLocaleString()}</span> },
        { key: 'status', header: 'Status', render: (u: any) => <Badge tone={u.active ? 'emerald' : 'red'}>{u.active ? 'active' : 'inactive'}</Badge> },
        { key: 'joined', header: 'Joined', render: (u: any) => <span className="whitespace-nowrap">{formatDate(u.createdAt)}</span> },
      ],
      rows: usersFiltered,
    },
    payments: {
      columns: [
        { key: 'date', header: 'Date', render: (p: any) => <span className="whitespace-nowrap">{formatDate(p.createdAt)}</span> },
        { key: 'user', header: 'User', render: (p: any) => <span className="font-medium text-slate-900 dark:text-slate-100">{p.userName || p.phone}</span> },
        { key: 'package', header: 'Package', render: (p: any) => <Badge tone={statusTone(p.packageId)}>{p.packageName}</Badge> },
        { key: 'amount', header: 'Amount', render: (p: any) => <span className="font-mono">{fmtCents(p.amountCents)}</span> },
        { key: 'tokens', header: 'Tokens', render: (p: any) => <span className="font-mono">{p.tokenCount.toLocaleString()}</span> },
        { key: 'type', header: 'Type', render: (p: any) => <span className="capitalize">{p.type}</span> },
        { key: 'status', header: 'Status', render: (p: any) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> },
      ],
      rows: paymentsFiltered,
    },
    packages: {
      columns: [
        { key: 'name', header: 'Package', render: (p: any) => <span className="font-medium text-slate-900 dark:text-slate-100">{p.name}</span> },
        { key: 'price', header: 'Price', render: (p: any) => <span className="font-mono">{fmtCents(p.priceCents)}</span> },
        { key: 'buyers', header: 'Buyers', render: (p: any) => <span className="font-bold text-indigo-600 dark:text-indigo-300">{p.buyerCount} {p.buyerCount === 1 ? 'user' : 'users'}</span> },
        { key: 'purchases', header: 'Purchases', render: (p: any) => <span className="font-mono">{p.purchaseCount}</span> },
        { key: 'completed', header: 'Completed', render: (p: any) => <span className="font-mono">{p.completedCount}</span> },
        { key: 'revenue', header: 'Revenue', render: (p: any) => <span className="font-mono text-emerald-600 dark:text-emerald-300">{fmtCents(p.revenueCents)}</span> },
      ],
      rows: packagesTab,
    },
    posts: {
      columns: [
        { key: 'date', header: 'Date', render: (p: any) => <span className="whitespace-nowrap">{formatDate(p.createdAt)}</span> },
        { key: 'user', header: 'User', render: (p: any) => <span className="font-medium text-slate-900 dark:text-slate-100">{p.userName || p.phone}</span> },
        { key: 'status', header: 'Status', render: (p: any) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> },
      ],
      rows: postsTab,
    },
    tokens: {
      columns: [
        { key: 'date', header: 'Date', render: (t: any) => <span className="whitespace-nowrap">{formatDate(t.createdAt)}</span> },
        { key: 'user', header: 'User', render: (t: any) => <span className="font-medium text-slate-900 dark:text-slate-100">{t.userName || t.phone}</span> },
        { key: 'type', header: 'Type', render: (t: any) => <Badge tone={statusTone(t.type)}>{t.type}</Badge> },
        { key: 'amount', header: 'Amount', render: (t: any) => <span className={cn('font-mono', t.amount > 0 ? 'text-emerald-600 dark:text-emerald-300' : '')}>{t.amount > 0 ? '+' : ''}{t.amount}</span> },
        { key: 'desc', header: 'Description', render: (t: any) => t.description || '—' },
      ],
      rows: tokensTab,
    },
    ai: {
      columns: [
        { key: 'date', header: 'Date', render: (l: any) => <span className="whitespace-nowrap">{formatDate(l.createdAt)}</span> },
        { key: 'user', header: 'User', render: (l: any) => <span className="font-medium text-slate-900 dark:text-slate-100">{l.userName || l.phone || '—'}</span> },
        { key: 'cat', header: 'Category', render: (l: any) => <Badge tone="indigo">{l.category}</Badge> },
        { key: 'provider', header: 'Provider', render: (l: any) => l.provider },
        { key: 'tokens', header: 'Tokens (in/out)', render: (l: any) => <span className="font-mono">{l.tokensInput.toLocaleString()} / {l.tokensOutput.toLocaleString()}</span> },
        { key: 'cost', header: 'Cost', render: (l: any) => <span className="font-mono">{fmtCents(l.estimatedCostCents)}</span> },
        { key: 'ok', header: 'Result', render: (l: any) => <Badge tone={l.success ? 'emerald' : 'red'}>{l.success ? 'success' : 'failed'}</Badge> },
      ],
      rows: aiTab,
    },
    ads: {
      columns: [
        { key: 'date', header: 'Date', render: (c: any) => <span className="whitespace-nowrap">{formatDate(c.createdAt)}</span> },
        { key: 'user', header: 'User', render: (c: any) => <span className="font-medium text-slate-900 dark:text-slate-100">{c.userName || c.phone}</span> },
        { key: 'name', header: 'Campaign', render: (c: any) => c.name || '—' },
        { key: 'objective', header: 'Objective', render: (c: any) => <span className="capitalize">{c.objective}</span> },
        { key: 'budget', header: 'Budget', render: (c: any) => <span className="font-mono">{fmtCents(c.budgetCents)}</span> },
        { key: 'status', header: 'Status', render: (c: any) => <Badge tone={statusTone(c.status)}>{c.status}</Badge> },
      ],
      rows: adsTab,
    },
    support: {
      columns: [
        { key: 'date', header: 'Date', render: (t: any) => <span className="whitespace-nowrap">{formatDate(t.createdAt)}</span> },
        { key: 'user', header: 'User', render: (t: any) => <span className="font-medium text-slate-900 dark:text-slate-100">{t.userName || t.phone}</span> },
        { key: 'subject', header: 'Subject', render: (t: any) => t.subject || '—' },
        { key: 'priority', header: 'Priority', render: (t: any) => <Badge tone={statusTone(t.priority)}>{t.priority}</Badge> },
        { key: 'status', header: 'Status', render: (t: any) => <Badge tone={statusTone(t.status)}>{t.status}</Badge> },
      ],
      rows: supportTab,
    },
  };

  const exportPdf = () => {
    if (!data) return;
    const cfg = tableConfig[tab];
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.setTextColor(30, 27, 75);
    doc.text('Admin Report', 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 27);
    doc.text('Section: ' + TABS.find((t) => t.id === tab)?.label, 14, 33);
    doc.setFontSize(9);
    const desc = filterDescription();
    const wrapped = doc.splitTextToSize(desc, 182);
    doc.text(wrapped, 14, 40);

    const summaryLines = [
      `Users: ${usersFiltered.length}   |   Revenue (completed): ${fmtCents(revenueCents)}   |   Completed payments: ${completedPayments.length}   |   Row count: ${cfg.rows.length}`,
    ];
    doc.setFontSize(9);
    doc.text(summaryLines, 14, 40 + wrapped.length * 4 + 4);

    autoTable(doc, {
      startY: 40 + wrapped.length * 4 + 10,
      head: [cfg.columns.map((c) => c.header)],
      body: cfg.rows.map((r: any) =>
        cfg.columns.map((c) => {
          const cell = c.render(r);
          if (cell === null || cell === undefined) return '';
          if (typeof cell === 'string' || typeof cell === 'number') return String(cell);
          return String((cell as any)?.props?.children ?? '');
        })
      ),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [49, 46, 129] },
    });

    doc.save(`admin-report-${tab}-${todayStr()}.pdf`);
  };

  const selectCls =
    'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

  if (loading) {
    return (
      <AdminLayout>
        <AdminHeader title="Reports" description="Platform data, filters and PDF exports." />
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
          <div className="h-96 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
        </div>
      </AdminLayout>
    );
  }

  const summary = data?.summary || {};

  return (
    <AdminLayout>
      <AdminHeader
        title="Reports"
        description="All platform data with filters, plus PDF report export."
        action={
          <Button onClick={exportPdf}>
            <DownloadIcon className="h-4 w-4" />
            Download PDF
          </Button>
        }
      />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <StatsCard label="Users (filtered)" value={String(usersFiltered.length)} icon={UsersIcon} tone="indigo" index={0} />
        <StatsCard label="New today" value={String(summary.newToday ?? 0)} icon={BarChart3Icon} tone="emerald" change={{ value: `this month: ${summary.newThisMonth ?? 0}`, positive: true }} index={1} />
        <StatsCard label="Revenue (filtered)" value={fmtCents(revenueCents)} icon={CreditCardIcon} tone="amber" change={{ value: `${completedPayments.length} completed`, positive: true }} index={2} />
        <StatsCard label="Completed payments" value={String(completedPayments.length)} icon={CreditCardIcon} tone="slate" index={3} />
        <StatsCard label="Tokens used" value={usersFiltered.reduce((s: number, u: any) => s + (u.tokensUsed || 0), 0).toLocaleString()} icon={CoinsIcon} tone="slate" index={4} />
        <StatsCard label="AI spend" value={fmtCents(aiTab.reduce((s: number, l: any) => s + (l.estimatedCostCents || 0), 0))} icon={CpuIcon} tone="indigo" index={5} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card as="section" hoverable={false}>
          <CardHeader title="Signups per day" description="Last 14 days (respects filters)" />
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signupsByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" name="Signups" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card as="section" hoverable={false}>
          <CardHeader title="Revenue by package" description="Completed payments (respects filters)" />
          <div className="h-56">
            {revenueByPackage.length === 0 ? (
              <p className="text-sm text-slate-500">No completed revenue in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueByPackage}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="revenue" name="Revenue ($)" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card as="section" hoverable={false} className="mt-6">
        <CardHeader
          title="Filters"
          description={filterDescription()}
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              <XIcon className="h-4 w-4" />
              Clear
            </Button>
          }
        />
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">Quick range</span>
            <div className="flex gap-1.5">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                    (from || to) === '' && preset.id === 'all'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
                  )}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Package
            <select value={pkgFilter} onChange={(e) => setPkgFilter(e.target.value)} className={selectCls}>
              <option value="all">All packages</option>
              {(data?.packages || []).map((p: any) => (
                <option key={p.slug} value={p.slug}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            User status
            <select value={userStatus} onChange={(e) => setUserStatus(e.target.value)} className={selectCls}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Payment status
            <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)} className={selectCls}>
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Payment type
            <select value={payType} onChange={(e) => setPayType(e.target.value)} className={selectCls}>
              <option value="all">All</option>
              <option value="subscription">Subscription</option>
              <option value="one_time">One time</option>
              <option value="token_purchase">Token purchase</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Post status
            <select value={postStatus} onChange={(e) => setPostStatus(e.target.value)} className={selectCls}>
              <option value="all">All</option>
              {Array.from(new Set((data?.posts || []).map((p: any) => p.status))).map((s: any) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Token type
            <select value={tokenType} onChange={(e) => setTokenType(e.target.value)} className={selectCls}>
              <option value="all">All</option>
              {Array.from(new Set((data?.tokenTransactions || []).map((t: any) => t.type))).map((s: any) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            AI category
            <select value={aiCategory} onChange={(e) => setAiCategory(e.target.value)} className={selectCls}>
              <option value="all">All</option>
              {Array.from(new Set((data?.aiUsage || []).map((l: any) => l.category))).map((s: any) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-500">
            Search
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, email, phone, package..."
                className={cn(selectCls, 'w-full pl-9')}
              />
            </div>
          </label>
        </div>
      </Card>

      <div className="mt-6">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              )}>
              <t.icon className="h-4 w-4" />
              {t.label}
              <span className="font-mono text-xs opacity-70">{tableConfig[t.id].rows.length}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <DataTable
            columns={tableConfig[tab].columns}
            rows={tableConfig[tab].rows}
            rowKey={(r: any) => r.id || r.phone || r.slug || r.createdAt}
            caption={`${TABS.find((t) => t.id === tab)?.label} report`}
            emptyMessage="No records match the current filters."
          />
        </div>
      </div>
    </AdminLayout>
  );
}
