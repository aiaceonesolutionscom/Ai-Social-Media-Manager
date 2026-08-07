import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUserAuth } from '../contexts/UserAuthContext';

/**
 * Bridges a Clerk session to the app's own user session.
 * When a user signs in/up via Clerk, we exchange the Clerk session JWT
 * for an app session token (POST /api/auth/clerk) and navigate to the target page.
 */
export function ClerkSessionBridge() {
  const { isSignedIn, getToken } = useAuth();
  const { user, clerkLogin, loading } = useUserAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const exchanging = useRef(false);

  const isAuthRoute = ['/login', '/signup'].includes(location.pathname);
  const target = sessionStorage.getItem('auth_redirect_target') || '/dashboard';

  useEffect(() => {
    if (!isSignedIn || !isAuthRoute) return;
    if (user) {
      navigate(target, { replace: true });
    }
  }, [isSignedIn, user, isAuthRoute, navigate, target]);

  useEffect(() => {
    if (!isSignedIn || user || exchanging.current) return;
    exchanging.current = true;
    setError('');
    (async () => {
      try {
        const clerkToken = await getToken();
        if (!clerkToken) {
          exchanging.current = false;
          return;
        }
        const result = await clerkLogin(clerkToken);
        exchanging.current = false;
        if (result.success) {
          const t = sessionStorage.getItem('auth_redirect_target') || '/dashboard';
          sessionStorage.removeItem('auth_redirect_target');
          navigate(t, { replace: true });
        } else {
          setError(result.error || 'Failed to link your Clerk account');
        }
      } catch (err) {
        exchanging.current = false;
        setError((err as Error).message || 'Failed to link your Clerk account');
      }
    })();
  }, [isSignedIn, user, getToken, clerkLogin, navigate]);

  useEffect(() => {
    if (!loading && isSignedIn && !user && !isAuthRoute) {
      // Signed in with Clerk but app session missing and we're not on an auth page:
      // let the exchange happen in place (pages degrade gracefully).
    }
  }, [loading, isSignedIn, user, isAuthRoute]);

  if (!error) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
      {error}
      <button
        className="ml-3 font-semibold underline underline-offset-2"
        onClick={() => setError('')}
        aria-label="Dismiss error">
        Dismiss
      </button>
    </div>
  );
}
