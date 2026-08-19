import React from 'react';
import { DashboardSidebar } from '../user/DashboardSidebar';
import { UserNotifications } from '../user/UserNotifications';
import { PageTransition } from './PageTransition';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <DashboardSidebar />
      <main className="lg:pl-64">
        <div className="fixed right-4 top-4 z-40 lg:right-6 lg:top-5">
          <UserNotifications />
        </div>
        <PageTransition className="mx-auto max-w-6xl px-4 py-10 pb-28 lg:pb-16">{children}</PageTransition>
      </main>
    </div>);

}

