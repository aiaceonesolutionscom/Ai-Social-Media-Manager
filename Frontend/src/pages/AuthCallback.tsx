import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setUserToken } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';

export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshUser } = useUserAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setUserToken(token);
      refreshUser().then(() => {
        navigate('/dashboard');
      });
    } else {
      navigate('/login?error=oauth_failed');
    }
  }, [searchParams, navigate, refreshUser]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent mx-auto" />
        <p className="text-slate-600 dark:text-slate-300">Signing you in...</p>
      </div>
    </div>
  );
}
