import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CoinsIcon, DollarSignIcon, FileTextIcon, UsersIcon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { ActivityFeed } from '../../components/admin/ActivityFeed';
import { StatsCard } from '../../components/ui/StatsCard';
import { Card, CardHeader } from '../../components/ui/Card';
import { UsageChart } from '../../components/user/UsageChart';
import { apiRequest, endpoints, ApiError, setAuthToken } from '../../utils/api';
import { notify } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/format';

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalPosts: number;
  publishedPosts: number;
  totalRevenue: number;
  monthRevenue: number;
  totalTokensUsed: number;
  totalTokensRemaining: number;
}

interface ChartPoint {
  date: string;
  revenue: number;
  count: number;
}

const fallbackStats: Stats = {
  totalUsers: 0, activeUsers: 0, totalPosts: 0, publishedPosts: 0,
  totalRevenue: 0, monthRevenue: 0, totalTokensUsed: 0, totalTokensRemaining: 0,
};

const fallbackChart: ChartPoint[] = [];

const fallbackActivity = [
  { id: '1', type: 'user', message: 'System initialized', time: 'Just now' },
];

export function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = React.useState<Stats>(fallbackStats);
  const [chart, setChart] = React.useState<ChartPoint[]>(fallbackChart);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function fetchData() {
      try {
        const [statsData, chartData] = await Promise.all([
          apiRequest<Stats>(endpoints.adminStats),
          apiRequest<{ chart: ChartPoint[] }>(endpoints.adminStatsChart),
        ]);
        setStats(statsData);
        setChart(chartData.chart || []);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setAuthToken(null);
          notify.error('Session expired', 'Please login again.');
          navigate('/admin/login');
          return;
        }
        // use fallback
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const chartData = chart.map(c => ({ label: c.date.split('-')[1] + '/' + c.date.split('-')[2], value: c.revenue / 100 }));

  return (
    <AdminLayout>
      <AdminHeader title="Dashboard" description="Platform health for the last 7 days." />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard label="Users" value={String(stats.totalUsers)} icon={UsersIcon} tone="indigo"
          change={{ value: `${stats.activeUsers} active`, positive: true }} index={0} />
        <StatsCard label="Posts" value={String(stats.totalPosts)} icon={FileTextIcon} tone="emerald"
          change={{ value: `${stats.publishedPosts} published`, positive: true }} index={1} />
        <StatsCard label="Revenue" value={formatCurrency(stats.totalRevenue)} icon={DollarSignIcon} tone="amber"
          change={{ value: `This month: ${formatCurrency(stats.monthRevenue)}`, positive: true }} index={2} />
        <StatsCard label="Tokens used" value={stats.totalTokensUsed.toLocaleString()} icon={CoinsIcon} tone="slate"
          change={{ value: `${stats.totalTokensRemaining.toLocaleString()} remaining`, positive: true }} index={3} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card as="section" hoverable={false} className="lg:col-span-2">
          <CardHeader title="Revenue" description="Daily revenue over the last 7 days" />
          {loading ? (
            <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
          ) : (
            <UsageChart data={chartData.length > 0 ? chartData : [{ label: 'No data', value: 0 }]} variant="line" valuePrefix="$" ariaLabel="Daily revenue for the last seven days" />
          )}
        </Card>

        <Card as="section" hoverable={false}>
          <CardHeader title="Quick stats" description="Platform overview" />
          <div className="space-y-4">
            <div className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <span className="text-sm text-slate-500">Total Users</span>
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-50">{stats.totalUsers}</span>
            </div>
            <div className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <span className="text-sm text-slate-500">Published Posts</span>
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-50">{stats.publishedPosts}</span>
            </div>
            <div className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <span className="text-sm text-slate-500">Month Revenue</span>
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-50">{formatCurrency(stats.monthRevenue)}</span>
            </div>
            <div className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <span className="text-sm text-slate-500">Tokens Remaining</span>
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-50">{stats.totalTokensRemaining.toLocaleString()}</span>
            </div>
          </div>
        </Card>
      </div>
    </AdminLayout>
  );
}
