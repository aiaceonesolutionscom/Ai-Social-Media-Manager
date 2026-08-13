import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SignUp } from '@clerk/clerk-react';
import { AuthLayout } from '../components/layout/AuthLayout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useUserAuth } from '../contexts/UserAuthContext';

export function Signup() {
  const navigate = useNavigate();
  const { signup } = useUserAuth();
  const [mode, setMode] = useState<'clerk' | 'legacy'>('clerk');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    sessionStorage.setItem('auth_redirect_target', '/packages');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name || !email || !password) {
      setError('All fields are required');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    const result = await signup(email, password, name);
    setLoading(false);

    if (result.success) {
      navigate('/packages');
    } else {
      setError(result.error || 'Signup failed');
    }
  };

  const handleOAuth = (provider: string) => {
    window.location.href = `${window.location.origin}/api/auth/${provider}`;
  };

  const footer = (
    <>
      Already have an account?{' '}
      <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-300">
        Log in
      </Link>
    </>
  );

  if (mode === 'clerk') {
    return (
      <AuthLayout
        title="Create Your Account"
        subtitle="Start turning voice notes into social media posts with AI."
        footer={footer}>
        <SignUp
          signInUrl="/login"
          appearance={{
            variables: { colorPrimary: '#6366f1', borderRadius: '10px' },
            elements: { footer: 'hidden', previewMode: 'hidden' },
          }}
        />
        <button
          type="button"
          onClick={() => setMode('legacy')}
          className="mt-4 w-full text-center text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          Prefer email &amp; password? Use the classic form instead
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create Your Account"
      subtitle="Start turning voice notes into social media posts with AI."
      footer={footer}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        <Input
          label="Full name"
          placeholder="John Doe"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button type="submit" fullWidth disabled={loading}>
          {loading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200 dark:border-slate-700" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-3 text-slate-500 dark:bg-slate-900 dark:text-slate-400">or continue with</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Button variant="secondary" onClick={() => handleOAuth('google')}>
          Google
        </Button>
        <Button variant="secondary" onClick={() => handleOAuth('facebook')}>
          Facebook
        </Button>
        <Button variant="secondary" onClick={() => handleOAuth('github')}>
          GitHub
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        By continuing you agree to our{' '}
        <a href="#terms" className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-300">
          Terms of Service
        </a>{' '}
        and{' '}
        <a href="#privacy" className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-300">
          Privacy Policy
        </a>
        .
      </p>
    </AuthLayout>
  );
}
