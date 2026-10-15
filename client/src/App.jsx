import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { ThemeProvider } from './context/ThemeContext';
import AuthGuard from './components/auth/AuthGuard';
import DashboardLayout from './components/layout/DashboardLayout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';

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
import CalendarPage from './pages/Calendar/CalendarPage';
import AiToolsPage from './pages/AiToolsPage';
import AnalyticsDashboard from './pages/Analytics/AnalyticsDashboard';
import AutomationPage from './pages/AutomationPage';
import LeadsBoard from './pages/Leads/LeadsBoard';
import BillingPage from './pages/BillingPage';
import SettingsPage from './pages/SettingsPage';
import VideoEditorPage from './pages/VideoEditorPage';
import LegalPage from './pages/LegalPage';
import OnboardingPage from './pages/OnboardingPage';
import TrendingFeed from './pages/Trending/TrendingFeed';
import DMManager from './pages/DM/DMManager';
import LaunchPage from './pages/Launch/LaunchPage';
import ClipsPage from './pages/Clips/ClipsPage';
import RepurposePage from './pages/Repurpose/RepurposePage';
import MarketingPage from './pages/Marketing/MarketingPage';

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
              <Route path="/legal" element={<LegalPage />} />

              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Onboarding — requires auth, shown before dashboard */}
              <Route path="/onboarding" element={
                <AuthGuard>
                  <OnboardingPage />
                </AuthGuard>
              } />

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
                <Route path="scheduler" element={<CalendarPage />} />
                <Route path="ai-tools" element={<AiToolsPage />} />
                <Route path="analytics" element={<AnalyticsDashboard />} />
                <Route path="automation" element={<AutomationPage />} />
                <Route path="leads" element={<LeadsBoard />} />
                <Route path="billing" element={<BillingPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="trending" element={<TrendingFeed />} />
                <Route path="dm" element={<DMManager />} />
                <Route path="launch" element={<LaunchPage />} />
                <Route path="clips" element={<ClipsPage />} />
                <Route path="repurpose" element={<RepurposePage />} />
                <Route path="marketing" element={<MarketingPage />} />
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
