import React from 'react';
import { Link } from 'react-router-dom';
import { AudioLinesIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

interface LogoProps {
  to?: string;
  label?: string;
  className?: string;
  compact?: boolean;
}

export function Logo({ to = '/', label = 'EchoPost', className, compact = false }: LogoProps) {
  return (
    <Link
      to={to}
      aria-label={`${label} home`}
      className={cn('inline-flex items-center gap-2.5 font-bold text-slate-900 dark:text-slate-50', className)}>
      
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white">
        <AudioLinesIcon className="h-5 w-5" aria-hidden="true" />
      </span>
      {!compact && <span className="text-lg tracking-tight">{label}</span>}
    </Link>);

}