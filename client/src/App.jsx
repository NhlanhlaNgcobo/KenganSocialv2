import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { ThemeProvider } from './context/ThemeContext';
import AuthGuard from './components/auth/AuthGuard';
import DashboardLayout from './components/layout/DashboardLayout';
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));

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
const PricingPage = lazy(() => import('./pages/PricingPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const HelpCenterPage = lazy(() => import('./pages/HelpCenterPage'));
const DeletionStatusPage = lazy(() => import('./pages/DeletionStatusPage'));
const ConsentPage = lazy(() => import('./pages/ConsentPage'));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'));
const ContentStudioPage = lazy(() => import('./pages/ContentStudioPage'));
const CalendarPage = lazy(() => import('./pages/Calendar/CalendarPage'));
const AiToolsPage = lazy(() => import('./pages/AiToolsPage'));
const AnalyticsDashboard = lazy(() => import('./pages/Analytics/AnalyticsDashboard'));
const AutomationPage = lazy(() => import('./pages/AutomationPage'));
const LeadsBoard = lazy(() => import('./pages/Leads/LeadsBoard'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const VideoEditorPage = lazy(() => import('./pages/VideoEditorPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const TrendingFeed = lazy(() => import('./pages/Trending/TrendingFeed'));
const DMManager = lazy(() => import('./pages/DM/DMManager'));
const AdsPage = lazy(() => import('./pages/AdsPage'));
const LaunchPage = lazy(() => import('./pages/Launch/LaunchPage'));
const ClipsPage = lazy(() => import('./pages/Clips/ClipsPage'));
const RepurposePage = lazy(() => import('./pages/Repurpose/RepurposePage'));
const MarketingPage = lazy(() => import('./pages/Marketing/MarketingPage'));
const ClientsPage = lazy(() => import('./pages/Clients/ClientsPage'));
const ReviewPage = lazy(() => import('./pages/Review/ReviewPage'));

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <Suspense fallback={<div role="status" aria-live="polite" style={{ padding: '2rem' }}>Loading page...</div>}>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/help" element={<HelpCenterPage />} />
              <Route path="/privacy" element={<LegalPage docSlug="privacy" />} />
              <Route path="/terms" element={<LegalPage docSlug="terms" />} />
              <Route path="/legal" element={<LegalPage docSlug="terms" />} />
              <Route path="/data-deletion" element={<LegalPage docSlug="data-deletion" />} />
              <Route path="/data-deletion/status" element={<DeletionStatusPage />} />

              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              {/* Client review links: public, no account needed */}
              <Route path="/review/:token" element={<ReviewPage />} />

              {/* Onboarding — requires auth, shown before dashboard */}
              <Route path="/consent" element={
                <AuthGuard>
                  <ConsentPage />
                </AuthGuard>
              } />
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
                <Route path="ads" element={<AdsPage />} />
                <Route path="launch" element={<LaunchPage />} />
                <Route path="clips" element={<ClipsPage />} />
                <Route path="repurpose" element={<RepurposePage />} />
                <Route path="marketing" element={<MarketingPage />} />
                <Route path="clients" element={<ClientsPage />} />
                {/* Video editor moved to /editor for full-screen layout */}
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </WorkspaceProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
