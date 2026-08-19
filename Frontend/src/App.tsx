
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
import { Chat } from './pages/Chat';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { PublishingHistory } from './pages/PublishingHistory';
import { Scheduled } from './pages/Scheduled';
import { MediaLibrary } from './pages/MediaLibrary';
import { SupportPage } from './pages/Support';
import { BrandingPage } from './pages/Branding';
import { ProfilePage } from './pages/Profile';
import { GuidePage } from './pages/Guide';
import { TermsPage, PrivacyPage, DataProcessingPage } from './pages/Legal';
import { AdminLogin } from './pages/admin/AdminLogin';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminReports } from './pages/admin/AdminReports';
import { AdminPackages } from './pages/admin/AdminPackages';
import { AdminTopUps } from './pages/admin/AdminTopUps';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminUserDetail } from './pages/admin/AdminUserDetail';
import { AdminPayments } from './pages/admin/AdminPayments';
import { AdminSettings } from './pages/admin/AdminSettings';
import { AdminAIProviders } from './pages/admin/AdminAIProviders';
import { AdminMetaSettings } from './pages/admin/AdminMetaSettings';
import { AdminSupport } from './pages/admin/AdminSupport';
import { AdminAdmins } from './pages/admin/AdminAdmins';
import { AdminAuditLog } from './pages/admin/AdminAuditLog';
import { AdminErrors } from './pages/admin/AdminErrors';
import { AdminProfile } from './pages/admin/AdminProfile';
import { NotFound } from './pages/NotFound';
import { RequireAdmin } from './components/layout/RequireAdmin';
import { RequireUser } from './components/RequireUser';
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
            <Route path="/dashboard" element={<RequireUser><Dashboard /></RequireUser>} />
            <Route path="/dashboard/chat" element={<RequireUser><Chat /></RequireUser>} />
            <Route path="/dashboard/approval" element={<RequireUser><ApprovalQueue /></RequireUser>} />
            <Route path="/dashboard/history" element={<RequireUser><PublishingHistory /></RequireUser>} />
            <Route path="/dashboard/scheduled" element={<RequireUser><Scheduled /></RequireUser>} />
            <Route path="/dashboard/media" element={<RequireUser><MediaLibrary /></RequireUser>} />
            <Route path="/dashboard/support" element={<RequireUser><SupportPage /></RequireUser>} />
            <Route path="/dashboard/branding" element={<RequireUser><BrandingPage /></RequireUser>} />
            <Route path="/dashboard/profile" element={<RequireUser><ProfilePage /></RequireUser>} />
            <Route path="/dashboard/guide" element={<RequireUser><GuidePage /></RequireUser>} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/data-processing" element={<DataProcessingPage />} />
            <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/dashboard" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
            <Route path="/admin/reports" element={<RequireAdmin><AdminReports /></RequireAdmin>} />
            <Route path="/admin/packages" element={<RequireAdmin><AdminPackages /></RequireAdmin>} />
            <Route path="/admin/topups" element={<RequireAdmin><AdminTopUps /></RequireAdmin>} />
            <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
            <Route path="/admin/users/:phone" element={<RequireAdmin><AdminUserDetail /></RequireAdmin>} />
            <Route path="/admin/payments" element={<RequireAdmin><AdminPayments /></RequireAdmin>} />
            <Route path="/admin/settings" element={<RequireAdmin><AdminSettings /></RequireAdmin>} />
            <Route path="/admin/ai-providers" element={<RequireAdmin><AdminAIProviders /></RequireAdmin>} />
            <Route path="/admin/meta-platform" element={<RequireAdmin><AdminMetaSettings /></RequireAdmin>} />
            <Route path="/admin/support" element={<RequireAdmin><AdminSupport /></RequireAdmin>} />
            <Route path="/admin/admins" element={<RequireAdmin><AdminAdmins /></RequireAdmin>} />
            <Route path="/admin/audit" element={<RequireAdmin><AdminAuditLog /></RequireAdmin>} />
            <Route path="/admin/errors" element={<RequireAdmin><AdminErrors /></RequireAdmin>} />
            <Route path="/admin/profile" element={<RequireAdmin><AdminProfile /></RequireAdmin>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </UserAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
