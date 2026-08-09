import React from 'react';
import { FacebookIcon, InstagramIcon, MessageCircleIcon, MegaphoneIcon } from 'lucide-react';
import type { ConnectionStatus, Platform, PlatformId } from '../../types';
import { Badge, type BadgeTone } from '../ui/Badge';
import { cn } from '../../utils/cn';

const icons: Record<PlatformId, React.ComponentType<{className?: string;}>> = {
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  whatsapp: MessageCircleIcon,
  meta_ads: MegaphoneIcon
};

const statusTone: Record<ConnectionStatus, BadgeTone> = {
  connected: 'emerald',
  disconnected: 'slate',
  pending: 'amber',
  error: 'red'
};

const statusLabel: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  disconnected: 'Not connected',
  pending: 'Pending',
  error: 'Error'
};

const dotTone: Record<ConnectionStatus, string> = {
  connected: 'bg-emerald-500',
  disconnected: 'bg-slate-300',
  pending: 'bg-amber-500',
  error: 'bg-red-500'
};

export function PlatformStatusBadge({ status }: {status: ConnectionStatus;}) {
  return (
    <Badge tone={statusTone[status]}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dotTone[status])} aria-hidden="true" />
      {statusLabel[status]}
    </Badge>);

}

export function PlatformStatus({ platform, action }: {platform: Platform;action?: React.ReactNode;}) {
  const Icon = icons[platform.id];
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <PlatformStatusBadge status={platform.status} />
      </div>
      <div className="flex-1">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">{platform.name}</h3>
        <p className="mt-1 text-sm text-slate-500">{platform.description}</p>
        {platform.account && <p className="mt-2 font-mono text-xs text-slate-400">{platform.account}</p>}
      </div>
      {action}
    </div>);

}

export { icons as platformIcons };