import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { ThemeProvider } from './context/ThemeContext';
import AuthGuard from './components/auth/AuthGuard';
import DashboardLayout from './components/layout/DashboardLayout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import FeaturePage from './pages/FeaturePage';

import {
  Link2,
  FileVideo,
  Calendar,
  Sparkles,
  BarChart3,
  Zap,
  Users,
  CreditCard,
  Settings,
} from 'lucide-react';

import './index.css';

import LandingPage from './pages/LandingPage';
import PricingPage from './pages/PricingPage';
import AboutPage from './pages/AboutPage';
import HelpCenterPage from './pages/HelpCenterPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import ConnectionsPage from './pages/ConnectionsPage';
import ContentStudioPage from './pages/ContentStudioPage';
import SchedulerPage from './pages/SchedulerPage';
import AiToolsPage from './pages/AiToolsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import AutomationPage from './pages/AutomationPage';
import LeadsPage from './pages/LeadsPage';
import BillingPage from './pages/BillingPage';
import SettingsPage from './pages/SettingsPage';
import VideoEditorPage from './pages/VideoEditorPage';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/help" element={<HelpCenterPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />

              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Full-screen video editor (CapCut layout — no sidebar) */}
              <Route path="/editor" element={
                <AuthGuard>
                  <VideoEditorPage />
                </AuthGuard>
              } />

              {/* Protected routes */}
              <Route
                path="/dashboard"
                element={
                  <AuthGuard>
                    <DashboardLayout />
                  </AuthGuard>
                }
              >
                <Route index element={<DashboardPage />} />

                <Route path="connections" element={<ConnectionsPage />} />
                <Route path="content" element={<ContentStudioPage />} />
                <Route path="scheduler" element={<SchedulerPage />} />
                <Route path="ai-tools" element={<AiToolsPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="automation" element={<AutomationPage />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="billing" element={<BillingPage />} />
                <Route path="settings" element={<SettingsPage />} />
                {/* Video editor moved to /editor for full-screen layout */}
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </WorkspaceProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
