import { Navigate, Route, Routes } from 'react-router-dom';
import { ROLE_HOME } from '@dalmia/types';
import { useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './layout/AppShell';
import { ApprovalQueuePage } from './pages/approvals/ApprovalQueuePage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ImportPage } from './pages/import/ImportPage';
import { ReportPage } from './pages/reports/ReportPage';
import { ReportsListPage } from './pages/reports/ReportsListPage';
import { BrandTokensPage } from './pages/settings/BrandTokensPage';
import { GlobalSettingsPage } from './pages/settings/GlobalSettingsPage';
import { MaterialsPage } from './pages/settings/MaterialsPage';
import { ParametersPage } from './pages/settings/ParametersPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { SuppliersPage } from './pages/settings/SuppliersPage';
import { UsersPage } from './pages/settings/UsersPage';

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<HomeRedirect />} />
          <Route path="/reports" element={<ReportsListPage />} />
          <Route path="/reports/:id" element={<ReportPage />} />

          <Route element={<RequireAuth roles={['QC_MANAGER']} />}>
            <Route path="/approvals" element={<ApprovalQueuePage />} />
          </Route>

          <Route element={<RequireAuth roles={['ADMIN']} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="/settings/users" replace />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="materials" element={<MaterialsPage />} />
              <Route path="parameters" element={<ParametersPage />} />
              <Route path="global" element={<GlobalSettingsPage />} />
              <Route path="appearance" element={<BrandTokensPage />} />
            </Route>
          </Route>

          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Route>
    </Routes>
  );
}
