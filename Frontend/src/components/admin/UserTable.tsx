import React from 'react';
import { EyeIcon, Trash2Icon, UserCheckIcon, UserMinusIcon } from 'lucide-react';
import type { PlatformUser } from '../../types';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../utils/cn';

interface UserTableProps {
  users: PlatformUser[];
  onView: (user: PlatformUser) => void;
  onToggleStatus: (user: PlatformUser) => void;
  onDelete: (user: PlatformUser) => void;
}

export function UserTable({ users, onView, onToggleStatus, onDelete }: UserTableProps) {
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission('users.update');
  const canDelete = hasPermission('users.delete');

  const columns: Array<Column<PlatformUser>> = [
  { key: 'phone', header: 'Phone', render: (u) => <span className="font-mono text-xs">{u.phone}</span> },
  {
    key: 'name',
    header: 'Name',
    render: (u) => <span className="font-medium text-slate-900 dark:text-slate-100">{u.name}</span>
  },
  { key: 'package', header: 'Package', render: (u) => <Badge tone="indigo">{u.packageName}</Badge> },
  { key: 'tokens', header: 'Tokens', render: (u) => <span className="font-mono">{u.tokens.toLocaleString()}</span> },
  {
    key: 'status',
    header: 'Status',
    render: (u) => <Badge tone={u.status === 'active' ? 'emerald' : 'slate'}>{u.status}</Badge>
  },
  { key: 'joined', header: 'Joined', render: (u) => <span className="whitespace-nowrap">{formatDate(u.joined)}</span> },
  {
    key: 'actions',
    header: 'Actions',
    render: (u) =>
    <div className="flex items-center justify-end gap-2 md:justify-start">
          <button
        type="button"
        onClick={() => onView(u)}
        aria-label={`View ${u.name}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
        
            <EyeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            View
          </button>
          {canUpdate && (
            <button
              type="button"
              onClick={() => onToggleStatus(u)}
              aria-label={`${u.status === 'active' ? 'Deactivate' : 'Activate'} ${u.name}`}
              className={
                u.status === 'active' ?
                  'inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10' :
                  'inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-50 dark:border-emerald-500/30 dark:hover:bg-emerald-500/10'
              }>
              {u.status === 'active' ?
                <UserMinusIcon className="h-3.5 w-3.5" aria-hidden="true" /> :
                <UserCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />}
              {u.status === 'active' ? 'Deactivate' : 'Activate'}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(u)}
              aria-label={`Delete ${u.name}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10',
              )}>
              <Trash2Icon className="h-3.5 w-3.5" aria-hidden="true" />
              Delete
            </button>
          )}
        </div>

  }];


  return (
    <DataTable
      columns={columns}
      rows={users}
      rowKey={(u) => u.id}
      caption="All registered users"
      emptyMessage="No users match your search." />);


}
