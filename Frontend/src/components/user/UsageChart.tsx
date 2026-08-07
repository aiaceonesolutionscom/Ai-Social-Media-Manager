import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis } from
'recharts';
import type { ChartPoint } from '../../types';

interface UsageChartProps {
  data: ChartPoint[];
  variant?: 'line' | 'bar' | 'area';
  color?: string;
  valuePrefix?: string;
  ariaLabel: string;
}

const axisProps = {
  stroke: '#94a3b8',
  fontSize: 12,
  tickLine: false,
  axisLine: false
};

const tooltipStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  fontSize: 12,
  fontFamily: 'JetBrains Mono, monospace',
  boxShadow: '0 4px 16px rgba(15,23,42,0.08)'
};

export function UsageChart({ data, variant = 'line', color = '#4F46E5', valuePrefix = '', ariaLabel }: UsageChartProps) {
  const formatter = (value: number) => `${valuePrefix}${value.toLocaleString()}`;

  return (
    <div className="h-64 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        {variant === 'bar' ?
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} formatter={formatter} />
            <Bar dataKey="value" fill={color} radius={[8, 8, 0, 0]} maxBarSize={44} />
          </BarChart> :
        variant === 'area' ?
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} formatter={formatter} />
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} fill="url(#usageFill)" />
          </AreaChart> :

        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} formatter={formatter} />
            <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.5}
            dot={{ r: 3, fill: color }}
            activeDot={{ r: 5 }} />
          
          </LineChart>
        }
      </ResponsiveContainer>
    </div>);

}