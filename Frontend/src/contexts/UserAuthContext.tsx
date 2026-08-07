import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useClerk } from '@clerk/clerk-react';
import { apiRequest, endpoints, setUserToken, getUserToken } from '../utils/api';

interface User {
  phone: string;
  name: string;
  email: string;
  packageId: string;
  tokensRemaining: number;
  tokensUsed: number;
  avatarUrl?: string;
  oauthProvider?: string;
}

interface UserAuthState {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  signup: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  clerkLogin: (clerkToken: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const UserAuthContext = createContext<UserAuthState>({
  user: null,
  isAuthenticated: false,
  loading: true,
  signup: async () => ({ success: false }),
  login: async () => ({ success: false }),
  clerkLogin: async () => ({ success: false }),
  logout: async () => {},
  refreshUser: async () => {},
});

export function UserAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { signOut: clerkSignOut } = useClerk();

  const refreshUser = useCallback(async () => {
    const token = getUserToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const data = await apiRequest<{ phone: string; name: string; email: string; packageId: string; tokensRemaining: number; tokensUsed: number; avatarUrl?: string; oauthProvider?: string }>(endpoints.userMe, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(data);
    } catch {
      setUserToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const signup = async (email: string, password: string, name: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const data = await apiRequest<{ token: string; phone: string }>(endpoints.signup, {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      });
      setUserToken(data.token);
      await refreshUser();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  };

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const data = await apiRequest<{ token: string; phone: string }>(endpoints.login, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setUserToken(data.token);
      await refreshUser();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  };

  const clerkLogin = async (clerkToken: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const data = await apiRequest<{ token: string; phone: string }>(endpoints.clerkBridge, {
        method: 'POST',
        body: JSON.stringify({ token: clerkToken }),
      });
      setUserToken(data.token);
      await refreshUser();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  };

  const logout = async () => {
    const token = getUserToken();
    if (token) {
      try {
        await apiRequest(endpoints.logout, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // ignore
      }
    }
    setUserToken(null);
    setUser(null);
    try {
      await clerkSignOut();
    } catch {
      // ignore
    }
  };

  return (
    <UserAuthContext.Provider value={{ user, isAuthenticated: !!user, loading, signup, login, clerkLogin, logout, refreshUser }}>
      {children}
    </UserAuthContext.Provider>
  );
}

export function useUserAuth() {
  return useContext(UserAuthContext);
}
