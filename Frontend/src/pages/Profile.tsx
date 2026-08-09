import React from 'react';
import { CameraIcon, CoinsIcon, KeyRoundIcon, SaveIcon, UserRoundIcon } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { BuyCreditsSection } from '../components/user/BuyCreditsSection';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function ProfilePage() {
  const { user, refreshUser } = useUserAuth();

  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [savingProfile, setSavingProfile] = React.useState(false);

  const [avatarFile, setAvatarFile] = React.useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = React.useState(false);

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [savingPassword, setSavingPassword] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
    }
  }, [user]);

  const onAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const saveAvatar = async () => {
    if (!avatarFile) return;
    setSavingAvatar(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(avatarFile);
      });
      await apiRequest(endpoints.userAvatar, {
        method: 'POST',
        body: JSON.stringify({ dataUrl }),
      });
      await refreshUser();
      setAvatarFile(null);
      setAvatarPreview(null);
      notify.success('Avatar updated', 'Your profile picture has been saved.');
    } catch (err) {
      notify.error('Failed to update avatar', (err as Error).message);
    } finally {
      setSavingAvatar(false);
    }
  };

  const saveProfile = async () => {
    if (!name.trim() || !email.trim()) {
      notify.error('Missing fields', 'Name and email are required.');
      return;
    }
    setSavingProfile(true);
    try {
      await apiRequest(endpoints.userProfile, {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      await refreshUser();
      notify.success('Profile saved', 'Your account details have been updated.');
    } catch (err) {
      notify.error('Failed to save profile', (err as Error).message);
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (newPassword.length < 6) {
      notify.error('Weak password', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      notify.error('Passwords do not match', 'New password and confirmation must match.');
      return;
    }
    setSavingPassword(true);
    try {
      await apiRequest(endpoints.userPassword, {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      notify.success('Password changed', 'Use your new password next time you log in.');
    } catch (err) {
      notify.error('Failed to change password', (err as Error).message);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <DashboardLayout>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your name, email, avatar and password.</p>
      </header>

      <div className="space-y-6">
        <Card as="section" hoverable={false}>
          <CardHeader title="Profile picture" description="A photo helps your team recognize you." />
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <div className="relative">
              {avatarPreview || user?.avatarUrl ? (
                <img
                  src={avatarPreview || user?.avatarUrl}
                  alt="Your profile"
                  className="h-20 w-20 rounded-2xl object-cover"
                />
              ) : (
                <span className="grid h-20 w-20 place-items-center rounded-2xl bg-indigo-600 font-mono text-2xl font-bold text-white">
                  {initials(user?.name || user?.email || 'User')}
                </span>
              )}
              <span className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-slate-100 text-slate-500 dark:border-slate-900 dark:bg-slate-800">
                <CameraIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="cursor-pointer">
                <span className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 sm:w-auto dark:border dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
                  <UserRoundIcon className="h-4 w-4" aria-hidden="true" />
                  Choose image
                </span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onAvatarPick} />
              </label>
              <Button onClick={saveAvatar} loading={savingAvatar} disabled={!avatarFile}>
                <SaveIcon className="h-4 w-4" aria-hidden="true" /> Save avatar
              </Button>
            </div>
          </div>
        </Card>

        <Card as="section" hoverable={false}>
          <CardHeader title="Account details" description="Your name and the email you use to sign in." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            <Input label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={saveProfile} loading={savingProfile}>
              <SaveIcon className="h-4 w-4" aria-hidden="true" /> Save changes
            </Button>
          </div>
        </Card>

        <Card as="section" hoverable={false}>
          <CardHeader title="Change password" description="Use at least 6 characters. Leave the current field blank if you signed up with a social login." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Current password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            <div />
            <Input label="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            <Input label="Confirm new password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={savePassword} loading={savingPassword}>
              <KeyRoundIcon className="h-4 w-4" aria-hidden="true" /> Update password
            </Button>
          </div>
        </Card>

        <Card as="section" hoverable={false} className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
            <CoinsIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="flex-1">
            <BuyCreditsSection onSuccess={refreshUser} />
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
