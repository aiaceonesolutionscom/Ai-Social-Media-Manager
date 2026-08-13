import React from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { Badge } from '../../components/ui/Badge';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

export function AdminProfile() {
  const { adminEmail, adminName, adminRole } = useAuth();
  const [name, setName] = React.useState(adminName || '');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (name.trim() !== (adminName || '')) payload.name = name.trim();
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      if (Object.keys(payload).length === 0) {
        notify.info('No changes', 'Nothing to update.');
        return;
      }
      await apiRequest(endpoints.adminProfile, { method: 'PUT', body: JSON.stringify(payload) });
      notify.success('Profile updated', 'Your changes have been saved.');
      setCurrentPassword('');
      setNewPassword('');
      window.location.reload();
    } catch (err) {
      notify.error('Could not update profile', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <AdminHeader title="Profile" description="Manage your admin account details." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card as="section" className="p-6">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xl font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
              {initials(adminName || adminEmail || '?')}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-slate-900 dark:text-slate-50">{adminName || 'Admin'}</p>
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">{adminEmail}</p>
              <div className="mt-2">
                <Badge tone={adminRole === 'super_admin' ? 'indigo' : 'emerald'}>{adminRole || 'admin'}</Badge>
              </div>
            </div>
          </div>
        </Card>

        <Card as="section" className="p-6 lg:col-span-2">
          <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-slate-50">Account details</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="admin-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Display name</label>
              <Input id="admin-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="admin-current-pw" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Current password</label>
                <Input id="admin-current-pw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Required to change password" />
              </div>
              <div>
                <label htmlFor="admin-new-pw" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">New password</label>
                <Input id="admin-new-pw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 8 characters" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveProfile} loading={saving}>Save changes</Button>
            </div>
          </div>
        </Card>
      </div>
    </AdminLayout>
  );
}
