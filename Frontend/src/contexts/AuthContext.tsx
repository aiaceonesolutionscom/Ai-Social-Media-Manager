import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest, endpoints, setAuthToken, getAuthToken } from '../utils/api';

interface AuthState {
  isAuthenticated: boolean;
  isAdmin: boolean;
  adminEmail: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  isAuthenticated: false,
  isAdmin: false,
  adminEmail: null,
  loading: true,
  login: async () => ({ success: false }),
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setIsAuthenticated(false);
      setIsAdmin(false);
      setAdminEmail(null);
      setLoading(false);
      return;
    }

    try {
      const data = await apiRequest<{ email: string }>(endpoints.adminMe);
      setIsAuthenticated(true);
      setIsAdmin(true);
      setAdminEmail(data.email);
    } catch {
      setAuthToken(null);
      setIsAuthenticated(false);
      setIsAdmin(false);
      setAdminEmail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const data = await apiRequest<{ token: string; email: string }>(endpoints.adminLogin, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAuthToken(data.token);
      setAdminEmail(data.email);
      setIsAuthenticated(true);
      setIsAdmin(true);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  };

  const logout = async () => {
    try {
      await apiRequest(endpoints.adminLogout, { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setIsAuthenticated(false);
    setIsAdmin(false);
    setAdminEmail(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isAdmin, adminEmail, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
