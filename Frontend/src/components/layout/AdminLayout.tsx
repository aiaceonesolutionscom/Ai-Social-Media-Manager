import React from 'react';
import { AdminSidebar } from '../admin/AdminSidebar';
import { PageTransition } from './PageTransition';

export function AdminLayout({ children }: {children: React.ReactNode;}) {
  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <AdminSidebar />
      <main className="lg:pl-64">
        <PageTransition className="mx-auto max-w-6xl px-4 py-10 pb-28 lg:pb-16">{children}</PageTransition>
      </main>
    </div>);

}