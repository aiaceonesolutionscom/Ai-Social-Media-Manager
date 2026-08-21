import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, endpoints, setUserToken } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';

export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshUser } = useUserAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // H6 — OAuth providers redirect back with a short-lived single-use code.
    // Legacy flows may still pass ?token= directly; keep supporting them.
    const code = searchParams.get('code');
    const token = searchParams.get('token');

    if (token) {
      setUserToken(token);
      refreshUser().then(() => navigate('/dashboard'));
      return;
    }

    if (!code) {
      navigate('/login?error=oauth_failed');
      return;
    }

    apiRequest<{ token: string }>(endpoints.authExchange, {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
      .then((res) => {
        setUserToken(res.token);
        refreshUser().then(() => navigate('/dashboard'));
      })
      .catch((err) => {
        setError((err as Error).message || 'Authentication failed');
        navigate('/login?error=oauth_failed');
      });
  }, [searchParams, navigate, refreshUser]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent mx-auto" />
        <p className="text-slate-600 dark:text-slate-300">
          {error ? error : 'Signing you in...'}
        </p>
      </div>
    </div>
  );
}