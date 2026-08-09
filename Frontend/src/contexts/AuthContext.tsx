import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest, endpoints, setAuthToken, getAuthToken } from '../utils/api';

interface AuthState {
  isAuthenticated: boolean;
  isAdmin: boolean;
  adminEmail: string | null;
  adminRole: string | null;
  adminPermissions: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState>({
  isAuthenticated: false,
  isAdmin: false,
  adminEmail: null,
  adminRole: null,
  adminPermissions: [],
  loading: true,
  login: async () => ({ success: false }),
  logout: async () => {},
  hasPermission: () => false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [adminPermissions, setAdminPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setIsAuthenticated(false);
      setIsAdmin(false);
      setAdminEmail(null);
      setAdminRole(null);
      setAdminPermissions([]);
      setLoading(false);
      return;
    }

    try {
      const data = await apiRequest<{ email: string; name?: string; role?: string; permissions?: string[] }>(endpoints.adminMe);
      setIsAuthenticated(true);
      setIsAdmin(true);
      setAdminEmail(data.email);
      setAdminRole(data.role || null);
      setAdminPermissions(data.permissions || []);
    } catch {
      setAuthToken(null);
      setIsAuthenticated(false);
      setIsAdmin(false);
      setAdminEmail(null);
      setAdminRole(null);
      setAdminPermissions([]);
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
      setAdminRole(null);
      setAdminPermissions([]);
      checkAuth();
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
    setAdminRole(null);
    setAdminPermissions([]);
  };

  const hasPermission = useCallback(
    (permission: string) => {
      if (!isAuthenticated) return false;
      if (adminRole === 'super_admin') return true;
      return adminPermissions.includes(permission);
    },
    [isAuthenticated, adminRole, adminPermissions],
  );

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isAdmin,
        adminEmail,
        adminRole,
        adminPermissions,
        loading,
        login,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
