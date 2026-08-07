import React from 'react';
import { ReceiptIcon, RotateCcwIcon } from 'lucide-react';
import type { Payment, PaymentStatus } from '../../types';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge, type BadgeTone } from '../ui/Badge';
import { formatCurrency, formatDate } from '../../utils/format';

const statusTone: Record<PaymentStatus, BadgeTone> = {
  succeeded: 'emerald',
  pending: 'amber',
  refunded: 'slate',
  failed: 'red'
};

interface PaymentTableProps {
  payments: Payment[];
  onViewReceipt: (payment: Payment) => void;
  onRefund: (payment: Payment) => void;
}

export function PaymentTable({ payments, onViewReceipt, onRefund }: PaymentTableProps) {
  const columns: Array<Column<Payment>> = [
  { key: 'date', header: 'Date', render: (p) => <span className="whitespace-nowrap">{formatDate(p.date)}</span> },
  {
    key: 'user',
    header: 'User',
    render: (p) => <span className="font-medium text-slate-900 dark:text-slate-100">{p.user}</span>
  },
  { key: 'plan', header: 'Plan', render: (p) => <Badge tone="indigo">{p.plan}</Badge> },
  {
    key: 'amount',
    header: 'Amount',
    render: (p) => <span className="font-mono font-semibold">{formatCurrency(p.amount)}</span>
  },
  { key: 'status', header: 'Status', render: (p) => <Badge tone={statusTone[p.status]}>{p.status}</Badge> },
  {
    key: 'actions',
    header: 'Actions',
    render: (p) =>
    <div className="flex items-center justify-end gap-2 md:justify-start">
          <button
        type="button"
        onClick={() => onViewReceipt(p)}
        aria-label={`View receipt ${p.id}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
        
            <ReceiptIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Receipt
          </button>
          {p.status === 'succeeded' &&
      <button
        type="button"
        onClick={() => onRefund(p)}
        aria-label={`Refund payment ${p.id}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10">
        
              <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Refund
            </button>
      }
        </div>

  }];


  return (
    <DataTable
      columns={columns}
      rows={payments}
      rowKey={(p) => p.id}
      caption="All payments"
      emptyMessage="No payments recorded yet." />);


}