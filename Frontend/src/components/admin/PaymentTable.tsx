
import { CheckIcon, ReceiptIcon, RotateCcwIcon, ShieldAlertIcon } from 'lucide-react';
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
  onConfirm?: (payment: Payment) => void;
  onRevoke?: (payment: Payment) => void;
}

export function PaymentTable({ payments, onViewReceipt, onRefund, onConfirm, onRevoke }: PaymentTableProps) {
  const columns: Array<Column<Payment>> = [
  { key: 'date', header: 'Date', render: (p) => <span className="whitespace-nowrap">{formatDate(p.date)}</span> },
  {
    key: 'user',
    header: 'User',
    render: (p) => <span className="font-medium text-slate-900 dark:text-slate-100">{p.user}</span>
  },
  { key: 'plan', header: 'Plan', render: (p) => <Badge tone="indigo">{p.plan}</Badge> },
  {
    key: 'method',
    header: 'Method',
    render: (p) => {
      const tone = p.method === 'local' ? 'emerald' : p.method === 'gateway' ? 'indigo' : 'slate';
      const label = p.method === 'local' ? 'Local' : p.method === 'gateway' ? 'Gateway' : 'Stripe';
      return <Badge tone={tone}>{label}</Badge>;
    }
  },
  {
    key: 'amount',
    header: 'Amount',
    render: (p) => <span className="font-mono font-semibold">{formatCurrency(p.amount)}</span>
  },
  {
    key: 'tax',
    header: 'Tax',
    render: (p) => {
      if (!p.taxPercent && !p.taxAmount) return <span className="text-slate-400">—</span>;
      const amount = p.method === 'gateway' ? `${p.taxAmount} PKR` : formatCurrency((p.taxAmount ?? 0) / 100);
      return <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{p.taxPercent}% · {amount}</span>;
    }
  },
  {
    key: 'mdr',
    header: 'MDR',
    render: (p) => {
      if (!p.mdrPercent && !p.mdrAmount) return <span className="text-slate-400">—</span>;
      const amount = p.method === 'gateway' ? `${p.mdrAmount} PKR` : formatCurrency((p.mdrAmount ?? 0) / 100);
      return <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{p.mdrPercent}% · {amount}</span>;
    }
  },
  { key: 'status', header: 'Status', render: (p) => <Badge tone={statusTone[p.status]}>{p.status}</Badge> },
  {
    key: 'actions',
    header: 'Actions',
    render: (p) =>
    <div className="flex items-center justify-end gap-2 md:justify-start">
          {p.status === 'pending' && p.method === 'local' && onConfirm &&
      <button
        type="button"
        onClick={() => onConfirm(p)}
        aria-label={`Confirm payment ${p.id}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10">
        
              <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Confirm paid
            </button>
      }
      {p.status === 'succeeded' && p.method === 'local' && onRevoke &&
      <button
        type="button"
        onClick={() => onRevoke(p)}
        aria-label={`Revoke payment ${p.id}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10">
        
              <ShieldAlertIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Revoke
            </button>
      }
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