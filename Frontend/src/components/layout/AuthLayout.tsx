import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from 'lucide-react';
import { Logo } from '../ui/Logo';
import { PageTransition } from './PageTransition';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  logoLabel?: string;
  showBack?: boolean;
}

export function AuthLayout({ title, subtitle, children, footer, logoLabel, showBack = true }: AuthLayoutProps) {
  return (
    <main className="flex min-h-full w-full items-center justify-center bg-slate-50 px-4 py-20 dark:bg-slate-950">
      <PageTransition className="w-full max-w-md">
        {showBack &&
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-slate-200">
          
            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
            Back to home
          </Link>
        }
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md sm:p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col items-center text-center">
            <Logo label={logoLabel} />
            <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
            <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
          </div>
          <div className="mt-8">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>}
      </PageTransition>
    </main>);

}