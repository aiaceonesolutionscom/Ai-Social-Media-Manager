import React from 'react';
import { DashboardSidebar } from '../user/DashboardSidebar';
import { PageTransition } from './PageTransition';

interface DashboardLayoutProps {
  children: React.ReactNode;
  tokens: number;
  totalTokens: number;
}

export function DashboardLayout({ children, tokens, totalTokens }: DashboardLayoutProps) {
  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <DashboardSidebar tokens={tokens} totalTokens={totalTokens} />
      <main className="lg:pl-64">
        <PageTransition className="mx-auto max-w-6xl px-4 py-10 pb-28 lg:pb-16">{children}</PageTransition>
      </main>
    </div>);

}