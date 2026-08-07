import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { UserAuthProvider } from './contexts/UserAuthContext';
import { ToastHost } from './components/ui/Toast';
import { Landing } from './pages/Landing';
import { Signup } from './pages/Signup';
import { Login } from './pages/Login';
import { AuthCallback } from './pages/AuthCallback';
import { Packages } from './pages/Packages';
import { Checkout } from './pages/Checkout';
import { Connect } from './pages/Connect';
import { Dashboard } from './pages/Dashboard';
import { AdminLogin } from './pages/admin/AdminLogin';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminPackages } from './pages/admin/AdminPackages';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminPayments } from './pages/admin/AdminPayments';
import { AdminSettings } from './pages/admin/AdminSettings';
import { NotFound } from './pages/NotFound';
import { RequireAdmin } from './components/layout/RequireAdmin';
import { ClerkSessionBridge } from './components/ClerkSessionBridge';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <UserAuthProvider>
          <ToastHost />
          <ClerkSessionBridge />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/packages" element={<Packages />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/connect" element={<Connect />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/dashboard" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
            <Route path="/admin/packages" element={<RequireAdmin><AdminPackages /></RequireAdmin>} />
            <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
            <Route path="/admin/payments" element={<RequireAdmin><AdminPayments /></RequireAdmin>} />
            <Route path="/admin/settings" element={<RequireAdmin><AdminSettings /></RequireAdmin>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </UserAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
