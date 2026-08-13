import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SignIn } from '@clerk/clerk-react';
import { AuthLayout } from '../components/layout/AuthLayout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useUserAuth } from '../contexts/UserAuthContext';

export function Login() {
  const navigate = useNavigate();
  const { login } = useUserAuth();
  const [mode, setMode] = useState<'clerk' | 'legacy'>('clerk');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    sessionStorage.setItem('auth_redirect_target', '/dashboard');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    setLoading(true);
    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.error || 'Login failed');
    }
  };

  const handleOAuth = (provider: string) => {
    window.location.href = `${window.location.origin}/api/auth/${provider}`;
  };

  const footer = (
    <>
      New to EchoPost?{' '}
      <Link to="/signup" className="font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-300">
        Create an account
      </Link>
    </>
  );

  if (mode === 'clerk') {
    return (
      <AuthLayout
        title="Welcome Back"
        subtitle="Log in to your account to manage your posts."
        footer={footer}>
        <SignIn
          signUpUrl="/signup"
          appearance={{
            variables: { colorPrimary: '#6366f1', borderRadius: '10px' },
            elements: { footer: 'hidden', previewMode: 'hidden' },
          }}
        />
        <button
          type="button"
          onClick={() => setMode('legacy')}
          className="mt-4 w-full text-center text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          Having issues with the sign-in widget? Use email &amp; password instead
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Welcome Back"
      subtitle="Log in to your account to manage your posts."
      footer={footer}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

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
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button type="submit" fullWidth disabled={loading}>
          {loading ? 'Logging in...' : 'Log in'}
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
        Trouble signing in?{' '}
        <a href="#support" className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-300">
          Contact support
        </a>
      </p>
    </AuthLayout>
  );
}
